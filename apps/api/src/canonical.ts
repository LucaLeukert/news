import { api, toStoryDetailProjection, toStoryProjection } from "@news/convex";
import {
  aiJobs,
  aiResults,
  articles,
  createDb,
  stories,
  storyArticles,
} from "@news/db";
import {
  decodeUnknownSync,
  neutralStorySummaryJobPayloadSchema,
  type AiResultEnvelope,
  type LeasedAiJob,
  type StorySummaryOutput,
} from "@news/types";
import { and, asc, eq, inArray, lt, or } from "drizzle-orm";
import { ConvexHttpClient } from "convex/browser";
import { Clock, Data, DateTime, Effect } from "effect";
import { makePostgresRepository } from "./repository";

const decodeNeutralStorySummaryPayload = decodeUnknownSync(
  neutralStorySummaryJobPayloadSchema,
);

const isStorySummaryOutput = (
  value: AiResultEnvelope["structured_output"],
): value is StorySummaryOutput =>
  "neutralSummary" in value &&
  "agreed" in value &&
  "differs" in value &&
  "contestedOrUnverified" in value;

class CanonicalStoreError extends Data.TaggedError("CanonicalStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const tryCanonical = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new CanonicalStoreError({ message, cause }),
  });

const currentDate = DateTime.now.pipe(Effect.map(DateTime.toDateUtc));

const currentIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const toMutableStoryProjection = (
  story: ReturnType<typeof toStoryProjection>,
): {
  storyId: string;
  title: string;
  topicTags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  summary:
    | {
        neutralSummary: string;
        agreed: string[];
        differs: string[];
        contestedOrUnverified: string[];
        confidence: number;
        lastUpdatedAt: string;
      }
    | null;
  coverage: {
    byCountry: Record<string, number>;
    byLanguage: Record<string, number>;
    byTaxonomy: Record<string, number>;
    byOwnership: Record<string, number>;
    byReliability: Record<string, number>;
  };
  syncedAt: string;
} => ({
  ...story,
  topicTags: [...story.topicTags],
  summary: story.summary
    ? {
        ...story.summary,
        agreed: [...story.summary.agreed],
        differs: [...story.summary.differs],
        contestedOrUnverified: [...story.summary.contestedOrUnverified],
      }
    : null,
  coverage: {
    byCountry: { ...story.coverage.byCountry },
    byLanguage: { ...story.coverage.byLanguage },
    byTaxonomy: { ...story.coverage.byTaxonomy },
    byOwnership: { ...story.coverage.byOwnership },
    byReliability: { ...story.coverage.byReliability },
  },
});

const toMutableStoryDetailProjection = (
  detail: ReturnType<typeof toStoryDetailProjection>,
): {
  storyId: string;
  story: {
    id: string;
    title: string;
    topicTags: string[];
    firstSeenAt: string;
    lastSeenAt: string;
    summary:
      | {
          neutralSummary: string;
          agreed: string[];
          differs: string[];
          contestedOrUnverified: string[];
          confidence: number;
          lastUpdatedAt: string;
        }
      | null;
    coverage: {
      byCountry: Record<string, number>;
      byLanguage: Record<string, number>;
      byTaxonomy: Record<string, number>;
      byOwnership: Record<string, number>;
      byReliability: Record<string, number>;
    };
  };
  articles: Array<{
    id: string;
    sourceId: string;
    canonicalUrl: string;
    title: string;
    snippet: string | null;
    author: string | null;
    publishedAt: string | null;
    language: string | null;
    articleType: string;
    paywalled: boolean;
    crawlStatus: string;
  }>;
  syncedAt: string;
} => ({
  ...detail,
  story: {
    ...detail.story,
    topicTags: [...detail.story.topicTags],
    summary: detail.story.summary
      ? {
          ...detail.story.summary,
          agreed: [...detail.story.summary.agreed],
          differs: [...detail.story.summary.differs],
          contestedOrUnverified: [
            ...detail.story.summary.contestedOrUnverified,
          ],
        }
      : null,
    coverage: {
      byCountry: { ...detail.story.coverage.byCountry },
      byLanguage: { ...detail.story.coverage.byLanguage },
      byTaxonomy: { ...detail.story.coverage.byTaxonomy },
      byOwnership: { ...detail.story.coverage.byOwnership },
      byReliability: { ...detail.story.coverage.byReliability },
    },
  },
  articles: detail.articles.map((article) => ({ ...article })),
});

export const leaseAiJobFromCanonicalStore = (
  databaseUrl: string,
  nodeId: string,
): Effect.Effect<LeasedAiJob | null, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const leaseExpiresAt = yield* DateTime.now.pipe(
      Effect.map((value) => DateTime.addDuration(value, "60 seconds")),
      Effect.map(DateTime.toDateUtc),
    );

    const candidates = yield* tryCanonical("Failed to lease AI job", () =>
      db
        .select()
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.type, "neutral_story_summary"),
            or(
              eq(aiJobs.status, "pending"),
              and(eq(aiJobs.status, "leased"), lt(aiJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .orderBy(asc(aiJobs.priority), asc(aiJobs.createdAt))
        .limit(1),
    );

    const job = candidates[0];
    if (!job) return null;

    yield* tryCanonical(`Failed to update lease for AI job ${job.id}`, () =>
      db
        .update(aiJobs)
        .set({
          status: "leased",
          leasedBy: nodeId,
          leaseExpiresAt,
          attempts: job.attempts + 1,
          updatedAt: now,
        })
        .where(eq(aiJobs.id, job.id)),
    );

    return {
      id: job.id,
      type: "neutral_story_summary",
      payload: decodeNeutralStorySummaryPayload(job.payload),
      inputArtifactIds: job.inputArtifactIds,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  });

export const persistAiResultToCanonicalStore = (
  databaseUrl: string,
  result: AiResultEnvelope,
): Effect.Effect<void, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const createdAt = DateTime.toDateUtc(DateTime.makeUnsafe(result.created_at));
    const aiResultRow: typeof aiResults.$inferInsert = {
      jobId: result.job_id,
      modelName: result.model_name,
      modelVersion: result.model_version,
      promptVersion: result.prompt_version,
      inputArtifactIds: [...result.input_artifact_ids],
      outputSchemaVersion: result.output_schema_version,
      structuredOutput: { ...result.structured_output },
      confidence: result.confidence,
      reasons: [...result.reasons],
      citationsToInputIds: [...result.citations_to_input_ids],
      validationStatus: result.validation_status,
      latencyMs: result.latency_ms,
      createdAt,
    };

    yield* tryCanonical(`Failed to persist AI result ${result.job_id}`, () =>
      db.insert(aiResults).values(aiResultRow),
    );

    yield* tryCanonical(`Failed to update AI job ${result.job_id}`, () =>
      db
        .update(aiJobs)
        .set({
          status:
            result.validation_status === "valid"
              ? "completed"
              : "failed_schema_validation",
          leasedBy: null,
          leaseExpiresAt: null,
          lastError:
            result.validation_status === "valid"
              ? null
              : `validation:${result.validation_status}`,
          updatedAt: createdAt,
        })
        .where(eq(aiJobs.id, result.job_id)),
    );

    if (!isStorySummaryOutput(result.structured_output)) {
      return;
    }
    const structuredOutput = result.structured_output;

    const matchingStories = yield* tryCanonical(
      `Failed to load matching stories for AI result ${result.job_id}`,
      () =>
        db
          .selectDistinct({ storyId: storyArticles.storyId })
          .from(storyArticles)
          .where(inArray(storyArticles.articleId, result.input_artifact_ids)),
    );

    const storyIds = matchingStories.map((row) => row.storyId);
    if (storyIds.length === 0) return;

    yield* tryCanonical(
      `Failed to update story summaries for AI result ${result.job_id}`,
      () =>
        db
          .update(stories)
          .set({
            summary: {
              neutralSummary: structuredOutput.neutralSummary,
              agreed: structuredOutput.agreed,
              differs: structuredOutput.differs,
              contestedOrUnverified: structuredOutput.contestedOrUnverified,
              confidence: result.confidence,
              lastUpdatedAt: result.created_at,
            },
            lastSeenAt: createdAt,
          })
          .where(inArray(stories.id, storyIds)),
    );
  });

export const syncCanonicalStoriesToConvex = (input: {
  databaseUrl: string;
  convexUrl: string;
  serviceToken: string;
}): Effect.Effect<void, CanonicalStoreError> =>
  Effect.gen(function* () {
    const repository = makePostgresRepository(input.databaseUrl);
    const mapRepositoryError = <A>(
      effect: Effect.Effect<A, unknown>,
      repositoryOperation: string,
    ) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new CanonicalStoreError({
              message: `Failed to ${repositoryOperation}`,
              cause,
            }),
        ),
      );
    const stories = yield* mapRepositoryError(
      repository.listStories({}),
      "load stories for Convex sync",
    );
    const details = yield* Effect.all(
      stories.map((story) =>
        mapRepositoryError(
          repository.getStory(story.id),
          `load story ${story.id} for Convex sync`,
        ),
      ),
    );
    const syncedAt = yield* currentIso;

    const client = new ConvexHttpClient(input.convexUrl);
    yield* tryCanonical("Failed to sync canonical stories to Convex", () =>
      client.mutation(api.storyProjections.replacePublicProjectionsFromSync, {
        serviceToken: input.serviceToken,
        stories: stories.map((story) =>
          toMutableStoryProjection(toStoryProjection(story, syncedAt)),
        ),
        details: details
          .filter((detail): detail is NonNullable<typeof detail> => detail !== null)
          .map((detail) =>
            toMutableStoryDetailProjection(
              toStoryDetailProjection(detail, syncedAt),
            ),
          ),
      }),
    );
  });

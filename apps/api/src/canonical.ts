import { aiJobTypesForModel, canPublishPublicAiOutput, canUseInAggregateLabels } from "@news/ai";
import { api, toStoryDetailProjection, toStoryProjection } from "@news/convex";
import {
  aiJobs,
  aiResults,
  articles,
  claims,
  createDb,
  entities,
  sourceRatings,
  stories,
} from "@news/db";
import {
  type ArticleExtractionQaOutput,
  type BiasContextOutput,
  type ClaimExtractionOutput,
  type FactualityReliabilitySupportOutput,
  type OwnershipExtractionSupportOutput,
  type SafetyComplianceOutput,
  articleExtractionQaJobPayloadSchema,
  claimExtractionJobPayloadSchema,
  decodeUnknownSync,
  neutralStorySummaryJobPayloadSchema,
  safetyComplianceJobPayloadSchema,
  sourceAnalysisJobPayloadSchema,
  storyClusteringSupportJobPayloadSchema,
  type AiJobType,
  type AiResultEnvelope,
  type LeasedAiJob,
  type SafetyComplianceJobPayload,
  type StorySummaryOutput,
} from "@news/types";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { ConvexHttpClient } from "convex/browser";
import { Data, DateTime, Effect } from "effect";
import { makePostgresRepository } from "./repository";

const decodeArticleExtractionQaPayload = decodeUnknownSync(
  articleExtractionQaJobPayloadSchema,
);
const decodeClaimExtractionPayload = decodeUnknownSync(
  claimExtractionJobPayloadSchema,
);
const decodeNeutralStorySummaryPayload = decodeUnknownSync(
  neutralStorySummaryJobPayloadSchema,
);
const decodeStoryClusteringSupportPayload = decodeUnknownSync(
  storyClusteringSupportJobPayloadSchema,
);
const decodeSourceAnalysisPayload = decodeUnknownSync(
  sourceAnalysisJobPayloadSchema,
);
const decodeSafetyCompliancePayload = decodeUnknownSync(
  safetyComplianceJobPayloadSchema,
);

const isStorySummaryOutput = (
  value: AiResultEnvelope["structured_output"],
): value is StorySummaryOutput =>
  "neutralSummary" in value &&
  "agreed" in value &&
  "differs" in value &&
  "contestedOrUnverified" in value;

const isArticleExtractionQaOutput = (
  value: AiResultEnvelope["structured_output"],
): value is ArticleExtractionQaOutput =>
  "extraction_valid" in value && "article_type" in value;

const isClaimExtractionOutput = (
  value: AiResultEnvelope["structured_output"],
): value is ClaimExtractionOutput => "claims" in value;

const isBiasContextOutput = (
  value: AiResultEnvelope["structured_output"],
): value is BiasContextOutput =>
  "taxonomy_bucket" in value && "publishable" in value;

const isFactualityOutput = (
  value: AiResultEnvelope["structured_output"],
): value is FactualityReliabilitySupportOutput => "reliability_band" in value;

const isOwnershipOutput = (
  value: AiResultEnvelope["structured_output"],
): value is OwnershipExtractionSupportOutput =>
  "ownership_category" in value && "citations" in value;

const isSafetyOutput = (
  value: AiResultEnvelope["structured_output"],
): value is SafetyComplianceOutput => "safe_to_publish" in value;

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

const normalizeEntityKey = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type PersistedAiResultOutcome = {
  readonly jobType: AiJobType;
  readonly rebuildStories: boolean;
  readonly queueProjectionSync: boolean;
  readonly safetyJobPayload?: SafetyComplianceJobPayload;
};

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
  input: {
    readonly nodeId: string;
    readonly model?: string;
  },
): Effect.Effect<LeasedAiJob | null, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const leaseExpiresAt = yield* DateTime.now.pipe(
      Effect.map((value) => DateTime.addDuration(value, "60 seconds")),
      Effect.map(DateTime.toDateUtc),
    );

    const allowedJobTypes = input.model
      ? aiJobTypesForModel(input.model as never)
      : null;
    const candidates = yield* tryCanonical("Failed to lease AI job", () =>
      db
        .select()
        .from(aiJobs)
        .where(
          and(
            allowedJobTypes ? inArray(aiJobs.type, allowedJobTypes) : undefined,
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
          leasedBy: input.nodeId,
          leaseExpiresAt,
          attempts: job.attempts + 1,
          updatedAt: now,
        })
        .where(eq(aiJobs.id, job.id)),
    );

    switch (job.type) {
      case "article_extraction_qa":
        return {
          id: job.id,
          type: job.type,
          payload: decodeArticleExtractionQaPayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
      case "claim_extraction":
        return {
          id: job.id,
          type: job.type,
          payload: decodeClaimExtractionPayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
      case "story_clustering_support":
        return {
          id: job.id,
          type: job.type,
          payload: decodeStoryClusteringSupportPayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
      case "neutral_story_summary":
        return {
          id: job.id,
          type: job.type,
          payload: decodeNeutralStorySummaryPayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
      case "bias_context_classification":
      case "factuality_reliability_support":
      case "ownership_extraction_support":
        return {
          id: job.id,
          type: job.type,
          payload: decodeSourceAnalysisPayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
      case "safety_compliance_check":
        return {
          id: job.id,
          type: job.type,
          payload: decodeSafetyCompliancePayload(job.payload),
          inputArtifactIds: job.inputArtifactIds,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        };
    }
  });

export const persistAiResultToCanonicalStore = (
  databaseUrl: string,
  result: AiResultEnvelope,
): Effect.Effect<PersistedAiResultOutcome, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const createdAt = DateTime.toDateUtc(DateTime.makeUnsafe(result.created_at));
    const [job] = yield* tryCanonical(`Failed to load AI job ${result.job_id}`, () =>
      db.select().from(aiJobs).where(eq(aiJobs.id, result.job_id)).limit(1),
    );
    if (!job) {
      return yield* new CanonicalStoreError({
        message: `AI job ${result.job_id} was not found`,
      });
    }
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

    if (result.validation_status !== "valid") {
      if (job.type === "neutral_story_summary") {
        const payload = decodeNeutralStorySummaryPayload(job.payload);
        yield* tryCanonical(
          `Failed to clear story summary after invalid AI result ${result.job_id}`,
          () =>
            db
              .update(stories)
              .set({ summary: null, lastSeenAt: createdAt })
              .where(eq(stories.id, payload.storyId)),
        );
      }
      return {
        jobType: job.type,
        rebuildStories:
          job.type !== "neutral_story_summary" &&
          job.type !== "safety_compliance_check",
        queueProjectionSync:
          job.type === "neutral_story_summary" ||
          job.type === "safety_compliance_check",
      };
    }
    const structuredOutput = result.structured_output;

    switch (job.type) {
      case "article_extraction_qa": {
        const payload = decodeArticleExtractionQaPayload(job.payload);
        if (!isArticleExtractionQaOutput(structuredOutput)) {
          return {
            jobType: job.type,
            rebuildStories: false,
            queueProjectionSync: false,
          };
        }
        yield* tryCanonical(
          `Failed to apply article QA result ${result.job_id}`,
          () =>
            db
              .update(articles)
              .set({
                type: structuredOutput.article_type,
                crawlStatus: structuredOutput.extraction_valid
                  ? undefined
                  : "extraction_failed",
              })
              .where(eq(articles.id, payload.article.articleId)),
        );
        return {
          jobType: job.type,
          rebuildStories: true,
          queueProjectionSync: false,
        };
      }
      case "claim_extraction": {
        const payload = decodeClaimExtractionPayload(job.payload);
        if (!isClaimExtractionOutput(structuredOutput)) {
          return {
            jobType: job.type,
            rebuildStories: false,
            queueProjectionSync: false,
          };
        }
        yield* tryCanonical(
          `Failed to reset claims for article ${payload.article.articleId}`,
          () => db.delete(claims).where(eq(claims.articleId, payload.article.articleId)),
        );
        if (structuredOutput.claims.length > 0) {
          yield* tryCanonical(
            `Failed to persist claims for article ${payload.article.articleId}`,
            () =>
              db.insert(claims).values(
                structuredOutput.claims.map((claim) => ({
                  articleId: payload.article.articleId,
                  claimText: claim.text,
                  speaker: claim.speaker,
                  confidence: claim.confidence,
                  createdAt,
                })),
              ),
          );
        }
        return {
          jobType: job.type,
          rebuildStories: true,
          queueProjectionSync: false,
        };
      }
      case "story_clustering_support":
        return {
          jobType: job.type,
          rebuildStories: true,
          queueProjectionSync: false,
        };
      case "bias_context_classification":
      case "factuality_reliability_support":
      case "ownership_extraction_support": {
        const payload = decodeSourceAnalysisPayload(job.payload);
        const [existing] = yield* tryCanonical(
          `Failed to load source rating for ${payload.sourceId}`,
          () =>
            db
              .select()
              .from(sourceRatings)
              .where(eq(sourceRatings.sourceId, payload.sourceId))
              .orderBy(desc(sourceRatings.publishedAt), desc(sourceRatings.createdAt))
              .limit(1),
        );
        const publishable = canUseInAggregateLabels(result.confidence);
        const next = {
          taxonomyBucket: existing?.taxonomyBucket ?? "unrated",
          ownershipCategory: existing?.ownershipCategory ?? null,
          reliabilityBand: existing?.reliabilityBand ?? null,
          evidence: existing?.evidence ?? [],
          publishedAt: existing?.publishedAt ?? null,
        };

        if (job.type === "bias_context_classification" && isBiasContextOutput(structuredOutput)) {
          if (structuredOutput.publishable && publishable) {
            next.taxonomyBucket = structuredOutput.taxonomy_bucket;
            next.publishedAt = createdAt;
          }
        }

        if (job.type === "factuality_reliability_support" && isFactualityOutput(structuredOutput)) {
          if (publishable) {
            next.reliabilityBand = structuredOutput.reliability_band;
            next.publishedAt = next.publishedAt ?? createdAt;
          }
        }

        if (job.type === "ownership_extraction_support" && isOwnershipOutput(structuredOutput)) {
          if (structuredOutput.publishable && publishable) {
            next.ownershipCategory = structuredOutput.ownership_category;
            next.evidence = structuredOutput.citations.map((url) => ({
              url,
              note: "ai_inferred_ownership",
            }));
            next.publishedAt = createdAt;
          }
        }

        yield* tryCanonical(
          `Failed to persist source rating for ${payload.sourceId}`,
          () =>
            db.insert(sourceRatings).values({
              sourceId: payload.sourceId,
              taxonomyBucket: next.taxonomyBucket,
              ownershipCategory: next.ownershipCategory,
              reliabilityBand: next.reliabilityBand,
              confidence: result.confidence,
              evidence: next.evidence,
              publishedAt: next.publishedAt,
              createdAt,
            }),
        );
        return {
          jobType: job.type,
          rebuildStories: true,
          queueProjectionSync: false,
        };
      }
      case "neutral_story_summary": {
        const payload = decodeNeutralStorySummaryPayload(job.payload);
        if (!isStorySummaryOutput(structuredOutput)) {
          return {
            jobType: job.type,
            rebuildStories: false,
            queueProjectionSync: false,
          };
        }
        if (canPublishPublicAiOutput(result.confidence)) {
          yield* tryCanonical(
            `Failed to update story summary for ${payload.storyId}`,
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
                .where(eq(stories.id, payload.storyId)),
          );
        }
        return {
          jobType: job.type,
          rebuildStories: false,
          queueProjectionSync: false,
          safetyJobPayload: {
            storyId: payload.storyId,
            storyTitle: payload.storyTitle,
            summary: structuredOutput,
            articles: payload.articles,
          },
        };
      }
      case "safety_compliance_check": {
        const payload = decodeSafetyCompliancePayload(job.payload);
        if (!isSafetyOutput(structuredOutput)) {
          return {
            jobType: job.type,
            rebuildStories: false,
            queueProjectionSync: true,
          };
        }
        if (!(structuredOutput.safe_to_publish && canPublishPublicAiOutput(result.confidence))) {
          yield* tryCanonical(
            `Failed to clear unsafe story summary for ${payload.storyId}`,
            () =>
              db
                .update(stories)
                .set({ summary: null, lastSeenAt: createdAt })
                .where(eq(stories.id, payload.storyId)),
          );
        }
        return {
          jobType: job.type,
          rebuildStories: false,
          queueProjectionSync: true,
        };
      }
    }
  });

export const enqueueSafetyComplianceJob = (
  databaseUrl: string,
  input: SafetyComplianceJobPayload,
): Effect.Effect<void, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;

    yield* tryCanonical(
      `Failed to enqueue safety compliance job for story ${input.storyId}`,
      () =>
        db.insert(aiJobs).values({
          type: "safety_compliance_check",
          status: "pending",
          priority: 5,
          payload: input,
          inputArtifactIds: [input.storyId, ...input.articles.map((article) => article.id)],
          leasedBy: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        }),
    );
  });

export const failAiJobInCanonicalStore = (
  databaseUrl: string,
  input: {
    readonly jobId: string;
    readonly error: string;
  },
): Effect.Effect<void, CanonicalStoreError> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;

    yield* tryCanonical(`Failed to mark AI job ${input.jobId} as failed`, () =>
      db
        .update(aiJobs)
        .set({
          status: "failed",
          leasedBy: null,
          leaseExpiresAt: null,
          lastError: input.error,
          updatedAt: now,
        })
        .where(eq(aiJobs.id, input.jobId)),
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

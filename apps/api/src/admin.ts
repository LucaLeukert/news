import { api } from "@news/convex";
import {
  aiJobEvents,
  aiJobs,
  aiResults,
  articles,
  createDb,
  sourceFeeds,
  sources,
  stories,
} from "@news/db";
import {
  type AdminAiJobDetail,
  type AdminAiJobListItem,
  type OperationsSnapshot,
  adminAiJobDetailSchema,
  adminAiJobListItemSchema,
  decodeUnknownSync,
  manualArticleIntakeResultSchema,
  operationsSnapshotSchema,
  reingestFailedVerificationResultSchema,
  storySummaryLooksSuspicious,
} from "@news/types";
import { ConvexHttpClient } from "convex/browser";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { ingestArticleUrls } from "../../../services/crawler/src/manual-intake";
import { reingestFailedVerificationArticles } from "../../../services/crawler/src/reingest";

class AdminStoreError extends Data.TaggedError("AdminStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const decodeOperationsSnapshot = decodeUnknownSync(operationsSnapshotSchema);
const decodeAdminAiJobListItem = decodeUnknownSync(adminAiJobListItemSchema);
const decodeAdminAiJobDetail = decodeUnknownSync(adminAiJobDetailSchema);
const decodeManualArticleIntakeResult = decodeUnknownSync(
  manualArticleIntakeResultSchema,
);
const decodeReingestFailedVerificationResult = decodeUnknownSync(
  reingestFailedVerificationResultSchema,
);

const tryAdmin = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new AdminStoreError({ message, cause }),
  });

const toIso = (value: Date | null | undefined) => value?.toISOString() ?? null;

const countValue = <T extends { count: number | string | bigint }>(
  row: T | undefined,
) => Number(row?.count ?? 0);

export const loadOperationsSnapshot = (input: {
  readonly databaseUrl: string;
  readonly convexUrl?: string;
}): Effect.Effect<OperationsSnapshot, AdminStoreError> =>
  Effect.gen(function* () {
    const db = createDb(input.databaseUrl);

    const [
      sourceCountRows,
      feedCountRows,
      articleCountRows,
      storyCountRows,
      heldSummaryCountRows,
      pendingJobsRows,
      leasedJobsRows,
      completedJobsRows,
      failedJobsRows,
      latestAiResultRows,
      sourceFeedRows,
      aiJobRows,
      storyRows,
      projectedStories,
    ] = yield* Effect.all([
      tryAdmin("Failed to count sources", () =>
        db.select({ count: sql<number>`count(*)` }).from(sources),
      ),
      tryAdmin("Failed to count source feeds", () =>
        db.select({ count: sql<number>`count(*)` }).from(sourceFeeds),
      ),
      tryAdmin("Failed to count articles", () =>
        db.select({ count: sql<number>`count(*)` }).from(articles),
      ),
      tryAdmin("Failed to count stories", () =>
        db.select({ count: sql<number>`count(*)` }).from(stories),
      ),
      tryAdmin("Failed to count held summaries", () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(stories)
          .where(isNull(stories.summary)),
      ),
      tryAdmin("Failed to count pending AI jobs", () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(aiJobs)
          .where(eq(aiJobs.status, "pending")),
      ),
      tryAdmin("Failed to count leased AI jobs", () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(aiJobs)
          .where(eq(aiJobs.status, "leased")),
      ),
      tryAdmin("Failed to count completed AI jobs", () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(aiJobs)
          .where(eq(aiJobs.status, "completed")),
      ),
      tryAdmin("Failed to count failed AI jobs", () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(aiJobs)
          .where(
            inArray(aiJobs.status, ["failed", "failed_schema_validation"]),
          ),
      ),
      tryAdmin("Failed to load latest AI result timestamp", () =>
        db
          .select({ createdAt: aiResults.createdAt })
          .from(aiResults)
          .orderBy(desc(aiResults.createdAt))
          .limit(1),
      ),
      tryAdmin("Failed to load source feed status", () =>
        db
          .select({
            sourceId: sources.id,
            sourceName: sources.name,
            domain: sources.domain,
            countryCode: sources.countryCode,
            primaryLanguage: sources.primaryLanguage,
            rssOnly: sources.rssOnly,
            noSnippet: sources.noSnippet,
            doNotCrawl: sources.doNotCrawl,
            feedId: sourceFeeds.id,
            feedUrl: sourceFeeds.feedUrl,
            validationState: sourceFeeds.validationState,
            lastFetchedAt: sourceFeeds.lastFetchedAt,
          })
          .from(sourceFeeds)
          .innerJoin(sources, eq(sourceFeeds.sourceId, sources.id))
          .orderBy(desc(sourceFeeds.lastFetchedAt), sources.name)
          .limit(16),
      ),
      tryAdmin("Failed to load AI job status", () =>
        db
          .select({
            id: aiJobs.id,
            type: aiJobs.type,
            status: aiJobs.status,
            priority: aiJobs.priority,
            attempts: aiJobs.attempts,
            leasedBy: aiJobs.leasedBy,
            leaseExpiresAt: aiJobs.leaseExpiresAt,
            lastError: aiJobs.lastError,
            createdAt: aiJobs.createdAt,
            updatedAt: aiJobs.updatedAt,
          })
          .from(aiJobs)
          .orderBy(desc(aiJobs.updatedAt), desc(aiJobs.createdAt))
          .limit(20),
      ),
      tryAdmin("Failed to load story sync status", () =>
        db
          .select({
            storyId: stories.id,
            title: stories.title,
            summary: stories.summary,
            lastSeenAt: stories.lastSeenAt,
          })
          .from(stories)
          .orderBy(desc(stories.lastSeenAt))
          .limit(20),
      ),
      input.convexUrl
        ? tryAdmin("Failed to load projected stories from Convex", () => {
            const client = new ConvexHttpClient(input.convexUrl as string);
            return client.query(api.storyProjections.listStories, {});
          })
        : Effect.succeed([]),
    ]);

    const projectedById = new Map(
      projectedStories.map((story) => [story.id, story] as const),
    );

    const storySync = storyRows.map((story) => {
      const projection = projectedById.get(story.storyId);
      const suspiciousSummary =
        story.summary !== null &&
        storySummaryLooksSuspicious(story.summary as never);
      return {
        storyId: story.storyId,
        title: story.title,
        lastSeenAt: story.lastSeenAt.toISOString(),
        hasSummary: story.summary !== null,
        suspiciousSummary,
        projected: projection !== undefined,
        projectionLastSeenAt: projection?.lastSeenAt ?? null,
        projectionSyncedAt: null,
      };
    });

    return decodeOperationsSnapshot({
      overview: {
        sourceCount: countValue(sourceCountRows[0]),
        feedCount: countValue(feedCountRows[0]),
        articleCount: countValue(articleCountRows[0]),
        storyCount: countValue(storyCountRows[0]),
        projectedStoryCount: projectedStories.length,
        syncedStoryCount: storyRows.filter((story) =>
          projectedById.has(story.storyId),
        ).length,
        heldSummaryCount: countValue(heldSummaryCountRows[0]),
        suspiciousSummaryCount: storySync.filter(
          (story) => story.suspiciousSummary,
        ).length,
        aiJobsPending: countValue(pendingJobsRows[0]),
        aiJobsLeased: countValue(leasedJobsRows[0]),
        aiJobsCompleted: countValue(completedJobsRows[0]),
        aiJobsFailed: countValue(failedJobsRows[0]),
        latestAiResultAt: toIso(latestAiResultRows[0]?.createdAt),
      },
      sourceFeeds: sourceFeedRows.map((row) => ({
        ...row,
        lastFetchedAt: toIso(row.lastFetchedAt),
      })),
      aiJobs: aiJobRows.map((row) => ({
        ...row,
        leasedBy: row.leasedBy ?? null,
        leaseExpiresAt: toIso(row.leaseExpiresAt),
        lastError: row.lastError ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      storySync,
    });
  });

const _clearSuspiciousStorySummaries = (
  databaseUrl: string,
): Effect.Effect<
  {
    readonly affectedStoryIds: ReadonlyArray<string>;
    readonly affectedJobIds: ReadonlyArray<string>;
  },
  AdminStoreError
> =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const suspiciousResults = yield* tryAdmin(
      "Failed to load suspicious AI story summaries",
      () =>
        db
          .select({
            jobId: aiResults.jobId,
            structuredOutput: aiResults.structuredOutput,
          })
          .from(aiResults)
          .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
          .where(
            and(
              eq(aiJobs.type, "neutral_story_summary"),
              eq(aiResults.validationStatus, "valid"),
            ),
          )
          .orderBy(desc(aiResults.createdAt)),
    );

    const affectedJobIds = suspiciousResults
      .filter((row) =>
        storySummaryLooksSuspicious(row.structuredOutput as never),
      )
      .map((row) => row.jobId);

    if (affectedJobIds.length === 0) {
      return { affectedStoryIds: [], affectedJobIds: [] };
    }

    const suspiciousStories = yield* tryAdmin(
      "Failed to load suspicious public story summaries",
      () =>
        db
          .select({
            storyId: stories.id,
            summary: stories.summary,
          })
          .from(stories)
          .where(sql`${stories.summary} is not null`),
    );

    const affectedStoryIds = suspiciousStories
      .filter((row) => storySummaryLooksSuspicious(row.summary as never))
      .map((row) => row.storyId);

    yield* tryAdmin("Failed to mark suspicious AI results invalid", () =>
      db
        .update(aiResults)
        .set({ validationStatus: "failed_schema_validation" })
        .where(inArray(aiResults.jobId, affectedJobIds)),
    );

    yield* tryAdmin("Failed to mark suspicious AI jobs invalid", () =>
      db
        .update(aiJobs)
        .set({
          status: "failed_schema_validation",
          lastError: "semantic_validation: suspicious story summary output",
        })
        .where(inArray(aiJobs.id, affectedJobIds)),
    );

    if (affectedStoryIds.length > 0) {
      yield* tryAdmin("Failed to clear suspicious public story summaries", () =>
        db
          .update(stories)
          .set({ summary: null })
          .where(inArray(stories.id, affectedStoryIds)),
      );
    }

    return { affectedStoryIds, affectedJobIds };
  });

export const listAdminAiJobs = (input: {
  readonly databaseUrl: string;
  readonly limit?: number;
}): Effect.Effect<ReadonlyArray<AdminAiJobListItem>, AdminStoreError> =>
  Effect.gen(function* () {
    const db = createDb(input.databaseUrl);
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const [jobs, results, events] = yield* Effect.all([
      tryAdmin("Failed to load admin AI jobs", () =>
        db
          .select()
          .from(aiJobs)
          .orderBy(desc(aiJobs.updatedAt), desc(aiJobs.createdAt))
          .limit(limit),
      ),
      tryAdmin("Failed to load admin AI job results", () =>
        db
          .select({
            jobId: aiResults.jobId,
            validationStatus: aiResults.validationStatus,
            createdAt: aiResults.createdAt,
          })
          .from(aiResults)
          .orderBy(desc(aiResults.createdAt)),
      ),
      tryAdmin("Failed to load admin AI job event counts", () =>
        db
          .select({
            jobId: aiJobEvents.jobId,
            count: sql<number>`count(*)`,
          })
          .from(aiJobEvents)
          .groupBy(aiJobEvents.jobId),
      ),
    ]);

    const latestResultByJobId = new Map<
      string,
      { readonly validationStatus: string; readonly createdAt: Date }
    >();
    for (const result of results) {
      if (!latestResultByJobId.has(result.jobId)) {
        latestResultByJobId.set(result.jobId, result);
      }
    }

    const eventCountByJobId = new Map(
      events.map((event) => [event.jobId, Number(event.count)] as const),
    );

    return jobs.map((job) =>
      decodeAdminAiJobListItem({
        ...job,
        inputArtifactIds: job.inputArtifactIds,
        leasedBy: job.leasedBy ?? null,
        leaseExpiresAt: toIso(job.leaseExpiresAt),
        lastError: job.lastError ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        latestResultAt: toIso(latestResultByJobId.get(job.id)?.createdAt),
        latestResultValidationStatus:
          latestResultByJobId.get(job.id)?.validationStatus ?? null,
        eventCount: eventCountByJobId.get(job.id) ?? 0,
      }),
    );
  });

export const getAdminAiJobDetail = (input: {
  readonly databaseUrl: string;
  readonly jobId: string;
}): Effect.Effect<AdminAiJobDetail | null, AdminStoreError> =>
  Effect.gen(function* () {
    const db = createDb(input.databaseUrl);
    const [jobRows, resultRows, eventRows] = yield* Effect.all([
      tryAdmin(`Failed to load admin AI job ${input.jobId}`, () =>
        db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1),
      ),
      tryAdmin(`Failed to load AI results for job ${input.jobId}`, () =>
        db
          .select()
          .from(aiResults)
          .where(eq(aiResults.jobId, input.jobId))
          .orderBy(desc(aiResults.createdAt)),
      ),
      tryAdmin(`Failed to load AI events for job ${input.jobId}`, () =>
        db
          .select()
          .from(aiJobEvents)
          .where(eq(aiJobEvents.jobId, input.jobId))
          .orderBy(desc(aiJobEvents.createdAt)),
      ),
    ]);

    const job = jobRows[0];
    if (!job) {
      return null;
    }

    return decodeAdminAiJobDetail({
      job: {
        ...job,
        payload: job.payload,
        inputArtifactIds: job.inputArtifactIds,
        leasedBy: job.leasedBy ?? null,
        leaseExpiresAt: toIso(job.leaseExpiresAt),
        lastError: job.lastError ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
      results: resultRows.map((result) => ({
        id: result.id,
        jobId: result.jobId,
        modelName: result.modelName,
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion,
        inputArtifactIds: result.inputArtifactIds,
        outputSchemaVersion: result.outputSchemaVersion,
        structuredOutput: result.structuredOutput,
        confidence: result.confidence,
        reasons: result.reasons,
        citationsToInputIds: result.citationsToInputIds,
        validationStatus: result.validationStatus,
        latencyMs: result.latencyMs,
        createdAt: result.createdAt.toISOString(),
      })),
      events: eventRows.map((event) => ({
        id: event.id,
        jobId: event.jobId,
        attemptNumber: event.attemptNumber,
        level: event.level,
        eventType: event.eventType,
        message: event.message,
        details: event.details,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  });

export const ingestAdminArticleUrls = (input: {
  readonly databaseUrl: string;
  readonly urls: ReadonlyArray<string>;
}) =>
  ingestArticleUrls(input.databaseUrl, {
    urls: input.urls,
  }).pipe(
    Effect.map((result) => decodeManualArticleIntakeResult(result)),
    Effect.mapError(
      (cause) =>
        new AdminStoreError({
          message: "Failed to ingest admin article URLs",
          cause,
        }),
    ),
  );

export const runAdminFailedVerificationReingest = (input: {
  readonly databaseUrl: string;
  readonly statuses?: ReadonlyArray<
    | "rss_mismatch_title"
    | "rss_mismatch_date"
    | "canonical_failed"
    | "extraction_failed"
  >;
  readonly sourceDomain?: string | null;
  readonly limit?: number;
  readonly overrideTitleMismatches?: boolean;
}) =>
  reingestFailedVerificationArticles(input.databaseUrl, {
    statuses: input.statuses,
    sourceDomain: input.sourceDomain,
    limit: input.limit,
    overrideTitleMismatches: input.overrideTitleMismatches,
  }).pipe(
    Effect.map((result) => decodeReingestFailedVerificationResult(result)),
    Effect.mapError(
      (cause) =>
        new AdminStoreError({
          message: "Failed to reingest failed-verification articles",
          cause,
        }),
    ),
  );

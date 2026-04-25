import { api } from "@news/convex";
import {
  aiJobs,
  aiResults,
  articles,
  createDb,
  sourceFeeds,
  sources,
  stories,
} from "@news/db";
import {
  decodeUnknownSync,
  operationsSnapshotSchema,
  storySummaryLooksSuspicious,
  type OperationsSnapshot,
} from "@news/types";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ConvexHttpClient } from "convex/browser";
import { Data, Effect } from "effect";

class AdminStoreError extends Data.TaggedError("AdminStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const decodeOperationsSnapshot = decodeUnknownSync(operationsSnapshotSchema);

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

export const clearSuspiciousStorySummaries = (
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

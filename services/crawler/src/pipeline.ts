import { clusterArticles, type ClusterableArticle } from "@news/clusterer";
import {
  aiJobs,
  aiResults,
  articles,
  articleVersions,
  entities,
  createDb,
  sourceFeeds,
  sourceRatings,
  sources,
  stories,
  storyArticles,
  storyEntities,
  storyMetrics,
} from "@news/db";
import { normalizeUrl, type CrawlValidationState } from "@news/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Data, DateTime, Effect } from "effect";

export type SeedSourceInput = {
  readonly sourceName: string;
  readonly sourceDomain: string;
  readonly feedUrl: string;
  readonly countryCode?: string | null;
  readonly primaryLanguage?: string | null;
  readonly rssOnly?: boolean;
  readonly noSnippet?: boolean;
};

export type IngestedFeedItem = {
  readonly item: {
    readonly title: string;
    readonly url: string;
    readonly publishedAt: string | null;
    readonly sourceName: string | null;
  };
  readonly metadata?: {
    readonly canonicalUrl: string;
    readonly title: string | null;
    readonly description: string | null;
    readonly author: string | null;
    readonly publishedAt: string | null;
    readonly language: string | null;
    readonly paywalled: boolean;
  };
  readonly validationState: CrawlValidationState;
};

class CrawlPipelineError extends Data.TaggedError("CrawlPipelineError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const tryPipeline = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new CrawlPipelineError({ message, cause }),
  });

const currentDate = DateTime.now.pipe(Effect.map(DateTime.toDateUtc));

const normalizeDomain = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();

const toNullableDate = (value: string | null | undefined) =>
  value ? DateTime.toDateUtc(DateTime.makeUnsafe(value)) : null;

const toOptionalString = (value: string | null | undefined) =>
  value ?? undefined;

const toOptionalDate = (value: string | null | undefined) =>
  toNullableDate(value) ?? undefined;

const snippetFromDescription = (
  description: string | null | undefined,
  noSnippet: boolean,
) => {
  if (noSnippet || !description) return undefined;
  const clean = description.replace(/\s+/g, " ").trim();
  return clean.length > 500 ? clean.slice(0, 500) : clean;
};

const storySummaryPayloadFor = (cluster: {
  readonly story: { readonly id: string; readonly title: string };
  readonly articles: ReadonlyArray<ClusterableArticle>;
}) => ({
  storyId: cluster.story.id,
  storyTitle: cluster.story.title,
  articles: cluster.articles.map((article) => ({
    id: article.id,
    title: article.title,
    snippet: article.snippet,
    source: article.publisher,
  })),
});

const clusteringSupportPayloadFor = (cluster: {
  readonly story: { readonly id: string; readonly title: string };
  readonly articles: ReadonlyArray<ClusterableArticle>;
}) => ({
  storyId: cluster.story.id,
  storyTitle: cluster.story.title,
  articles: cluster.articles.map((article) => ({
    id: article.id,
    title: article.title,
    snippet: article.snippet,
    source: article.publisher,
  })),
});

const normalizeEntityKey = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const STORY_REBUILD_LOCK_ID = 448_210_01;

const feedValidationStateFromResults = (
  results: ReadonlyArray<IngestedFeedItem>,
): CrawlValidationState | null => {
  if (results.some((item) => item.validationState === "rss_verified")) {
    return "rss_verified";
  }
  return results[0]?.validationState ?? null;
};

export const ensureSourceWithFeed = (
  databaseUrl: string,
  input: SeedSourceInput,
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const sourceDomain = normalizeDomain(input.sourceDomain);
    const feedUrl = normalizeUrl(input.feedUrl);

    const [source] = yield* tryPipeline(
      `Failed to upsert source ${sourceDomain}`,
      () =>
        db
          .insert(sources)
          .values({
            name: input.sourceName,
            domain: sourceDomain,
            countryCode: input.countryCode ?? null,
            primaryLanguage: input.primaryLanguage ?? null,
            rssOnly: input.rssOnly ?? false,
            noSnippet: input.noSnippet ?? false,
          })
          .onConflictDoUpdate({
            target: sources.domain,
            set: {
              name: input.sourceName,
              countryCode: input.countryCode ?? null,
              primaryLanguage: input.primaryLanguage ?? null,
              rssOnly: input.rssOnly ?? false,
              noSnippet: input.noSnippet ?? false,
              updatedAt: now,
            },
          })
          .returning({ id: sources.id, noSnippet: sources.noSnippet }),
    );
    if (!source) {
      return yield* new CrawlPipelineError({
        message: `Source upsert returned no row for ${sourceDomain}`,
      });
    }

    const [feed] = yield* tryPipeline(`Failed to upsert feed ${feedUrl}`, () =>
      db
        .insert(sourceFeeds)
        .values({
          sourceId: source.id,
          feedUrl,
        })
        .onConflictDoUpdate({
          target: sourceFeeds.feedUrl,
          set: {
            sourceId: source.id,
          },
        })
        .returning({ id: sourceFeeds.id, feedUrl: sourceFeeds.feedUrl }),
    );
    if (!feed) {
      return yield* new CrawlPipelineError({
        message: `Feed upsert returned no row for ${feedUrl}`,
      });
    }

    return {
      sourceId: source.id,
      feedId: feed.id,
      feedUrl: feed.feedUrl,
      noSnippet: source.noSnippet,
    };
  });

export const persistFeedResults = (
  databaseUrl: string,
  input: {
    readonly sourceId: string;
    readonly feedId: string;
    readonly noSnippet: boolean;
    readonly results: ReadonlyArray<IngestedFeedItem>;
  },
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const persistedArticleIds: string[] = [];

    for (const result of input.results) {
      const metadata = result.metadata;
      const title = metadata?.title;
      if (!metadata || !title) {
        continue;
      }

      const snippet = snippetFromDescription(
        metadata.description,
        input.noSnippet,
      );
      const canonicalUrl = normalizeUrl(metadata.canonicalUrl);
      const [article] = yield* tryPipeline(
        `Failed to upsert article ${canonicalUrl}`,
        () =>
          db
            .insert(articles)
            .values({
              sourceId: input.sourceId,
              canonicalUrl,
              title,
              snippet,
              author: toOptionalString(metadata.author),
              publishedAt: toOptionalDate(metadata.publishedAt),
              updatedAt: now,
              language: toOptionalString(metadata.language),
              type: "unknown",
              paywalled: metadata.paywalled,
              crawlStatus: result.validationState,
            })
            .onConflictDoUpdate({
              target: articles.canonicalUrl,
              set: {
                sourceId: input.sourceId,
                title,
                snippet,
                author: toOptionalString(metadata.author),
                publishedAt: toOptionalDate(metadata.publishedAt),
                updatedAt: now,
                language: toOptionalString(metadata.language),
                paywalled: metadata.paywalled,
                crawlStatus: result.validationState,
              },
            })
            .returning({ id: articles.id }),
      );
      if (!article) {
        return yield* new CrawlPipelineError({
          message: `Article upsert returned no row for ${canonicalUrl}`,
        });
      }

      persistedArticleIds.push(article.id);

      yield* tryPipeline(
        `Failed to insert article version for ${canonicalUrl}`,
        () =>
          db.insert(articleVersions).values({
            articleId: article.id,
            title,
            snippet,
            metadata: {
              feedTitle: result.item.title,
              feedPublishedAt: result.item.publishedAt,
              validationState: result.validationState,
              canonicalUrl,
            },
            capturedAt: now,
          }),
      );
    }

    yield* tryPipeline(`Failed to update feed ${input.feedId}`, () =>
      db
        .update(sourceFeeds)
        .set({
          lastFetchedAt: now,
          validationState: feedValidationStateFromResults(input.results),
        })
        .where(eq(sourceFeeds.id, input.feedId)),
    );

    return {
      persistedArticleIds,
      persistedCount: persistedArticleIds.length,
    };
  });

const loadClusterableArticles = (databaseUrl: string) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const [articleRows, ratingRows, claimResultRows, clusteringSupportRows] =
      yield* Effect.all([
        tryPipeline("Failed to load articles for clustering", () =>
          db
            .select({
              article: articles,
              source: sources,
            })
            .from(articles)
            .innerJoin(sources, eq(articles.sourceId, sources.id))
            .orderBy(desc(articles.publishedAt), desc(articles.createdAt)),
        ),
        tryPipeline("Failed to load source ratings for clustering", () =>
          db
            .select()
            .from(sourceRatings)
            .orderBy(desc(sourceRatings.createdAt)),
        ),
        tryPipeline("Failed to load claim extraction AI results", () =>
          db
            .select({
              inputArtifactIds: aiResults.inputArtifactIds,
              structuredOutput: aiResults.structuredOutput,
            })
            .from(aiResults)
            .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
            .where(
              and(
                eq(aiJobs.type, "claim_extraction"),
                eq(aiResults.validationStatus, "valid"),
              ),
            ),
        ),
        tryPipeline("Failed to load clustering-support AI results", () =>
          db
            .select({
              inputArtifactIds: aiResults.inputArtifactIds,
              structuredOutput: aiResults.structuredOutput,
            })
            .from(aiResults)
            .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
            .where(
              and(
                eq(aiJobs.type, "story_clustering_support"),
                eq(aiResults.validationStatus, "valid"),
              ),
            ),
        ),
      ]);

    const latestRatings = new Map<string, (typeof ratingRows)[number]>();
    for (const rating of ratingRows) {
      if (!latestRatings.has(rating.sourceId)) {
        latestRatings.set(rating.sourceId, rating);
      }
    }

    const articleEntityKeys = new Map<string, Set<string>>();
    for (const row of claimResultRows) {
      const claimsOutput = row.structuredOutput as {
        claims?: Array<{ entities?: string[] }>;
      };
      for (const articleId of row.inputArtifactIds) {
        const keys = articleEntityKeys.get(articleId) ?? new Set<string>();
        for (const claim of claimsOutput.claims ?? []) {
          for (const entity of claim.entities ?? []) {
            const normalized = normalizeEntityKey(entity);
            if (normalized.length > 0) {
              keys.add(normalized);
            }
          }
        }
        articleEntityKeys.set(articleId, keys);
      }
    }

    const articleSemanticCues = new Map<string, Set<string>>();
    const articleFingerprints = new Map<string, string>();
    for (const row of clusteringSupportRows) {
      const supportOutput = row.structuredOutput as {
        fingerprint?: string;
        same_event_candidates?: string[];
      };
      for (const articleId of row.inputArtifactIds) {
        if (supportOutput.fingerprint) {
          articleFingerprints.set(articleId, supportOutput.fingerprint);
        }
        const cues = articleSemanticCues.get(articleId) ?? new Set<string>();
        for (const phrase of supportOutput.same_event_candidates ?? []) {
          const normalized = normalizeEntityKey(phrase);
          if (normalized.length > 0) {
            cues.add(normalized);
          }
        }
        articleSemanticCues.set(articleId, cues);
      }
    }

    return articleRows.map(({ article, source }) => {
      const rating = latestRatings.get(source.id);
      return {
        id: article.id,
        sourceId: article.sourceId,
        canonicalUrl: article.canonicalUrl,
        title: article.title,
        snippet: article.snippet,
        author: article.author,
        publishedAt: article.publishedAt?.toISOString() ?? null,
        language: article.language,
        articleType: article.type,
        paywalled: article.paywalled,
        crawlStatus: article.crawlStatus,
        publisher: source.name,
        country: source.countryCode,
        taxonomyBucket: rating?.taxonomyBucket,
        ownershipCategory: rating?.ownershipCategory ?? null,
        reliabilityBand: rating?.reliabilityBand ?? null,
        aiEntityKeys: [
          ...(articleEntityKeys.get(article.id) ?? new Set<string>()),
        ],
        semanticCuePhrases: [
          ...(articleSemanticCues.get(article.id) ?? new Set<string>()),
        ],
        semanticFingerprint: articleFingerprints.get(article.id) ?? null,
      } satisfies ClusterableArticle;
    });
  });

const populateStoryEntities = (
  databaseUrl: string,
  clusters: ReadonlyArray<{
    readonly story: { readonly id: string };
    readonly articles: ReadonlyArray<ClusterableArticle>;
  }>,
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);

    for (const cluster of clusters) {
      const entityConfidence = new Map<string, number>();
      for (const article of cluster.articles) {
        for (const key of article.aiEntityKeys ?? []) {
          entityConfidence.set(
            key,
            Math.max(entityConfidence.get(key) ?? 0, 0.75),
          );
        }
        for (const key of article.semanticCuePhrases ?? []) {
          entityConfidence.set(
            key,
            Math.max(entityConfidence.get(key) ?? 0, 0.6),
          );
        }
      }

      for (const [canonicalKey, confidence] of entityConfidence) {
        const [existing] = yield* tryPipeline(
          `Failed to load entity ${canonicalKey}`,
          () =>
            db
              .select()
              .from(entities)
              .where(eq(entities.canonicalKey, canonicalKey))
              .limit(1),
        );
        const entityId =
          existing?.id ??
          (yield* tryPipeline(`Failed to create entity ${canonicalKey}`, () =>
            db
              .insert(entities)
              .values({
                name: canonicalKey.replace(/-/g, " "),
                type: "ai_extracted",
                canonicalKey,
              })
              .returning({ id: entities.id }),
          ))[0]?.id;

        if (!entityId) {
          continue;
        }

        yield* tryPipeline(
          `Failed to link entity ${canonicalKey} to story ${cluster.story.id}`,
          () =>
            db.insert(storyEntities).values({
              storyId: cluster.story.id,
              entityId,
              confidence,
            }),
        );
      }
    }
  });

const enqueueArticleAndSourceAiJobs = (
  databaseUrl: string,
  input: {
    readonly sourceId: string;
    readonly articleIds: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    if (input.articleIds.length === 0) {
      return {
        articleJobCount: 0,
        sourceJobCount: 0,
      };
    }

    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const articleRows = yield* tryPipeline(
      "Failed to load articles for AI enqueue",
      () =>
        db
          .select({
            article: articles,
            source: sources,
          })
          .from(articles)
          .innerJoin(sources, eq(articles.sourceId, sources.id))
          .where(inArray(articles.id, [...input.articleIds])),
    );
    const first = articleRows[0];
    if (!first) {
      return {
        articleJobCount: 0,
        sourceJobCount: 0,
      };
    }

    const articleJobs: Array<typeof aiJobs.$inferInsert> = [];
    for (const row of articleRows) {
      const payload = {
        article: {
          articleId: row.article.id,
          sourceId: row.source.id,
          sourceName: row.source.name,
          sourceDomain: row.source.domain,
          countryCode: row.source.countryCode,
          title: row.article.title,
          snippet: row.article.snippet,
          author: row.article.author,
          publishedAt: row.article.publishedAt?.toISOString() ?? null,
          language: row.article.language,
          canonicalUrl: row.article.canonicalUrl,
        },
      };

      articleJobs.push(
        {
          type: "article_extraction_qa",
          status: "pending",
          priority: 10,
          payload,
          inputArtifactIds: [row.article.id],
          leasedBy: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          type: "claim_extraction",
          status: "pending",
          priority: 15,
          payload,
          inputArtifactIds: [row.article.id],
          leasedBy: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
      );
    }

    const sourcePayload = {
      sourceId: first.source.id,
      sourceName: first.source.name,
      domain: first.source.domain,
      countryCode: first.source.countryCode,
      primaryLanguage: first.source.primaryLanguage,
      recentArticleTitles: articleRows
        .map((row) => row.article.title)
        .slice(0, 8),
    };
    const sourceJobs: Array<typeof aiJobs.$inferInsert> = [
      {
        type: "bias_context_classification",
        status: "pending",
        priority: 20,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        type: "factuality_reliability_support",
        status: "pending",
        priority: 25,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        type: "ownership_extraction_support",
        status: "pending",
        priority: 30,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    yield* tryPipeline("Failed to enqueue article AI jobs", () =>
      db.insert(aiJobs).values(articleJobs),
    );
    yield* tryPipeline("Failed to enqueue source AI jobs", () =>
      db.insert(aiJobs).values(sourceJobs),
    );

    return {
      articleJobCount: articleJobs.length,
      sourceJobCount: sourceJobs.length,
    };
  });

export const rebuildStoriesAndQueueAiJobs = (
  databaseUrl: string,
  options: {
    readonly includeClusteringSupportJobs?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const rebuild = Effect.gen(function* () {
      const now = yield* currentDate;
      const clusterableArticles = yield* loadClusterableArticles(databaseUrl);
      const clusters = clusterArticles(clusterableArticles);

      yield* Effect.logInfo("Rebuilding stories with clustered articles", {
        articleCount: clusterableArticles.length,
        storyCount: clusters.length,
        clusters: clusters.map((cluster): typeof stories.$inferInsert => ({
          id: cluster.story.id,
          title: cluster.story.title,
          summary: null,
          topicTags: [...cluster.story.topicTags],
          firstSeenAt: toNullableDate(cluster.story.firstSeenAt) ?? now,
          lastSeenAt: toNullableDate(cluster.story.lastSeenAt) ?? now,
          disabledAt: null,
        })),
      });

      yield* tryPipeline("Failed to reset story entities", () =>
        db.delete(storyEntities),
      );
      yield* tryPipeline("Failed to reset story/article links", () =>
        db.delete(storyArticles),
      );
      yield* tryPipeline("Failed to reset story metrics", () =>
        db.delete(storyMetrics),
      );
      yield* tryPipeline("Failed to reset stories", () => db.delete(stories));

      if (clusters.length === 0) {
        return {
          storyCount: 0,
          aiJobCount: 0,
        };
      }

      yield* tryPipeline("Failed to insert clustered stories", () =>
        db.insert(stories).values(
          clusters.map((cluster): typeof stories.$inferInsert => ({
            id: cluster.story.id,
            title: cluster.story.title,
            summary: null,
            topicTags: [...cluster.story.topicTags],
            firstSeenAt: toNullableDate(cluster.story.firstSeenAt) ?? now,
            lastSeenAt: toNullableDate(cluster.story.lastSeenAt) ?? now,
            disabledAt: null,
          })),
        ),
      );

      yield* tryPipeline("Failed to insert story/article links", () =>
        db.insert(storyArticles).values(
          clusters.flatMap((cluster) =>
            cluster.articles.map(
              (article): typeof storyArticles.$inferInsert => ({
                storyId: cluster.story.id,
                articleId: article.id,
                clusterConfidence: cluster.articleScores[article.id] ?? 0,
                createdAt: now,
              }),
            ),
          ),
        ),
      );

      yield* tryPipeline("Failed to insert story metrics", () =>
        db.insert(storyMetrics).values(
          clusters.map((cluster): typeof storyMetrics.$inferInsert => ({
            storyId: cluster.story.id,
            byCountry: cluster.story.coverage.byCountry,
            byLanguage: cluster.story.coverage.byLanguage,
            byTaxonomy: cluster.story.coverage.byTaxonomy,
            byOwnership: cluster.story.coverage.byOwnership,
            byReliability: cluster.story.coverage.byReliability,
            updatedAt: now,
          })),
        ),
      );
      yield* populateStoryEntities(databaseUrl, clusters);

      yield* tryPipeline("Failed to clear pending story-level AI jobs", () =>
        db
          .delete(aiJobs)
          .where(
            and(
              inArray(
                aiJobs.type,
                options.includeClusteringSupportJobs === false
                  ? ["neutral_story_summary"]
                  : ["story_clustering_support", "neutral_story_summary"],
              ),
              eq(aiJobs.status, "pending"),
            ),
          ),
      );

      yield* tryPipeline("Failed to enqueue story-level AI jobs", () =>
        db.insert(aiJobs).values(
          clusters.flatMap((cluster): Array<typeof aiJobs.$inferInsert> => {
            const jobs: Array<typeof aiJobs.$inferInsert> = [];
            if (options.includeClusteringSupportJobs !== false) {
              jobs.push({
                type: "story_clustering_support",
                status: "pending",
                priority: Math.max(1, 60 - cluster.articles.length),
                payload: clusteringSupportPayloadFor(cluster),
                inputArtifactIds: cluster.articles.map((article) => article.id),
                leasedBy: null,
                leaseExpiresAt: null,
                attempts: 0,
                lastError: null,
                createdAt: now,
                updatedAt: now,
              });
            }
            jobs.push({
              type: "neutral_story_summary",
              status: "pending",
              priority: Math.max(1, 100 - cluster.articles.length),
              payload: storySummaryPayloadFor(cluster),
              inputArtifactIds: cluster.articles.map((article) => article.id),
              leasedBy: null,
              leaseExpiresAt: null,
              attempts: 0,
              lastError: null,
              createdAt: now,
              updatedAt: now,
            });
            return jobs;
          }),
        ),
      );

      return {
        storyCount: clusters.length,
        aiJobCount:
          clusters.length *
          (options.includeClusteringSupportJobs === false ? 1 : 2),
      };
    });

    yield* tryPipeline("Failed to acquire story rebuild lock", () =>
      db.execute(sql`select pg_advisory_lock(${STORY_REBUILD_LOCK_ID})`),
    );
    return yield* rebuild.pipe(
      Effect.ensuring(
        tryPipeline("Failed to release story rebuild lock", () =>
          db.execute(sql`select pg_advisory_unlock(${STORY_REBUILD_LOCK_ID})`),
        ).pipe(
          Effect.catchIf(
            () => true,
            () => Effect.void,
          ),
          Effect.orDie,
        ),
      ),
    );
  });

export const runSeededFeedIngestion = (
  databaseUrl: string,
  input: SeedSourceInput & {
    readonly results: ReadonlyArray<IngestedFeedItem>;
  },
) =>
  Effect.gen(function* () {
    const seeded = yield* ensureSourceWithFeed(databaseUrl, input);
    const persisted = yield* persistFeedResults(databaseUrl, {
      sourceId: seeded.sourceId,
      feedId: seeded.feedId,
      noSnippet: seeded.noSnippet,
      results: input.results,
    });
    const enqueued = yield* enqueueArticleAndSourceAiJobs(databaseUrl, {
      sourceId: seeded.sourceId,
      articleIds: persisted.persistedArticleIds,
    });
    const clustered = yield* rebuildStoriesAndQueueAiJobs(databaseUrl);

    return {
      sourceId: seeded.sourceId,
      feedId: seeded.feedId,
      persistedArticleCount: persisted.persistedCount,
      articleAiJobCount: enqueued.articleJobCount,
      sourceAiJobCount: enqueued.sourceJobCount,
      storyCount: clustered.storyCount,
      aiJobCount:
        clustered.aiJobCount +
        enqueued.articleJobCount +
        enqueued.sourceJobCount,
    };
  });

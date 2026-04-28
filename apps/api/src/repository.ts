import {
  articleWithPublisherSchema,
  coverageDistributionSchema,
  decodeUnknownSync,
  sourceSchema,
  storySummarySchema,
  type ArticleWithPublisher,
  type Source,
  type Story,
  type StoryListQuery,
  normalizeUrl,
} from "@news/types";
import {
  articles,
  createDb,
  entities,
  sourceRatings,
  sources,
  stories,
  storyArticles,
  storyEntities,
  storyMetrics,
} from "@news/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Context, Data, DateTime, Effect, Layer } from "effect";
import { demoArticles, demoStory } from "./fixtures";

export type SourceProfile = Source & {
  crawlMetadata: {
    robotsAllowed: boolean;
    maxRequestsPerHour: number;
    rssOnly: boolean;
    noSnippet: boolean;
  };
  ratings: {
    published: boolean;
    reason: string;
  };
  ownership: string | null;
};

export type StoryDetail = {
  story: Story;
  articles: ArticleWithPublisher[];
};

class RepositoryError extends Data.TaggedError("RepositoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface NewsRepositoryShape {
  listStories(query: StoryListQuery): Effect.Effect<Story[], RepositoryError>;
  getStory(id: string): Effect.Effect<StoryDetail | null, RepositoryError>;
  getArticle(
    id: string,
  ): Effect.Effect<ArticleWithPublisher | null, RepositoryError>;
  getSource(id: string): Effect.Effect<SourceProfile | null, RepositoryError>;
  search(
    query: string,
  ): Effect.Effect<
    { stories: Story[]; articles: ArticleWithPublisher[] },
    RepositoryError
  >;
  resolveUrl(
    url: string,
  ): Effect.Effect<
    { storyId: string | null; articleId: string | null },
    RepositoryError
  >;
}

export class NewsRepository extends Context.Service<
  NewsRepository,
  NewsRepositoryShape
>()("@news/api/NewsRepository") {}

const sourceProfiles = Object.fromEntries(
  demoArticles.map((article) => [
    article.sourceId,
    {
      id: article.sourceId,
      name: article.publisher,
      domain: new URL(article.canonicalUrl).hostname,
      countryCode: article.country,
      primaryLanguage: article.language,
      rssOnly: false,
      noSnippet: false,
      doNotCrawl: false,
      crawlMetadata: {
        robotsAllowed: true,
        maxRequestsPerHour: 60,
        rssOnly: false,
        noSnippet: false,
      },
      ratings: {
        published: false,
        reason: "insufficient_context",
      },
      ownership: null,
    } satisfies SourceProfile,
  ]),
);

function storyMatchesQuery(story: Story, query: StoryListQuery) {
  if (query.topic && !story.topicTags.includes(query.topic)) return false;
  if (query.country && !story.coverage.byCountry[query.country]) return false;
  if (query.language && !story.coverage.byLanguage[query.language])
    return false;
  if (query.imbalance) {
    const countryCounts = Object.values(story.coverage.byCountry);
    const total = countryCounts.reduce((sum, count) => sum + count, 0);
    const largest = Math.max(0, ...countryCounts);
    if (total === 0 || largest / total < 0.6) return false;
  }
  return true;
}

function articleMatchesQuery(
  article: ArticleWithPublisher,
  query: StoryListQuery,
) {
  if (query.country && article.country !== query.country) return false;
  if (query.language && article.language !== query.language) return false;
  if (query.source && article.sourceId !== query.source) return false;
  return true;
}

function matchesText(value: string | null | undefined, query: string) {
  return value?.toLowerCase().includes(query) ?? false;
}

const decodeSummary = decodeUnknownSync(storySummarySchema);
const decodeCoverage = decodeUnknownSync(coverageDistributionSchema);
const decodeArticleWithPublisher = decodeUnknownSync(articleWithPublisherSchema);
const decodeSource = decodeUnknownSync(sourceSchema);

const emptyCoverage = decodeCoverage({
  byCountry: {},
  byLanguage: {},
  byTaxonomy: {},
  byOwnership: {},
  byReliability: {},
});

const toIso = (value: Date | string | null | undefined) =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? DateTime.formatIso(DateTime.makeUnsafe(value))
      : null;

const toStory = (row: {
  story: typeof stories.$inferSelect;
  metrics: typeof storyMetrics.$inferSelect | null;
}): Story => ({
  id: row.story.id,
  title: row.story.title,
  topicTags: row.story.topicTags,
  firstSeenAt: row.story.firstSeenAt.toISOString(),
  lastSeenAt: row.story.lastSeenAt.toISOString(),
  summary: row.story.summary ? decodeSummary(row.story.summary) : null,
  coverage: row.metrics
    ? decodeCoverage({
        byCountry: row.metrics.byCountry,
        byLanguage: row.metrics.byLanguage,
        byTaxonomy: row.metrics.byTaxonomy,
        byOwnership: row.metrics.byOwnership,
        byReliability: row.metrics.byReliability,
      })
    : emptyCoverage,
});

const toArticleWithPublisher = (row: {
  article: typeof articles.$inferSelect;
  source: typeof sources.$inferSelect;
}): ArticleWithPublisher =>
  decodeArticleWithPublisher({
    id: row.article.id,
    sourceId: row.article.sourceId,
    canonicalUrl: row.article.canonicalUrl,
    title: row.article.title,
    snippet: row.article.snippet,
    author: row.article.author,
    publishedAt: toIso(row.article.publishedAt),
    language: row.article.language,
    articleType: row.article.type,
    paywalled: row.article.paywalled,
    crawlStatus: row.article.crawlStatus,
    publisher: row.source.name,
    country: row.source.countryCode,
  });

const tryRepository = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new RepositoryError({ message, cause }),
  });

const matchingStoryIdsForQuery = (
  databaseUrl: string,
  query: StoryListQuery,
) =>
  Effect.gen(function* () {
    if (!query.country && !query.language && !query.source && !query.entity) {
      return null;
    }

    const db = createDb(databaseUrl);
    const storyIds = new Set<string>();

    if (query.country || query.language || query.source) {
      const articleFilters = [
        query.language ? eq(articles.language, query.language) : undefined,
        query.source ? eq(articles.sourceId, query.source) : undefined,
        query.country ? eq(sources.countryCode, query.country) : undefined,
      ].filter((value) => value !== undefined);

      const articleRows = yield* tryRepository(
        "Failed to load matching stories for query",
        () =>
          db
            .selectDistinct({ storyId: storyArticles.storyId })
            .from(storyArticles)
            .innerJoin(articles, eq(storyArticles.articleId, articles.id))
            .innerJoin(sources, eq(articles.sourceId, sources.id))
            .where(articleFilters.length > 0 ? and(...articleFilters) : undefined),
      );

      for (const row of articleRows) {
        storyIds.add(row.storyId);
      }
    }

    if (query.entity) {
      const entity = query.entity;
      const entityRows = yield* tryRepository(
        "Failed to load matching entities for query",
        () =>
          db
            .selectDistinct({ storyId: storyEntities.storyId })
            .from(storyEntities)
            .innerJoin(entities, eq(storyEntities.entityId, entities.id))
            .where(
              or(
                eq(entities.id, entity),
                eq(entities.name, entity),
                eq(entities.canonicalKey, entity),
              ),
            ),
      );

      const entityStoryIds = new Set(entityRows.map((row) => row.storyId));

      if (
        storyIds.size === 0 &&
        !query.country &&
        !query.language &&
        !query.source
      ) {
        return entityStoryIds;
      }

      return new Set(
        [...storyIds].filter((storyId) => entityStoryIds.has(storyId)),
      );
    }

    return storyIds;
  });

export function makePostgresRepository(databaseUrl: string): NewsRepositoryShape {
  return {
    listStories(query) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const matchingStoryIds = yield* matchingStoryIdsForQuery(
          databaseUrl,
          query,
        );

        if (matchingStoryIds && matchingStoryIds.size === 0) {
          return [];
        }

        const rows = yield* tryRepository("Failed to list stories", () =>
          db
            .select({
              story: stories,
              metrics: storyMetrics,
            })
            .from(stories)
            .leftJoin(storyMetrics, eq(stories.id, storyMetrics.storyId))
            .where(
              matchingStoryIds
                ? inArray(stories.id, [...matchingStoryIds])
                : undefined,
            )
            .orderBy(desc(stories.lastSeenAt)),
        );

        return rows
          .map((row) => toStory(row))
          .filter((story) => storyMatchesQuery(story, query));
      });
    },

    getStory(id) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const storyRows = yield* tryRepository(`Failed to load story ${id}`, () =>
          db
            .select({
              story: stories,
              metrics: storyMetrics,
            })
            .from(stories)
            .leftJoin(storyMetrics, eq(stories.id, storyMetrics.storyId))
            .where(eq(stories.id, id))
            .limit(1),
        );

        const row = storyRows[0];
        if (!row) return null;

        const articleRows = yield* tryRepository(
          `Failed to load story articles for ${id}`,
          () =>
            db
              .select({
                article: articles,
                source: sources,
              })
              .from(storyArticles)
              .innerJoin(articles, eq(storyArticles.articleId, articles.id))
              .innerJoin(sources, eq(articles.sourceId, sources.id))
              .where(eq(storyArticles.storyId, id))
              .orderBy(desc(articles.publishedAt), desc(articles.createdAt)),
        );

        return {
          story: toStory(row),
          articles: articleRows.map((articleRow) =>
            toArticleWithPublisher(articleRow),
          ),
        };
      });
    },

    getArticle(id) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const rows = yield* tryRepository(`Failed to load article ${id}`, () =>
          db
            .select({
              article: articles,
              source: sources,
            })
            .from(articles)
            .innerJoin(sources, eq(articles.sourceId, sources.id))
            .where(eq(articles.id, id))
            .limit(1),
        );

        const row = rows[0];
        return row ? toArticleWithPublisher(row) : null;
      });
    },

    getSource(id) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const sourceRows = yield* tryRepository(`Failed to load source ${id}`, () =>
          db.select().from(sources).where(eq(sources.id, id)).limit(1),
        );
        const source = sourceRows[0];

        if (!source) return null;

        const ratingsRows = yield* tryRepository(
          `Failed to load source ratings for ${id}`,
          () =>
            db
              .select()
              .from(sourceRatings)
              .where(eq(sourceRatings.sourceId, id))
              .orderBy(desc(sourceRatings.createdAt))
              .limit(1),
        );
        const rating = ratingsRows[0] ?? null;

        const base = decodeSource({
          id: source.id,
          name: source.name,
          domain: source.domain,
          countryCode: source.countryCode,
          primaryLanguage: source.primaryLanguage,
          rssOnly: source.rssOnly,
          noSnippet: source.noSnippet,
          doNotCrawl: source.doNotCrawl,
        });

        return {
          ...base,
          crawlMetadata: {
            robotsAllowed: source.robotsAllowed,
            maxRequestsPerHour: source.maxRequestsPerHour,
            rssOnly: source.rssOnly,
            noSnippet: source.noSnippet,
          },
          ratings: {
            published: Boolean(rating?.publishedAt),
            reason: rating?.taxonomyBucket ?? "insufficient_context",
          },
          ownership: rating?.ownershipCategory ?? null,
        };
      });
    },

    search(rawQuery) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const query = rawQuery.trim().toLowerCase();
        if (!query) return { stories: [], articles: [] };

        const [storyRows, articleRows] = yield* Effect.all([
          tryRepository("Failed to search stories", () =>
            db
              .select({
                story: stories,
                metrics: storyMetrics,
              })
              .from(stories)
              .leftJoin(storyMetrics, eq(stories.id, storyMetrics.storyId))
              .orderBy(desc(stories.lastSeenAt))
              .limit(100),
          ),
          tryRepository("Failed to search articles", () =>
            db
              .select({
                article: articles,
                source: sources,
              })
              .from(articles)
              .innerJoin(sources, eq(articles.sourceId, sources.id))
              .orderBy(desc(articles.publishedAt), desc(articles.createdAt))
              .limit(200),
          ),
        ]);

        const matchedArticles = articleRows
          .map((row) => toArticleWithPublisher(row))
          .filter(
            (article) =>
              matchesText(article.title, query) ||
              matchesText(article.snippet, query) ||
              matchesText(article.publisher, query) ||
              matchesText(article.country, query) ||
              matchesText(article.language, query),
          );

        const matchedStoryIds = new Set<string>();
        for (const article of matchedArticles) {
          const articleStoryRows = yield* tryRepository(
            `Failed to load story links for article ${article.id}`,
            () =>
              db
                .select({ storyId: storyArticles.storyId })
                .from(storyArticles)
                .where(eq(storyArticles.articleId, article.id)),
          );
          for (const storyRow of articleStoryRows) {
            matchedStoryIds.add(storyRow.storyId);
          }
        }

        const matchedStories = storyRows
          .map((row) => toStory(row))
          .filter(
            (story) =>
              matchesText(story.title, query) ||
              story.topicTags.some((tag) => matchesText(tag, query)) ||
              matchedStoryIds.has(story.id),
          );

        return { stories: matchedStories, articles: matchedArticles };
      });
    },

    resolveUrl(url) {
      return Effect.gen(function* () {
        const db = createDb(databaseUrl);
        const normalized = normalizeUrl(url);

        const directRows = yield* tryRepository(
          `Failed to resolve URL ${normalized}`,
          () =>
            db
              .select({
                articleId: articles.id,
                storyId: storyArticles.storyId,
                canonicalUrl: articles.canonicalUrl,
              })
              .from(articles)
              .leftJoin(storyArticles, eq(articles.id, storyArticles.articleId))
              .where(eq(articles.canonicalUrl, normalized))
              .limit(1),
        );

        const direct = directRows[0];
        if (direct) {
          return {
            storyId: direct.storyId ?? null,
            articleId: direct.articleId,
          };
        }

        const fallbackRows = yield* tryRepository(
          `Failed to resolve fallback URL ${normalized}`,
          () =>
            db
              .select({
                articleId: articles.id,
                storyId: storyArticles.storyId,
                canonicalUrl: articles.canonicalUrl,
              })
              .from(articles)
              .leftJoin(storyArticles, eq(articles.id, storyArticles.articleId))
              .limit(500),
        );

        const matched =
          fallbackRows.find(
            (candidate) => normalizeUrl(candidate.canonicalUrl) === normalized,
          ) ?? null;

        return {
          storyId: matched?.storyId ?? null,
          articleId: matched?.articleId ?? null,
        };
      });
    },
  };
}

export function makeFixtureRepository(): NewsRepositoryShape {
  return {
    listStories(query) {
      const stories = storyMatchesQuery(demoStory, query) ? [demoStory] : [];
      if (!query.country && !query.language && !query.source) {
        return Effect.succeed(stories);
      }

      return Effect.succeed(
        stories.filter((story) =>
          demoArticles.some(
            (article) =>
              articleMatchesQuery(article, query) && story.id === demoStory.id,
          ),
        ),
      );
    },

    getStory(id) {
      if (id !== demoStory.id) return Effect.succeed(null);
      return Effect.succeed({ story: demoStory, articles: demoArticles });
    },

    getArticle(id) {
      return Effect.succeed(
        demoArticles.find((article) => article.id === id) ?? null,
      );
    },

    getSource(id) {
      return Effect.succeed(sourceProfiles[id] ?? null);
    },

    search(rawQuery) {
      const query = rawQuery.trim().toLowerCase();
      if (!query) return Effect.succeed({ stories: [], articles: [] });

      const articles = demoArticles.filter(
        (article) =>
          matchesText(article.title, query) ||
          matchesText(article.snippet, query) ||
          matchesText(article.publisher, query) ||
          matchesText(article.country, query) ||
          matchesText(article.language, query),
      );
      const stories =
        matchesText(demoStory.title, query) ||
        demoStory.topicTags.some((tag) => matchesText(tag, query)) ||
        articles.length > 0
          ? [demoStory]
          : [];

      return Effect.succeed({ stories, articles });
    },

    resolveUrl(url) {
      return Effect.sync(() => {
        const normalized = normalizeUrl(url);
        const article =
          demoArticles.find(
            (candidate) => normalizeUrl(candidate.canonicalUrl) === normalized,
          ) ?? null;

        return {
          storyId: article ? demoStory.id : null,
          articleId: article?.id ?? null,
        };
      });
    },
  };
}

export const FixtureNewsRepositoryLive = Layer.succeed(
  NewsRepository,
  makeFixtureRepository(),
);

export const PostgresNewsRepositoryLive = (databaseUrl: string) =>
  Layer.succeed(NewsRepository, makePostgresRepository(databaseUrl));

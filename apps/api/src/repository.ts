import {
  type ArticleWithPublisher,
  type Source,
  type Story,
  type StoryListQuery,
  normalizeUrl,
} from "@news/types";
import { Context, Effect, Layer } from "effect";
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

export interface NewsRepositoryShape {
  listStories(query: StoryListQuery): Effect.Effect<Story[]>;
  getStory(id: string): Effect.Effect<StoryDetail | null>;
  getArticle(id: string): Effect.Effect<ArticleWithPublisher | null>;
  getSource(id: string): Effect.Effect<SourceProfile | null>;
  search(
    query: string,
  ): Effect.Effect<{ stories: Story[]; articles: ArticleWithPublisher[] }>;
  resolveUrl(
    url: string,
  ): Effect.Effect<{ storyId: string | null; articleId: string | null }>;
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

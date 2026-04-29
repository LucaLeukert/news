import "server-only";

import { api } from "@news/convex";
import { env } from "@news/env/next";
import {
  type Story,
  type StoryDetail,
  decodeUnknownSync,
  demoStory,
  storyDetailSchema,
} from "@news/shared";
import { ConvexHttpClient } from "convex/browser";
import { fetchQuery } from "convex/nextjs";
import { Effect } from "effect";
import { makePostgresRepository } from "../../api/src/repository";

const isDemoFallbackStories = (stories: ReadonlyArray<Story>) =>
  stories.length === 1 && stories[0]?.id === demoStory.id;

const isRealStoryList = (stories: ReadonlyArray<Story>) =>
  stories.some((story) => story.id !== demoStory.id);

const decodePublicStoryDetail = decodeUnknownSync(storyDetailSchema);

type ProjectionSummary = {
  neutralSummary: string;
  agreed: string[];
  differs: string[];
  contestedOrUnverified: string[];
  confidence: number;
  lastUpdatedAt: string;
} | null;

const toProjectionSummary = (summary: Story["summary"]): ProjectionSummary =>
  summary
    ? {
        neutralSummary: summary.neutralSummary,
        agreed: [...summary.agreed],
        differs: [...summary.differs],
        contestedOrUnverified: [...summary.contestedOrUnverified],
        confidence: summary.confidence,
        lastUpdatedAt: summary.lastUpdatedAt,
      }
    : null;

const toProjectionCoverage = (coverage: Story["coverage"]) => ({
  byCountry: { ...coverage.byCountry },
  byLanguage: { ...coverage.byLanguage },
  byTaxonomy: { ...coverage.byTaxonomy },
  byOwnership: { ...coverage.byOwnership },
  byReliability: { ...coverage.byReliability },
});

const toProjectionStory = (story: Story, syncedAt: string) => ({
  storyId: story.id,
  title: story.title,
  topicTags: [...story.topicTags],
  firstSeenAt: story.firstSeenAt,
  lastSeenAt: story.lastSeenAt,
  summary: toProjectionSummary(story.summary),
  coverage: toProjectionCoverage(story.coverage),
  syncedAt,
});

const toProjectionStoryDetail = (detail: StoryDetail, syncedAt: string) => ({
  storyId: detail.story.id,
  story: {
    ...detail.story,
    topicTags: [...detail.story.topicTags],
    summary: toProjectionSummary(detail.story.summary),
    coverage: toProjectionCoverage(detail.story.coverage),
  },
  articles: detail.articles.map((article) => ({
    id: article.id,
    sourceId: article.sourceId,
    canonicalUrl: article.canonicalUrl,
    title: article.title,
    snippet: article.snippet,
    author: article.author,
    publishedAt: article.publishedAt,
    language: article.language,
    articleType: article.articleType,
    paywalled: article.paywalled,
    crawlStatus: article.crawlStatus,
  })),
  syncedAt,
});

async function syncPublicStoryProjectionsFromApi(): Promise<{
  stories: ReadonlyArray<Story>;
  details: ReadonlyArray<StoryDetail>;
} | null> {
  if (!env.DATABASE_URL || !env.NEXT_PUBLIC_CONVEX_URL) {
    return null;
  }

  const repository = makePostgresRepository(env.DATABASE_URL);
  const stories = await Effect.runPromise(repository.listStories({}));

  if (!isRealStoryList(stories)) {
    return null;
  }

  const details = await Effect.runPromise(
    Effect.all(
      stories.map((story) =>
        repository
          .getStory(story.id)
          .pipe(
            Effect.map((detail) =>
              decodePublicStoryDetail(detail ?? { story, articles: [] }),
            ),
          ),
      ),
    ),
  );

  const syncedAt = new Date().toISOString();
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

  await client.mutation(api.storyProjections.replacePublicProjectionsFromSync, {
    serviceToken: env.INTERNAL_SERVICE_TOKEN,
    stories: stories.map((story) => toProjectionStory(story, syncedAt)),
    details: details.map((detail) => toProjectionStoryDetail(detail, syncedAt)),
  });

  return { stories, details };
}

export async function loadPublicStories(): Promise<ReadonlyArray<Story>> {
  const stories = await fetchQuery(api.storyProjections.listStories, {});

  if (!isDemoFallbackStories(stories)) {
    return stories;
  }

  try {
    const synced = await syncPublicStoryProjectionsFromApi();
    return synced?.stories ?? stories;
  } catch {
    return stories;
  }
}

export async function loadPublicStoryDetail(
  id: string,
): Promise<StoryDetail | null> {
  const detail = await fetchQuery(api.storyProjections.getStory, { id });
  const parsedDetail = detail ? decodePublicStoryDetail(detail) : null;

  if (parsedDetail && parsedDetail.story.id !== demoStory.id) {
    return parsedDetail;
  }

  try {
    const synced = await syncPublicStoryProjectionsFromApi();
    return (
      synced?.details.find((storyDetail) => storyDetail.story.id === id) ??
      parsedDetail
    );
  } catch {
    return parsedDetail;
  }
}

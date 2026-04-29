import { loadServerEnv } from "@news/env";
import {
  type Story,
  type StoryDetail,
  demoArticles,
  demoStory,
} from "@news/shared";
import { v } from "convex/values";
import { Data, Effect } from "effect";
import { internalMutation, mutation, query } from "./_generated/server";

const storySummaryValidator = v.object({
  neutralSummary: v.string(),
  agreed: v.array(v.string()),
  differs: v.array(v.string()),
  contestedOrUnverified: v.array(v.string()),
  confidence: v.number(),
  lastUpdatedAt: v.string(),
});

const coverageValidator = v.object({
  byCountry: v.record(v.string(), v.number()),
  byLanguage: v.record(v.string(), v.number()),
  byTaxonomy: v.record(v.string(), v.number()),
  byOwnership: v.record(v.string(), v.number()),
  byReliability: v.record(v.string(), v.number()),
});

const storyValidator = v.object({
  id: v.string(),
  title: v.string(),
  topicTags: v.array(v.string()),
  firstSeenAt: v.string(),
  lastSeenAt: v.string(),
  summary: v.union(v.null(), storySummaryValidator),
  coverage: coverageValidator,
});

const articleValidator = v.object({
  id: v.string(),
  sourceId: v.string(),
  canonicalUrl: v.string(),
  title: v.string(),
  snippet: v.union(v.null(), v.string()),
  author: v.union(v.null(), v.string()),
  publishedAt: v.union(v.null(), v.string()),
  language: v.union(v.null(), v.string()),
  articleType: v.string(),
  paywalled: v.boolean(),
  crawlStatus: v.string(),
});

const storyProjectionValidator = v.object({
  storyId: v.string(),
  title: v.string(),
  topicTags: v.array(v.string()),
  firstSeenAt: v.string(),
  lastSeenAt: v.string(),
  summary: v.union(v.null(), storySummaryValidator),
  coverage: coverageValidator,
  syncedAt: v.string(),
});

const storyDetailProjectionValidator = v.object({
  storyId: v.string(),
  story: storyValidator,
  articles: v.array(articleValidator),
  syncedAt: v.string(),
});

const replaceProjectionArgsValidator = {
  stories: v.array(storyProjectionValidator),
  details: v.array(storyDetailProjectionValidator),
};

class UnauthorizedSyncError extends Data.TaggedError("UnauthorizedSyncError")<
  Record<never, never>
> {}

export const toStoryProjection = (story: Story, syncedAt: string) => ({
  storyId: story.id,
  title: story.title,
  topicTags: [...story.topicTags],
  firstSeenAt: story.firstSeenAt,
  lastSeenAt: story.lastSeenAt,
  summary: story.summary,
  coverage: {
    byCountry: { ...story.coverage.byCountry },
    byLanguage: { ...story.coverage.byLanguage },
    byTaxonomy: { ...story.coverage.byTaxonomy },
    byOwnership: { ...story.coverage.byOwnership },
    byReliability: { ...story.coverage.byReliability },
  },
  syncedAt,
});

export const toStoryDetailProjection = (
  detail: StoryDetail,
  syncedAt: string,
) => ({
  storyId: detail.story.id,
  story: {
    ...detail.story,
    topicTags: [...detail.story.topicTags],
    coverage: {
      byCountry: { ...detail.story.coverage.byCountry },
      byLanguage: { ...detail.story.coverage.byLanguage },
      byTaxonomy: { ...detail.story.coverage.byTaxonomy },
      byOwnership: { ...detail.story.coverage.byOwnership },
      byReliability: { ...detail.story.coverage.byReliability },
    },
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

const demoStoryDetail: StoryDetail = {
  story: demoStory,
  articles: demoArticles.map(
    ({ publisher: _publisher, country: _country, ...article }) => article,
  ),
};

export const listStories = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("public_stories")
      .withIndex("by_last_seen_at")
      .order("desc")
      .collect()
      .then((stories) => {
        if (stories.length === 0) {
          return [demoStory];
        }

        return stories.map(({ storyId, syncedAt: _syncedAt, ...story }) => ({
          ...story,
          id: storyId,
          coverage: {
            byCountry: { ...story.coverage.byCountry },
            byLanguage: { ...story.coverage.byLanguage },
            byTaxonomy: { ...story.coverage.byTaxonomy },
            byOwnership: { ...story.coverage.byOwnership },
            byReliability: { ...story.coverage.byReliability },
          },
        }));
      }),
});

export const getStory = query({
  args: {
    id: v.string(),
  },
  handler: (ctx, args) =>
    ctx.db
      .query("public_story_details")
      .withIndex("by_story_id", (q) => q.eq("storyId", args.id))
      .unique()
      .then((detail) => {
        if (!detail) {
          return args.id === demoStory.id ? demoStoryDetail : null;
        }

        return {
          story: {
            ...detail.story,
            coverage: {
              byCountry: { ...detail.story.coverage.byCountry },
              byLanguage: { ...detail.story.coverage.byLanguage },
              byTaxonomy: { ...detail.story.coverage.byTaxonomy },
              byOwnership: { ...detail.story.coverage.byOwnership },
              byReliability: { ...detail.story.coverage.byReliability },
            },
          },
          articles: detail.articles.map((article) => ({ ...article })),
        };
      }),
});

function replacePublicProjectionDocuments(
  ctx: any,
  args: {
    stories: Array<any>;
    details: Array<any>;
  },
) {
  return ctx.db
    .query("public_stories")
    .collect()
    .then((existingStories: Array<{ _id: string }>) =>
      Promise.all(existingStories.map((doc) => ctx.db.delete(doc._id))),
    )
    .then(() => ctx.db.query("public_story_details").collect())
    .then((existingDetails: Array<{ _id: string }>) =>
      Promise.all(existingDetails.map((doc) => ctx.db.delete(doc._id))),
    )
    .then(() =>
      Promise.all(
        args.stories.map((story) => ctx.db.insert("public_stories", story)),
      ),
    )
    .then(() =>
      Promise.all(
        args.details.map((detail) =>
          ctx.db.insert("public_story_details", detail),
        ),
      ),
    )
    .then(() => ({
      stories: args.stories.length,
      details: args.details.length,
    }));
}

export const replacePublicProjections = internalMutation({
  args: replaceProjectionArgsValidator,
  handler: (ctx, args) => replacePublicProjectionDocuments(ctx, args),
});

export const replacePublicProjectionsFromSync = mutation({
  args: {
    serviceToken: v.string(),
    ...replaceProjectionArgsValidator,
  },
  handler: (ctx, args) =>
    loadServerEnv(process.env).pipe(
      Effect.flatMap((env) =>
        args.serviceToken !== env.INTERNAL_SERVICE_TOKEN
          ? Effect.fail(new UnauthorizedSyncError())
          : Effect.promise(() => replacePublicProjectionDocuments(ctx, args)),
      ),
      Effect.runPromise,
    ),
});

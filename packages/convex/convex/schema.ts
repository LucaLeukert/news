import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  user_profiles: defineTable({
    externalUserId: v.string(),
    displayName: v.optional(v.string()),
    createdAt: v.string(),
  }).index("by_external_user", ["externalUserId"]),
  user_follows: defineTable({
    externalUserId: v.string(),
    targetType: v.union(
      v.literal("topic"),
      v.literal("source"),
      v.literal("entity"),
      v.literal("country"),
      v.literal("language"),
    ),
    targetId: v.string(),
    createdAt: v.string(),
  })
    .index("by_user", ["externalUserId"])
    .index("by_user_target", ["externalUserId", "targetType", "targetId"]),
  user_hidden_sources: defineTable({
    externalUserId: v.string(),
    sourceId: v.string(),
    createdAt: v.string(),
  })
    .index("by_user", ["externalUserId"])
    .index("by_user_source", ["externalUserId", "sourceId"]),
  user_hidden_topics: defineTable({
    externalUserId: v.string(),
    topic: v.string(),
    createdAt: v.string(),
  })
    .index("by_user", ["externalUserId"])
    .index("by_user_topic", ["externalUserId", "topic"]),
  saved_stories: defineTable({
    externalUserId: v.string(),
    storyId: v.string(),
    createdAt: v.string(),
  })
    .index("by_user", ["externalUserId"])
    .index("by_user_story", ["externalUserId", "storyId"]),
  public_stories: defineTable({
    storyId: v.string(),
    title: v.string(),
    topicTags: v.array(v.string()),
    firstSeenAt: v.string(),
    lastSeenAt: v.string(),
    summary: v.union(
      v.null(),
      v.object({
        neutralSummary: v.string(),
        agreed: v.array(v.string()),
        differs: v.array(v.string()),
        contestedOrUnverified: v.array(v.string()),
        confidence: v.number(),
        lastUpdatedAt: v.string(),
      }),
    ),
    coverage: v.object({
      byCountry: v.record(v.string(), v.number()),
      byLanguage: v.record(v.string(), v.number()),
      byTaxonomy: v.record(v.string(), v.number()),
      byOwnership: v.record(v.string(), v.number()),
      byReliability: v.record(v.string(), v.number()),
    }),
    syncedAt: v.string(),
  })
    .index("by_story_id", ["storyId"])
    .index("by_last_seen_at", ["lastSeenAt"]),
  public_story_details: defineTable({
    storyId: v.string(),
    story: v.object({
      id: v.string(),
      title: v.string(),
      topicTags: v.array(v.string()),
      firstSeenAt: v.string(),
      lastSeenAt: v.string(),
      summary: v.union(
        v.null(),
        v.object({
          neutralSummary: v.string(),
          agreed: v.array(v.string()),
          differs: v.array(v.string()),
          contestedOrUnverified: v.array(v.string()),
          confidence: v.number(),
          lastUpdatedAt: v.string(),
        }),
      ),
      coverage: v.object({
        byCountry: v.record(v.string(), v.number()),
        byLanguage: v.record(v.string(), v.number()),
        byTaxonomy: v.record(v.string(), v.number()),
        byOwnership: v.record(v.string(), v.number()),
        byReliability: v.record(v.string(), v.number()),
      }),
    }),
    articles: v.array(
      v.object({
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
      }),
    ),
    syncedAt: v.string(),
  }).index("by_story_id", ["storyId"]),
  feed_projections: defineTable({
    externalUserId: v.string(),
    storyId: v.string(),
    score: v.number(),
    reasons: v.array(v.string()),
    projectedAt: v.string(),
  }).index("by_user_score", ["externalUserId", "score"]),
  notifications: defineTable({
    externalUserId: v.string(),
    type: v.string(),
    body: v.string(),
    readAt: v.optional(v.string()),
    createdAt: v.string(),
  }).index("by_user", ["externalUserId"]),
});

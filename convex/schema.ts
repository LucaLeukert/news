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
  }).index("by_user", ["externalUserId"]),
  user_hidden_sources: defineTable({
    externalUserId: v.string(),
    sourceId: v.string(),
    createdAt: v.string(),
  }).index("by_user", ["externalUserId"]),
  user_hidden_topics: defineTable({
    externalUserId: v.string(),
    topic: v.string(),
    createdAt: v.string(),
  }).index("by_user", ["externalUserId"]),
  saved_stories: defineTable({
    externalUserId: v.string(),
    storyId: v.string(),
    createdAt: v.string(),
  }).index("by_user", ["externalUserId"]),
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

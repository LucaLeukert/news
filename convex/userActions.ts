import { v } from "convex/values";
import { Data, DateTime, Effect } from "effect";
import { mutation } from "./_generated/server";

const followTargetType = v.union(
  v.literal("topic"),
  v.literal("source"),
  v.literal("entity"),
  v.literal("country"),
  v.literal("language"),
);

const userActionResult = (
  status: "created" | "exists" | "deleted" | "missing",
  userId: string,
) => ({
  status,
  userId,
  projection: "convex" as const,
});

class ConvexUserActionError extends Data.TaggedError("ConvexUserActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type AuthenticatedCtx = {
  readonly auth: {
    readonly getUserIdentity: () => Promise<{
      readonly subject: string;
    } | null>;
  };
};

const requireUserId = (ctx: AuthenticatedCtx) =>
  Effect.tryPromise({
    try: () =>
      ctx.auth.getUserIdentity().then((identity) => {
        if (!identity) {
          throw new ConvexUserActionError({ message: "unauthorized" });
        }
        return identity.subject;
      }),
    catch: (cause) =>
      cause instanceof ConvexUserActionError
        ? cause
        : new ConvexUserActionError({
            message: "Failed to read Convex user identity",
            cause,
          }),
  });

const createdAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export const follow = mutation({
  args: {
    targetType: followTargetType,
    targetId: v.string(),
  },
  handler: (ctx, args) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const externalUserId = yield* requireUserId(ctx);
        const existing = yield* Effect.promise(() =>
          ctx.db
            .query("user_follows")
            .withIndex("by_user_target", (q) =>
              q
                .eq("externalUserId", externalUserId)
                .eq("targetType", args.targetType)
                .eq("targetId", args.targetId),
            )
            .unique(),
        );

        if (existing) return userActionResult("exists", externalUserId);

        const insertedAt = yield* createdAt;
        yield* Effect.promise(() =>
          ctx.db.insert("user_follows", {
            externalUserId,
            targetType: args.targetType,
            targetId: args.targetId,
            createdAt: insertedAt,
          }),
        );
        return userActionResult("created", externalUserId);
      }),
    ),
});

export const hideSource = mutation({
  args: {
    sourceId: v.string(),
  },
  handler: (ctx, args) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const externalUserId = yield* requireUserId(ctx);
        const existing = yield* Effect.promise(() =>
          ctx.db
            .query("user_hidden_sources")
            .withIndex("by_user_source", (q) =>
              q
                .eq("externalUserId", externalUserId)
                .eq("sourceId", args.sourceId),
            )
            .unique(),
        );

        if (existing) return userActionResult("exists", externalUserId);

        const insertedAt = yield* createdAt;
        yield* Effect.promise(() =>
          ctx.db.insert("user_hidden_sources", {
            externalUserId,
            sourceId: args.sourceId,
            createdAt: insertedAt,
          }),
        );
        return userActionResult("created", externalUserId);
      }),
    ),
});

export const hideTopic = mutation({
  args: {
    topic: v.string(),
  },
  handler: (ctx, args) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const externalUserId = yield* requireUserId(ctx);
        const existing = yield* Effect.promise(() =>
          ctx.db
            .query("user_hidden_topics")
            .withIndex("by_user_topic", (q) =>
              q.eq("externalUserId", externalUserId).eq("topic", args.topic),
            )
            .unique(),
        );

        if (existing) return userActionResult("exists", externalUserId);

        const insertedAt = yield* createdAt;
        yield* Effect.promise(() =>
          ctx.db.insert("user_hidden_topics", {
            externalUserId,
            topic: args.topic,
            createdAt: insertedAt,
          }),
        );
        return userActionResult("created", externalUserId);
      }),
    ),
});

export const saveStory = mutation({
  args: {
    storyId: v.string(),
  },
  handler: (ctx, args) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const externalUserId = yield* requireUserId(ctx);
        const existing = yield* Effect.promise(() =>
          ctx.db
            .query("saved_stories")
            .withIndex("by_user_story", (q) =>
              q
                .eq("externalUserId", externalUserId)
                .eq("storyId", args.storyId),
            )
            .unique(),
        );

        if (existing) return userActionResult("exists", externalUserId);

        const insertedAt = yield* createdAt;
        yield* Effect.promise(() =>
          ctx.db.insert("saved_stories", {
            externalUserId,
            storyId: args.storyId,
            createdAt: insertedAt,
          }),
        );
        return userActionResult("created", externalUserId);
      }),
    ),
});

export const deleteSavedStory = mutation({
  args: {
    storyId: v.string(),
  },
  handler: (ctx, args) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const externalUserId = yield* requireUserId(ctx);
        const existing = yield* Effect.promise(() =>
          ctx.db
            .query("saved_stories")
            .withIndex("by_user_story", (q) =>
              q
                .eq("externalUserId", externalUserId)
                .eq("storyId", args.storyId),
            )
            .unique(),
        );

        if (!existing) return userActionResult("missing", externalUserId);

        yield* Effect.promise(() => ctx.db.delete(existing._id));
        return userActionResult("deleted", externalUserId);
      }),
    ),
});

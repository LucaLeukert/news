import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { Data, DateTime, Effect } from "effect";

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

export const follow = mutationGeneric({
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
            .filter((q) =>
              q.and(
                q.eq(q.field("externalUserId"), externalUserId),
                q.eq(q.field("targetType"), args.targetType),
                q.eq(q.field("targetId"), args.targetId),
              ),
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

export const hideSource = mutationGeneric({
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
            .filter((q) =>
              q.and(
                q.eq(q.field("externalUserId"), externalUserId),
                q.eq(q.field("sourceId"), args.sourceId),
              ),
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

export const hideTopic = mutationGeneric({
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
            .filter((q) =>
              q.and(
                q.eq(q.field("externalUserId"), externalUserId),
                q.eq(q.field("topic"), args.topic),
              ),
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

export const saveStory = mutationGeneric({
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
            .filter((q) =>
              q.and(
                q.eq(q.field("externalUserId"), externalUserId),
                q.eq(q.field("storyId"), args.storyId),
              ),
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

export const deleteSavedStory = mutationGeneric({
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
            .filter((q) =>
              q.and(
                q.eq(q.field("externalUserId"), externalUserId),
                q.eq(q.field("storyId"), args.storyId),
              ),
            )
            .unique(),
        );

        if (!existing) return userActionResult("missing", externalUserId);

        yield* Effect.promise(() => ctx.db.delete(existing._id));
        return userActionResult("deleted", externalUserId);
      }),
    ),
});

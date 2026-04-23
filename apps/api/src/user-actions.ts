import {
  MetricsLive,
  MetricsService,
  type MetricsServiceShape,
} from "@news/platform";
import type {
  SaveStoryRequest,
  UserActionResult,
  UserFollowRequest,
  UserHideRequest,
} from "@news/types";
import { Context, Data, DateTime, Effect, Layer } from "effect";

export class UserActionError extends Data.TaggedError("UserActionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface UserActionsShape {
  readonly follow: (
    userId: string,
    request: UserFollowRequest,
  ) => Effect.Effect<UserActionResult, UserActionError>;
  readonly hide: (
    userId: string,
    request: UserHideRequest,
  ) => Effect.Effect<UserActionResult, UserActionError>;
  readonly saveStory: (
    userId: string,
    request: SaveStoryRequest,
  ) => Effect.Effect<UserActionResult, UserActionError>;
  readonly deleteSavedStory: (
    userId: string,
    storyId: string,
  ) => Effect.Effect<UserActionResult, UserActionError>;
}

export class UserActions extends Context.Service<
  UserActions,
  UserActionsShape
>()("@news/api/UserActions") {}

type PreferenceRecord = {
  readonly userId: string;
  readonly key: string;
  readonly createdAt: string;
};

const keyFor = (parts: readonly string[]) => parts.join(":");

const result = (
  status: UserActionResult["status"],
  userId: string,
): UserActionResult => ({
  status,
  userId,
  projection: "convex",
});

const upsertPreference = (
  store: Map<string, PreferenceRecord>,
  metrics: MetricsServiceShape,
  userId: string,
  key: string,
  kind: "follow" | "hide" | "saved_story",
) =>
  Effect.gen(function* () {
    if (store.has(key)) return result("exists", userId);
    const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    store.set(key, { userId, key, createdAt });
    yield* metrics.increment(
      kind === "saved_story"
        ? "user.saved_story_write"
        : "user.preference_write",
      { action: kind, status: "created" },
    );
    yield* Effect.logInfo("user.preference.created", { userId, key });
    return result("created", userId);
  });

export const makeFixtureUserActions = (
  metrics: MetricsServiceShape,
): UserActionsShape => {
  const follows = new Map<string, PreferenceRecord>();
  const hidden = new Map<string, PreferenceRecord>();
  const savedStories = new Map<string, PreferenceRecord>();

  return {
    follow: (userId, request) =>
      upsertPreference(
        follows,
        metrics,
        userId,
        keyFor([userId, request.targetType, request.targetId]),
        "follow",
      ),
    hide: (userId, request) =>
      upsertPreference(
        hidden,
        metrics,
        userId,
        keyFor([userId, request.targetType, request.targetId]),
        "hide",
      ),
    saveStory: (userId, request) =>
      upsertPreference(
        savedStories,
        metrics,
        userId,
        keyFor([userId, request.storyId]),
        "saved_story",
      ),
    deleteSavedStory: (userId, storyId) =>
      Effect.gen(function* () {
        const key = keyFor([userId, storyId]);
        if (!savedStories.delete(key)) return result("missing", userId);
        yield* metrics.increment("user.saved_story_write", {
          action: "delete",
          status: "deleted",
        });
        yield* Effect.logInfo("user.saved_story.deleted", { userId, storyId });
        return result("deleted", userId);
      }),
  };
};

export const FixtureUserActionsLayer = Layer.effect(
  UserActions,
  Effect.gen(function* () {
    const metrics = yield* MetricsService;
    return makeFixtureUserActions(metrics);
  }),
);

export const FixtureUserActionsLive = FixtureUserActionsLayer.pipe(
  Layer.provide(MetricsLive),
);

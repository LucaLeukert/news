import type {
  SaveStoryRequest,
  UserActionResult,
  UserFollowRequest,
  UserHideRequest,
} from "@news/types";
import { DateTime, Effect } from "effect";

export type FeedProjection = {
  userId: string;
  storyId: string;
  score: number;
  reasons: string[];
  projectedAt: string;
};

export function buildFeedProjection(input: {
  userId: string;
  storyId: string;
  followedTopicScore: number;
  followedRegionScore: number;
  hiddenPenalty: number;
  projectedAt: string;
}): FeedProjection {
  const score =
    input.followedTopicScore + input.followedRegionScore - input.hiddenPenalty;
  return {
    userId: input.userId,
    storyId: input.storyId,
    score,
    reasons: ["followed_topics", "followed_regions"].filter((reason) =>
      reason === "followed_topics"
        ? input.followedTopicScore > 0
        : input.followedRegionScore > 0,
    ),
    projectedAt: input.projectedAt,
  };
}

export const buildFeedProjectionEffect = (
  input: Omit<Parameters<typeof buildFeedProjection>[0], "projectedAt">,
) =>
  DateTime.now.pipe(
    Effect.map(DateTime.formatIso),
    Effect.map((projectedAt) => buildFeedProjection({ ...input, projectedAt })),
  );

export type ConvexUserAction =
  | {
      readonly table: "user_follows";
      readonly externalUserId: string;
      readonly targetType: UserFollowRequest["targetType"];
      readonly targetId: string;
    }
  | {
      readonly table: "user_hidden_sources";
      readonly externalUserId: string;
      readonly sourceId: string;
    }
  | {
      readonly table: "user_hidden_topics";
      readonly externalUserId: string;
      readonly topic: string;
    }
  | {
      readonly table: "saved_stories";
      readonly externalUserId: string;
      readonly storyId: string;
    };

export const userActionResult = (
  status: UserActionResult["status"],
  userId: string,
): UserActionResult => ({
  status,
  userId,
  projection: "convex",
});

export const buildFollowAction = (
  externalUserId: string,
  request: UserFollowRequest,
): ConvexUserAction => ({
  table: "user_follows",
  externalUserId,
  targetType: request.targetType,
  targetId: request.targetId,
});

export const buildHideAction = (
  externalUserId: string,
  request: UserHideRequest,
): ConvexUserAction =>
  request.targetType === "source"
    ? {
        table: "user_hidden_sources",
        externalUserId,
        sourceId: request.targetId,
      }
    : {
        table: "user_hidden_topics",
        externalUserId,
        topic: request.targetId,
      };

export const buildSavedStoryAction = (
  externalUserId: string,
  request: SaveStoryRequest,
): ConvexUserAction => ({
  table: "saved_stories",
  externalUserId,
  storyId: request.storyId,
});

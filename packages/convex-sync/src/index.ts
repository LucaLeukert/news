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

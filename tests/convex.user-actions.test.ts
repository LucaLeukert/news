import { describe, expect, it } from "vitest";
import {
  buildFollowAction,
  buildHideAction,
  buildSavedStoryAction,
  userActionResult,
} from "../packages/convex-sync/src";

const storyId = "00000000-0000-4000-8000-000000000001";

describe("Convex user actions", () => {
  it("models follows as Convex user-facing projection writes", () => {
    const action = buildFollowAction("user_1", {
      targetType: "topic",
      targetId: "economy",
    });

    expect(action).toEqual({
      table: "user_follows",
      externalUserId: "user_1",
      targetType: "topic",
      targetId: "economy",
    });
    expect(userActionResult("created", "user_1")).toEqual({
      status: "created",
      userId: "user_1",
      projection: "convex",
    });
  });

  it("routes hide actions to the matching Convex projection table", () => {
    expect(
      buildHideAction("user_1", {
        targetType: "topic",
        targetId: "sports",
      }),
    ).toEqual({
      table: "user_hidden_topics",
      externalUserId: "user_1",
      topic: "sports",
    });

    expect(
      buildHideAction("user_1", {
        targetType: "source",
        targetId: "00000000-0000-4000-8000-000000000011",
      }),
    ).toEqual({
      table: "user_hidden_sources",
      externalUserId: "user_1",
      sourceId: "00000000-0000-4000-8000-000000000011",
    });
  });

  it("models saved stories as Convex user-facing projection writes", () => {
    expect(buildSavedStoryAction("user_1", { storyId })).toEqual({
      table: "saved_stories",
      externalUserId: "user_1",
      storyId,
    });
    expect(userActionResult("deleted", "user_1")).toMatchObject({
      status: "deleted",
      projection: "convex",
    });
  });
});

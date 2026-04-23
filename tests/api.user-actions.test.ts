import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  FixtureUserActionsLive,
  UserActions,
  makeFixtureUserActions,
} from "../apps/api/src/user-actions";

const storyId = "00000000-0000-4000-8000-000000000001";
const testMetrics = {
  increment: () => Effect.void,
  gauge: () => Effect.void,
};

describe("fixture user actions", () => {
  it("records follows idempotently", () => {
    const actions = makeFixtureUserActions(testMetrics);

    const first = Effect.runSync(
      actions.follow("user_1", { targetType: "topic", targetId: "economy" }),
    );
    const second = Effect.runSync(
      actions.follow("user_1", { targetType: "topic", targetId: "economy" }),
    );

    expect(first).toEqual({
      status: "created",
      userId: "user_1",
      projection: "convex",
    });
    expect(second).toEqual({
      status: "exists",
      userId: "user_1",
      projection: "convex",
    });
  });

  it("saves and deletes stories idempotently", () => {
    const actions = makeFixtureUserActions(testMetrics);

    const saved = Effect.runSync(actions.saveStory("user_1", { storyId }));
    const deleted = Effect.runSync(actions.deleteSavedStory("user_1", storyId));
    const missing = Effect.runSync(actions.deleteSavedStory("user_1", storyId));

    expect(saved.status).toBe("created");
    expect(deleted.status).toBe("deleted");
    expect(missing.status).toBe("missing");
  });

  it("is available through an Effect layer", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const actions = yield* UserActions;
        return yield* actions.hide("user_1", {
          targetType: "topic",
          targetId: "sports",
        });
      }).pipe(Effect.provide(FixtureUserActionsLive)),
    );

    expect(result.status).toBe("created");
  });
});

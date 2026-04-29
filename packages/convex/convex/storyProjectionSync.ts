import { loadServerEnv } from "@news/env";
import { NewsRpcClient, NewsRpcClientLive } from "@news/platform";
import { DateTime, Effect } from "effect";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { toStoryDetailProjection, toStoryProjection } from "./storyProjections";

const replacePublicProjections: any = (internal as any).storyProjections
  .replacePublicProjections;

export const syncFromRpc = internalAction({
  args: {},
  handler: (ctx) =>
    Effect.runPromise(loadServerEnv(process.env)).then((env) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* NewsRpcClient;
          const stories = yield* rpc.listStories({});
          const details = yield* Effect.all(
            stories.map((story) =>
              rpc
                .getStory(story.id)
                .pipe(
                  Effect.map((detail) => detail ?? { story, articles: [] }),
                ),
            ),
          );
          const syncedAt = yield* DateTime.now.pipe(
            Effect.map(DateTime.formatIso),
          );

          const storyProjections = stories.map((story) =>
            toStoryProjection(story, syncedAt),
          );
          const detailProjections = details.map((detail) =>
            toStoryDetailProjection(detail, syncedAt),
          );

          return yield* Effect.promise(() =>
            ctx.runMutation(replacePublicProjections, {
              stories: storyProjections,
              details: detailProjections,
            }),
          );
        }).pipe(
          Effect.provide(
            NewsRpcClientLive({
              apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
              serviceToken:
                env.INTERNAL_SERVICE_TOKEN ??
                env.CLOUDFLARE_ACCESS_SERVICE_TOKEN_SECRET ??
                "local-dev",
            }),
          ),
        ),
      ),
    ),
});

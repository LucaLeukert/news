import { loadServerEnv } from "@news/env";
import {
  MetricsService,
  NewsRpcClient,
  NewsRpcClientLive,
  makeAppLayer,
} from "@news/platform";
import type { CrawlEnqueueRequest } from "@news/types";
import { DateTime, Effect, Layer } from "effect";

export interface Env {
  API_BASE_URL?: string;
  INTERNAL_SERVICE_TOKEN?: string;
}

const enqueue = (env: Env, kind: CrawlEnqueueRequest["kind"]) =>
  Effect.gen(function* () {
    const rpc = yield* NewsRpcClient;
    const metrics = yield* MetricsService;
    const scheduledAt = yield* DateTime.now.pipe(
      Effect.map(DateTime.formatIso),
    );
    yield* rpc.enqueueCrawl({ kind, scheduledAt });
    yield* metrics.increment("queue.depth", { kind });
  });

function runtimeEnv(env: Env) {
  return {
    NEXT_PUBLIC_API_BASE_URL: env.API_BASE_URL,
  };
}

export default {
  scheduled(event: ScheduledEvent, env: Env) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const parsedEnv = yield* loadServerEnv(runtimeEnv(env));
        const kind =
          event.cron === "*/10 * * * *" ? "rss_checks" : "stale_story_refresh";
        yield* enqueue(env, kind).pipe(
          Effect.provide(
            Layer.merge(
              makeAppLayer(parsedEnv),
              NewsRpcClientLive({
                apiBaseUrl: env.API_BASE_URL ?? "http://localhost:8787",
                serviceToken: env.INTERNAL_SERVICE_TOKEN ?? "local-dev",
              }),
            ),
          ),
        );
      }),
    );
  },
  fetch() {
    return new Response("scheduler ok");
  },
};

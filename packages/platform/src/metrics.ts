import { Context, Effect, Layer, Metric } from "effect";

export type MetricName =
  | "crawl.success"
  | "crawl.policy_block"
  | "crawl.rss_page_mismatch"
  | "crawl.extraction_failure"
  | "cluster.score"
  | "ai.job_latency_ms"
  | "ai.schema_failure"
  | "ai.confidence"
  | "ai.runner_uptime"
  | "queue.depth"
  | "user.preference_write"
  | "user.saved_story_write"
  | "cost.per_1000_articles"
  | "compliance.takedown";

export interface MetricsServiceShape {
  readonly increment: (
    name: MetricName,
    tags?: Record<string, string>,
  ) => Effect.Effect<void, never>;
  readonly gauge: (
    name: MetricName,
    value: number,
    tags?: Record<string, string>,
  ) => Effect.Effect<void, never>;
}

export class MetricsService extends Context.Service<
  MetricsService,
  MetricsServiceShape
>()("@news/platform/MetricsService") {}

export const MetricsLive = Layer.succeed(MetricsService, {
  increment: (name, tags = {}) =>
    Effect.gen(function* () {
      yield* Metric.update(Metric.counter(name), 1);
      yield* Effect.logDebug("metric.increment", { name, tags });
    }),
  gauge: (name, value, tags = {}) =>
    Effect.gen(function* () {
      yield* Metric.update(Metric.gauge(name), value);
      yield* Effect.logDebug("metric.gauge", { name, value, tags });
    }),
});

export const MetricsNoop = Layer.succeed(MetricsService, {
  increment: () => Effect.void,
  gauge: () => Effect.void,
});

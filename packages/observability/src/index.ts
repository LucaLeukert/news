import { type MetricName, MetricsService } from "@news/platform";
import { Effect } from "effect";

export type { MetricName } from "@news/platform";

export const logMetricEffect = (
  name: MetricName,
  value: number,
  tags: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const metrics = yield* MetricsService;
    yield* metrics.gauge(name, value, tags);
  });

export const logEventEffect = (
  name: string,
  payload: Record<string, unknown> = {},
) => Effect.logInfo(name, payload);

/**
 * Legacy fire-and-forget bridge for scripts that have not been moved to an
 * Effect runtime yet.
 */
export type LegacyMetricName =
  | "crawl.success_rate"
  | "crawl.policy_blocks"
  | "crawl.rss_page_mismatch_rate"
  | "crawl.extraction_failure_rate"
  | "cluster.correction_rate"
  | "ai.job_latency_ms"
  | "ai.schema_failure_rate"
  | "ai.confidence"
  | "ai.runner_uptime"
  | "queue.depth"
  | "cost.per_1000_articles"
  | "compliance.takedown_events";

export function logMetric(
  name: LegacyMetricName,
  value: number,
  tags: Record<string, string> = {},
) {
  Effect.runSync(Effect.logInfo("metric", { name, value, tags }));
}

export function logEvent(name: string, payload: Record<string, unknown> = {}) {
  Effect.runSync(Effect.logInfo(name, payload));
}

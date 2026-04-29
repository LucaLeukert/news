"use client";

import type { AdminAiJobDetail } from "@news/types";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useAdminAiJobDetailQuery } from "../../rpc-client";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "never";

const eventVariant = (level: string) => {
  switch (level) {
    case "error":
      return "destructive" as const;
    case "warn":
      return "default" as const;
    case "info":
      return "muted" as const;
    default:
      return "muted" as const;
  }
};

export function AiJobDetailClient(props: {
  readonly jobId: string;
  readonly initialData: AdminAiJobDetail;
}) {
  const { data } = useAdminAiJobDetailQuery(props.jobId, props.initialData);
  const detail = data ?? props.initialData;

  const attempts = new Map<number, typeof detail.events>();
  for (const event of detail.events) {
    attempts.set(event.attemptNumber, [
      ...(attempts.get(event.attemptNumber) ?? []),
      event,
    ]);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Status</CardDescription>
            <CardTitle className="capitalize">
              {detail.job.status.replaceAll("_", " ")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-stone-500">
            p{detail.job.priority} · {detail.job.attempts} attempt
            {detail.job.attempts === 1 ? "" : "s"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Lease</CardDescription>
            <CardTitle>{detail.job.leasedBy ?? "unleased"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-stone-500">
            {formatTimestamp(detail.job.leaseExpiresAt)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Lifecycle</CardDescription>
            <CardTitle>{formatTimestamp(detail.job.createdAt)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-stone-500">
            Updated {formatTimestamp(detail.job.updatedAt)}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <Badge variant="muted" className="w-fit">
            Payload
          </Badge>
          <CardTitle>Job input</CardTitle>
          <CardDescription>
            {detail.job.inputArtifactIds.length} input artifact
            {detail.job.inputArtifactIds.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-[24px] border border-stone-200 bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-100">
            {JSON.stringify(detail.job.payload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="muted" className="w-fit">
            Results
          </Badge>
          <CardTitle>Persisted outputs</CardTitle>
          <CardDescription>
            {detail.results.length} result row
            {detail.results.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {detail.results.map((result) => (
            <article
              className="space-y-3 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4"
              key={result.id}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="success">{result.validationStatus}</Badge>
                <span className="text-xs uppercase tracking-[0.18em] text-stone-400">
                  {formatTimestamp(result.createdAt)}
                </span>
              </div>
              <div className="text-sm leading-6 text-stone-600">
                {result.modelName} · {result.promptVersion} · {result.latencyMs}
                ms · confidence {result.confidence.toFixed(3)}
              </div>
              <pre className="overflow-x-auto rounded-[24px] border border-stone-200 bg-white p-4 font-mono text-xs leading-6 text-stone-800">
                {JSON.stringify(result.structuredOutput, null, 2)}
              </pre>
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="muted" className="w-fit">
            Attempt Log
          </Badge>
          <CardTitle>Timeline grouped by attempt</CardTitle>
          <CardDescription>
            Includes duplicate submissions and rebuild failures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...attempts.entries()]
            .sort((left, right) => right[0] - left[0])
            .map(([attemptNumber, events]) => (
              <article
                className="space-y-4 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4"
                key={attemptNumber}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-stone-950">
                      Attempt {attemptNumber === 0 ? "System" : attemptNumber}
                    </div>
                    <div className="text-sm text-stone-500">
                      {events.length} event(s)
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {events.map((event) => (
                    <div
                      className="rounded-[20px] border border-stone-200 bg-white p-4"
                      key={event.id}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant={eventVariant(event.level)}>
                            {event.level}
                          </Badge>
                          <span className="font-mono text-xs text-stone-500">
                            {event.eventType}
                          </span>
                        </div>
                        <span className="text-xs uppercase tracking-[0.18em] text-stone-400">
                          {formatTimestamp(event.createdAt)}
                        </span>
                      </div>
                      <div className="mt-3 text-sm font-medium text-stone-900">
                        {event.message}
                      </div>
                      {Object.keys(
                        (event.details ?? {}) as Record<string, unknown>,
                      ).length > 0 ? (
                        <pre className="mt-3 overflow-x-auto rounded-[20px] border border-stone-200 bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-100">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

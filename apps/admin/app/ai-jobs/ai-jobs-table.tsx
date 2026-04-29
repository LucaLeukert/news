"use client";

import type { AdminAiJobListItem } from "@news/types";
import Link from "next/link";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useAdminAiJobsQuery } from "../rpc-client";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "never";

const formatStatus = (value: string) => value.replaceAll("_", " ");

const statusVariant = (value: string) => {
  if (value.includes("failed")) return "destructive" as const;
  if (value.includes("completed")) return "success" as const;
  return "default" as const;
};

export function AiJobsTable(props: {
  readonly initialData: ReadonlyArray<AdminAiJobListItem>;
}) {
  const { data } = useAdminAiJobsQuery({ limit: 200 }, props.initialData);
  const jobs = data ?? props.initialData;

  return (
    <Card>
      <CardHeader>
        <Badge variant="muted" className="w-fit">
          Queue History
        </Badge>
        <CardTitle>Recent Jobs</CardTitle>
        <CardDescription>
          Open a row to inspect payloads, outputs, and per-attempt logs.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Job
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Attempts
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Result
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Events
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-t border-stone-100 even:bg-stone-50/60"
              >
                <td className="px-4 py-4 align-top text-sm text-stone-700">
                  <div className="space-y-1">
                    <Link
                      href={`/ai-jobs/${job.id}`}
                      className="font-semibold text-stone-950 underline-offset-4 hover:underline"
                    >
                      {job.type}
                    </Link>
                    <div className="font-mono text-xs text-stone-500">
                      {job.id}
                    </div>
                    <div className="text-xs text-stone-500">
                      {job.inputArtifactIds.length} artifact
                      {job.inputArtifactIds.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-sm text-stone-700">
                  <div className="space-y-2">
                    <Badge variant={statusVariant(job.status)}>
                      {formatStatus(job.status)}
                    </Badge>
                    {job.lastError ? (
                      <div className="max-w-sm text-xs leading-5 text-rose-700">
                        {job.lastError}
                      </div>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-sm text-stone-700">
                  <div className="font-medium text-stone-900">
                    p{job.priority} · {job.attempts}
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    {job.leasedBy ?? "unleased"} ·{" "}
                    {formatTimestamp(job.leaseExpiresAt)}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-sm text-stone-700">
                  <div>{job.latestResultValidationStatus ?? "none"}</div>
                  <div className="mt-1 text-xs text-stone-500">
                    {formatTimestamp(job.latestResultAt)}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-sm font-medium text-stone-700">
                  {job.eventCount}
                </td>
                <td className="px-4 py-4 align-top text-sm text-stone-700">
                  {formatTimestamp(job.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

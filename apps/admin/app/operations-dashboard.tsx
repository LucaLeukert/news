"use client";

import type { OperationsSnapshot } from "@news/types";
import { AlertTriangle, Bot, Database, Globe2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { useOperationsSnapshotQuery } from "./rpc-client";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "never";

const formatStatus = (value: string) => value.replaceAll("_", " ");

const statusVariant = (value: string) => {
  if (value.includes("failed")) return "destructive" as const;
  if (value.includes("completed") || value.includes("projected")) {
    return "success" as const;
  }
  return "default" as const;
};

const TableHeader = ({ children }: { readonly children: ReactNode }) => (
  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
    {children}
  </th>
);

const TableCell = ({ children }: { readonly children: ReactNode }) => (
  <td className="px-4 py-4 align-top text-sm text-stone-700">{children}</td>
);

export function OperationsDashboard(props: {
  initialSnapshot: OperationsSnapshot;
}) {
  const { data } = useOperationsSnapshotQuery(props.initialSnapshot);
  const snapshot = data ?? props.initialSnapshot;

  const healthRows = [
    {
      label: "Sources / Feeds",
      value: `${snapshot.overview.sourceCount} / ${snapshot.overview.feedCount}`,
      note: "Configured publishers and feed endpoints",
      icon: Globe2,
    },
    {
      label: "Articles / Stories",
      value: `${snapshot.overview.articleCount} / ${snapshot.overview.storyCount}`,
      note: "Canonical store coverage",
      icon: Database,
    },
    {
      label: "Projection Coverage",
      value: `${snapshot.overview.syncedStoryCount}/${snapshot.overview.storyCount}`,
      note: "Canonical stories present in Convex",
      icon: RefreshCw,
    },
    {
      label: "AI Queue",
      value: `${snapshot.overview.aiJobsPending} pending / ${snapshot.overview.aiJobsLeased} leased`,
      note: "Live AI workload",
      icon: Bot,
    },
    {
      label: "Held Summaries",
      value: String(snapshot.overview.heldSummaryCount),
      note: "Stories without a publishable summary",
      icon: AlertTriangle,
    },
    {
      label: "Suspicious Summaries",
      value: String(snapshot.overview.suspiciousSummaryCount),
      note: "Malformed summaries that need review",
      icon: AlertTriangle,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <section id="overview">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-950">
              Overview
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Canonical store, projection sync, and AI runtime health.
            </p>
          </div>
          <Badge variant="muted">Updates every 5s</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {healthRows.map((item) => (
            <Card key={item.label} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <Badge variant="muted">{item.label}</Badge>
                  <item.icon className="size-4 text-stone-400" />
                </div>
                <CardTitle className="text-3xl font-semibold tracking-tight">
                  {item.value}
                </CardTitle>
                <CardDescription className="leading-6">
                  {item.note}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <Card id="sources">
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>
            Recent source feed health and crawl policy state.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="border-b border-stone-200">
                <TableHeader>Source</TableHeader>
                <TableHeader>Feed</TableHeader>
                <TableHeader>Policy</TableHeader>
                <TableHeader>Validation</TableHeader>
                <TableHeader>Last Fetch</TableHeader>
              </tr>
            </thead>
            <tbody>
              {snapshot.sourceFeeds.map((feed) => (
                <tr
                  key={feed.feedId}
                  className="border-t border-stone-100 even:bg-stone-50/60"
                >
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">
                        {feed.sourceName}
                      </div>
                      <div className="font-mono text-xs text-stone-500">
                        {feed.domain}
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-stone-400">
                        {feed.countryCode ?? "??"} ·{" "}
                        {feed.primaryLanguage ?? "?"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-sm break-all font-mono text-xs text-stone-500">
                      {feed.feedUrl}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="muted">
                        {feed.rssOnly ? "RSS only" : "crawl allowed"}
                      </Badge>
                      <Badge variant="muted">
                        {feed.noSnippet ? "no snippet" : "snippet ok"}
                      </Badge>
                      <Badge
                        variant={feed.doNotCrawl ? "destructive" : "success"}
                      >
                        {feed.doNotCrawl ? "do not crawl" : "active"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{feed.validationState ?? "unknown"}</TableCell>
                  <TableCell>{formatTimestamp(feed.lastFetchedAt)}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card id="jobs">
        <CardHeader>
          <CardTitle>AI Jobs</CardTitle>
          <CardDescription>
            Recent AI lease and completion state from Neon.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <TableHeader>Job</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Attempts</TableHeader>
                <TableHeader>Lease</TableHeader>
                <TableHeader>Updated</TableHeader>
              </tr>
            </thead>
            <tbody>
              {snapshot.aiJobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-t border-stone-100 even:bg-stone-50/60"
                >
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">
                        {job.type}
                      </div>
                      <div className="font-mono text-xs text-stone-500">
                        {job.id}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-stone-900">
                      p{job.priority} · {job.attempts}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div>{job.leasedBy ?? "unleased"}</div>
                      <div className="text-xs text-stone-500">
                        {formatTimestamp(job.leaseExpiresAt)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatTimestamp(job.updatedAt)}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card id="sync">
        <CardHeader>
          <CardTitle>Story Sync</CardTitle>
          <CardDescription>
            Canonical stories, summaries, and Convex projection presence.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <TableHeader>Story</TableHeader>
                <TableHeader>Summary</TableHeader>
                <TableHeader>Projection</TableHeader>
                <TableHeader>Last Seen</TableHeader>
              </tr>
            </thead>
            <tbody>
              {snapshot.storySync.map((story) => (
                <tr
                  key={story.storyId}
                  className="border-t border-stone-100 even:bg-stone-50/60"
                >
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">
                        {story.title}
                      </div>
                      <div className="font-mono text-xs text-stone-500">
                        {story.storyId}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        story.suspiciousSummary
                          ? "destructive"
                          : story.hasSummary
                            ? "success"
                            : "muted"
                      }
                    >
                      {story.hasSummary ? "present" : "missing"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={story.projected ? "success" : "muted"}>
                      {story.projected ? "projected" : "missing"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatTimestamp(story.lastSeenAt)}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

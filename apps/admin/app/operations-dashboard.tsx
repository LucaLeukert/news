"use client";

import { useEffect, useState } from "react";
import type { OperationsSnapshot } from "@news/types";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "never";

const formatStatus = (value: string) => value.replaceAll("_", " ");

export function OperationsDashboard(props: {
  initialSnapshot: OperationsSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const response = await fetch("/api/operations", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const next = (await response.json()) as OperationsSnapshot;
      if (!cancelled) {
        setSnapshot(next);
      }
    };

    const interval = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const healthRows = [
    [
      "Sources / Feeds",
      `${snapshot.overview.sourceCount} / ${snapshot.overview.feedCount}`,
      "Configured publishers and feed endpoints",
    ],
    [
      "Articles / Stories",
      `${snapshot.overview.articleCount} / ${snapshot.overview.storyCount}`,
      "Canonical store coverage",
    ],
    [
      "Projection Coverage",
      `${snapshot.overview.syncedStoryCount}/${snapshot.overview.storyCount}`,
      "Canonical stories present in Convex",
    ],
    [
      "Held Summaries",
      String(snapshot.overview.heldSummaryCount),
      "Stories without a publishable summary",
    ],
    [
      "Suspicious Summaries",
      String(snapshot.overview.suspiciousSummaryCount),
      "Malformed summaries that need review",
    ],
    [
      "AI Queue",
      `${snapshot.overview.aiJobsPending} pending / ${snapshot.overview.aiJobsLeased} leased`,
      "Live AI workload",
    ],
  ] as const;

  return (
    <>
      <section className="panel" id="overview">
        <div className="panel-head">
          <h2>Overview</h2>
          <p>Canonical store, projection sync, and AI runtime health.</p>
        </div>
        <div className="health-grid">
          {healthRows.map(([label, value, note]) => (
            <div className="health-cell" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <em>{note}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" id="sources">
        <div className="panel-head">
          <h2>Sources</h2>
          <p>Recent source feed health and crawl policy state.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Feed</th>
              <th>Policy</th>
              <th>Validation</th>
              <th>Last Fetch</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.sourceFeeds.map((feed) => (
              <tr key={feed.feedId}>
                <td>
                  <strong>{feed.sourceName}</strong>
                  <div className="subtle">{feed.domain}</div>
                  <div className="subtle">
                    {feed.countryCode ?? "??"} · {feed.primaryLanguage ?? "?"}
                  </div>
                </td>
                <td className="mono">{feed.feedUrl}</td>
                <td>
                  <span className="status-chip">
                    {feed.rssOnly ? "rss only" : "crawl allowed"}
                  </span>
                  <span className="status-chip">
                    {feed.noSnippet ? "no snippet" : "snippet ok"}
                  </span>
                  <span className="status-chip danger">
                    {feed.doNotCrawl ? "do not crawl" : "active"}
                  </span>
                </td>
                <td>{feed.validationState ?? "unknown"}</td>
                <td>{formatTimestamp(feed.lastFetchedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" id="jobs">
        <div className="panel-head">
          <h2>AI Jobs</h2>
          <p>Recent AI lease and completion state from Neon.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Lease</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.aiJobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <strong>{job.type}</strong>
                  <div className="subtle mono">{job.id}</div>
                </td>
                <td>
                  <span
                    className={`status-chip ${job.status.includes("failed") ? "danger" : ""}`}
                  >
                    {formatStatus(job.status)}
                  </span>
                  {job.lastError ? (
                    <div className="subtle">{job.lastError}</div>
                  ) : null}
                </td>
                <td>
                  p{job.priority} · {job.attempts}
                </td>
                <td>
                  {job.leasedBy ?? "unleased"}
                  <div className="subtle">
                    {formatTimestamp(job.leaseExpiresAt)}
                  </div>
                </td>
                <td>{formatTimestamp(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" id="sync">
        <div className="panel-head">
          <h2>Story Sync</h2>
          <p>Canonical stories, summaries, and Convex projection presence.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Story</th>
              <th>Summary</th>
              <th>Projection</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.storySync.map((story) => (
              <tr key={story.storyId}>
                <td>
                  <strong>{story.title}</strong>
                  <div className="subtle mono">{story.storyId}</div>
                </td>
                <td>
                  <span
                    className={`status-chip ${story.suspiciousSummary ? "danger" : ""}`}
                  >
                    {story.hasSummary ? "present" : "missing"}
                  </span>
                </td>
                <td>
                  <span className="status-chip">
                    {story.projected ? "projected" : "missing"}
                  </span>
                </td>
                <td>{formatTimestamp(story.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

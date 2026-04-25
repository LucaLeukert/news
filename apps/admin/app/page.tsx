import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Effect } from "effect";
import { env } from "../env";
import {
  enqueueCrawlAction,
  resolveUrlAction,
  syncProjectionAction,
} from "./actions";
import { OperationsDashboard } from "./operations-dashboard";
import { adminRpc } from "./rpc";

export default async function AdminHome(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [identity, snapshot, searchParams] = await Promise.all([
    Effect.runPromise(
      Effect.tryPromise(() => auth()).pipe(
        Effect.catchIf(
          () => true,
          () => Effect.succeed({ userId: null, orgId: null }),
        ),
      ),
    ),
    Effect.runPromise(adminRpc((rpc) => rpc.getOperationsSnapshot())),
    props.searchParams ??
      Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);

  const notice =
    typeof searchParams.notice === "string" ? searchParams.notice : null;

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <strong>Coverage Lens</strong>
        <a href="#overview">Overview</a>
        <a href="#controls">Controls</a>
        <a href="#sources">Sources</a>
        <a href="#jobs">AI Jobs</a>
        <a href="#sync">Sync</a>
      </aside>
      <section className="content">
        <header className="page-header">
          <div>
            <h1>Operations</h1>
            <p>
              {identity.userId
                ? `Authenticated operator ${identity.userId}`
                : "Protected in production by Cloudflare Access and Clerk."}
            </p>
            <p className="subtle">
              API: {env.NEXT_PUBLIC_API_BASE_URL} · Latest AI result:{" "}
              {snapshot.overview.latestAiResultAt
                ? new Date(snapshot.overview.latestAiResultAt).toLocaleString()
                : "never"}
            </p>
          </div>
          {env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserButton /> : null}
        </header>

        {notice ? <div className="notice">{notice}</div> : null}

        <section className="panel" id="controls">
          <div className="panel-head">
            <h2>Controls</h2>
            <p>RPC-only operational actions for crawl, sync, and URL intake.</p>
          </div>
          <div className="control-grid">
            <form action={enqueueCrawlAction} className="control-card">
              <h3>RSS Check Sweep</h3>
              <p>Queue the scheduler-style feed verification pass.</p>
              <input type="hidden" name="kind" value="rss_checks" />
              <button type="submit">Queue RSS Checks</button>
            </form>
            <form action={enqueueCrawlAction} className="control-card">
              <h3>Story Refresh Sweep</h3>
              <p>Queue a stale-story refresh cycle.</p>
              <input type="hidden" name="kind" value="stale_story_refresh" />
              <button type="submit">Queue Refresh</button>
            </form>
            <form action={syncProjectionAction} className="control-card">
              <h3>Projection Sync</h3>
              <p>Push canonical public stories back into Convex.</p>
              <button type="submit">Queue Sync</button>
            </form>
            <form action={resolveUrlAction} className="control-card control-card-wide">
              <h3>Resolve URL</h3>
              <p>Match a URL to an existing story or queue it for crawling.</p>
              <label className="field">
                <span>Article URL</span>
                <input
                  type="url"
                  name="url"
                  placeholder="https://example.com/article"
                  required
                />
              </label>
              <button type="submit">Resolve Or Queue</button>
            </form>
          </div>
        </section>
        <OperationsDashboard initialSnapshot={snapshot} />
      </section>
    </main>
  );
}

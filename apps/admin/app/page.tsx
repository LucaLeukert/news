import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { api } from "@news/convex";
import { NewsRpcClient, NewsRpcClientLive } from "@news/platform";
import { fetchQuery } from "convex/nextjs";
import { Effect } from "effect";
import { env } from "../env";

export default async function AdminHome() {
  const [identity, canonicalStories, projectedStories] = await Promise.all([
    Effect.runPromise(
      Effect.tryPromise(() => auth()).pipe(
        Effect.catchIf(
          () => true,
          () => Effect.succeed({ userId: null, orgId: null }),
        ),
      ),
    ),
    Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* NewsRpcClient;
        return yield* rpc.listStories({});
      }).pipe(
        Effect.provide(
          NewsRpcClientLive({
            apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL,
            serviceToken: env.INTERNAL_SERVICE_TOKEN,
          }),
        ),
      ),
    ),
    fetchQuery(api.storyProjections.listStories, {}),
  ]);

  const projectedById = new Map(
    projectedStories.map((story) => [story.id, story] as const),
  );
  const healthRows = [
    ["Canonical stories", String(canonicalStories.length), "Effect RPC -> Neon"],
    ["Projected stories", String(projectedStories.length), "Convex read model"],
    [
      "Projection coverage",
      `${canonicalStories.filter((story) => projectedById.has(story.id)).length}/${canonicalStories.length}`,
      "Canonical stories available in Convex",
    ],
    [
      "Held summaries",
      String(canonicalStories.filter((story) => !story.summary).length),
      "Stories without publishable summary",
    ],
  ];

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <strong>Coverage Lens</strong>
        <a href="/">Crawl Health</a>
        <a href="/">AI Jobs</a>
        <a href="/">Sources</a>
        <a href="/">Taxonomies</a>
        <a href="/">Takedowns</a>
      </aside>
      <section className="content">
        <header>
          <h1>Operations</h1>
          <p>
            {identity.userId
              ? `Authenticated operator ${identity.userId}`
              : "Cloudflare Access and Clerk should protect this app in production."}
          </p>
          {env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <UserButton /> : null}
        </header>
        <div className="health-grid">
          {healthRows.map(([label, value, note]) => (
            <div className="health-cell" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <em>{note}</em>
            </div>
          ))}
        </div>
        <section className="queue">
          <h2>Canonical To Projection Sync</h2>
          <table>
            <thead>
              <tr>
                <th>Story</th>
                <th>Canonical</th>
                <th>Projection</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {canonicalStories.map((story) => {
                const projection = projectedById.get(story.id);
                return (
                  <tr key={story.id}>
                    <td>{story.title}</td>
                    <td>{new Date(story.lastSeenAt).toLocaleString()}</td>
                    <td>
                      {projection
                        ? new Date(projection.lastSeenAt).toLocaleString()
                        : "missing"}
                    </td>
                    <td>{projection ? "synced" : "pending sync"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}

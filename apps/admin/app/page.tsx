import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Effect } from "effect";
import { env } from "../env";

const healthRows = [
  ["Crawler success", "72%", "Target 70%"],
  ["Extraction success", "83%", "Target 80%"],
  ["AI schema validity", "94%", "Target 90%"],
  ["Held AI labels", "31", "Review queue"],
  ["Policy blocks", "18", "Last 24h"],
  ["Takedowns open", "0", "SLA active"],
];

export default async function AdminHome() {
  const identity = await Effect.runPromise(
    Effect.tryPromise(() => auth()).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ userId: null, orgId: null }),
      ),
    ),
  );

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
          <h2>Review Gates</h2>
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Public Rule</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Bias/context labels</td>
                <td>
                  Publish only with strong country context and confidence &gt;=
                  0.80
                </td>
                <td>Review evidence URLs</td>
              </tr>
              <tr>
                <td>Ownership data</td>
                <td>Weak evidence remains unpublished</td>
                <td>Add citations</td>
              </tr>
              <tr>
                <td>Story summaries</td>
                <td>Hold below 0.80 or failed safety check</td>
                <td>Inspect prompt/model versions</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}

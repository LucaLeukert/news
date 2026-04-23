import { NewsRpcClient, NewsRpcClientLive } from "@news/platform";
import { Effect } from "effect";
import Link from "next/link";
import { env } from "../env";
import { AccountBar } from "./account-bar";

export const dynamic = "force-dynamic";

const apiBase = env.NEXT_PUBLIC_API_BASE_URL;

const getStories = Effect.gen(function* () {
  const rpc = yield* NewsRpcClient;
  return yield* rpc.listStories({});
}).pipe(
  Effect.catchIf(
    () => true,
    () => Effect.succeed([]),
  ),
  Effect.provide(NewsRpcClientLive({ apiBaseUrl: apiBase })),
);

export default async function Home() {
  const stories = await Effect.runPromise(getStories);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          Coverage Lens
        </Link>
        <nav aria-label="Primary navigation">
          <a href="/?imbalance=true">Blindspots</a>
          <a href="/?language=en">English</a>
          <a href="/?country=US">United States</a>
        </nav>
        {env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <AccountBar proPriceId={env.CLERK_PRICE_ID_PRO} />
        ) : null}
      </header>

      <section className="workspace">
        <div className="main-column">
          <form className="search" action="/search">
            <input
              name="q"
              placeholder="Search stories, publishers, URLs, entities"
            />
            <button type="submit">Search</button>
          </form>

          <div className="story-list">
            {stories.map((story) => (
              <article className="story-row" key={story.id}>
                <div>
                  <Link href={`/stories/${story.id}`} className="story-title">
                    {story.title}
                  </Link>
                  <p>
                    {story.summary?.neutralSummary ??
                      "Summary pending model review."}
                  </p>
                </div>
                <dl className="story-facts">
                  <div>
                    <dt>Sources</dt>
                    <dd>
                      {Object.values(story.coverage.byCountry).reduce(
                        (sum, count) => sum + count,
                        0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Languages</dt>
                    <dd>{Object.keys(story.coverage.byLanguage).length}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>
                      {story.summary
                        ? `${Math.round(story.summary.confidence * 100)}%`
                        : "Held"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>

        <aside className="side-panel">
          <h2>Coverage Imbalance</h2>
          <p>
            Blindspots are calculated as uneven coverage patterns by country,
            language, and available local taxonomy. They are not truth
            judgments.
          </p>
          <ul>
            <li>Low-confidence labels stay out of public aggregate charts.</li>
            <li>Bias context is country-specific or marked insufficient.</li>
            <li>Publisher links remain the canonical reading path.</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}

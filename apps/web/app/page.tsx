import Link from "next/link";
import { env } from "../env";
import { AccountBar } from "./account-bar";
import { loadPublicStories } from "./public-story-projection-sync";

export const dynamic = "force-dynamic";

export default async function Home() {
  const stories = await loadPublicStories();

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
            {stories.length > 0 ? (
              stories.map((story) => (
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
              ))
            ) : (
              <article className="story-row">
                <div>
                  <p className="story-title">No stories available</p>
                  <p>
                    Public reads now come from Convex projections. If this
                    stays empty outside the built-in demo fallback, check that
                    Convex sync is running and `NEXT_PUBLIC_CONVEX_URL` is
                    configured.
                  </p>
                </div>
              </article>
            )}
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

import { notFound } from "next/navigation";
import { loadPublicStoryDetail } from "../../public-story-projection-sync";

export const dynamic = "force-dynamic";

export default async function StoryPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const data = await loadPublicStoryDetail(id);
  if (!data) notFound();

  const story = data.story;
  const articles = data.articles;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          Coverage Lens
        </a>
        <nav aria-label="Story navigation">
          <a href="#coverage">Coverage</a>
          <a href="#headlines">Headlines</a>
          <a href="#summary">Summary</a>
        </nav>
      </header>

      <section className="story-detail">
        <div className="story-heading">
          <h1>{story.title}</h1>
          <p>
            First seen {new Date(story.firstSeenAt).toLocaleString()} · Last
            updated {new Date(story.lastSeenAt).toLocaleString()}
          </p>
        </div>

        <section className="summary-grid" id="summary">
          <div>
            <h2>Neutral Summary</h2>
            <p>
              {story.summary?.neutralSummary ??
                "Held pending model confidence."}
            </p>
          </div>
          <div>
            <h2>What Is Agreed</h2>
            <ul>
              {story.summary?.agreed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>What Differs</h2>
            <ul>
              {story.summary?.differs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Unverified Or Contested</h2>
            <ul>
              {story.summary?.contestedOrUnverified.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="coverage">
          <h2>Coverage Distribution</h2>
          <div className="distribution">
            {Object.entries(story.coverage.byCountry).map(
              ([country, count]) => (
                <div className="bar-row" key={country}>
                  <span>{country}</span>
                  <meter
                    value={count}
                    min={0}
                    max={Math.max(...Object.values(story.coverage.byCountry))}
                  />
                  <strong>{count}</strong>
                </div>
              ),
            )}
          </div>
        </section>

        <section id="headlines">
          <h2>Headline Comparison</h2>
          <div className="article-table">
            {articles.map((article) => (
              <a
                className="article-row"
                href={article.canonicalUrl}
                key={article.id}
                rel="noreferrer"
              >
                <span>{article.title}</span>
                <span>{article.language ?? "unknown"}</span>
                <span>{article.paywalled ? "Paywalled" : "Open"}</span>
                <span>{article.crawlStatus.replaceAll("_", " ")}</span>
              </a>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

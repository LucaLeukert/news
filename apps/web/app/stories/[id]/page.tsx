import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
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
  const maxCountryCount = Math.max(
    ...Object.values(story.coverage.byCountry),
    1,
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.14),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.1),_transparent_22%),linear-gradient(180deg,_#fafaf9_0%,_#f5f5f4_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-4 lg:px-6 lg:py-6">
        <header className="rounded-[32px] border border-stone-200/80 bg-white/85 px-5 py-5 shadow-[0_24px_80px_rgba(28,25,23,0.08)] backdrop-blur lg:px-8 lg:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="muted" className="w-fit">
                Story Detail
              </Badge>
              <div>
                <Link href="/" className="text-sm font-medium text-stone-500">
                  ← Back to stories
                </Link>
                <h1 className="mt-3 max-w-5xl font-serif text-4xl font-semibold tracking-tight text-stone-950 lg:text-5xl">
                  {story.title}
                </h1>
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  First seen {new Date(story.firstSeenAt).toLocaleString()} ·
                  Last updated {new Date(story.lastSeenAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="muted">Coverage</Badge>
              <Badge variant="muted">Headlines</Badge>
              <Badge variant="muted">Summary</Badge>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <section id="summary" className="grid gap-4 lg:grid-cols-2">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <Badge variant="muted" className="w-fit">
                    Neutral Summary
                  </Badge>
                  <CardDescription className="text-base leading-8 text-stone-700">
                    {story.summary?.neutralSummary ??
                      "Held pending model confidence."}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>What Is Agreed</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm leading-7 text-stone-600">
                    {(story.summary?.agreed ?? []).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>What Differs</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm leading-7 text-stone-600">
                    {(story.summary?.differs ?? []).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Unverified Or Contested</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm leading-7 text-stone-600">
                    {(story.summary?.contestedOrUnverified ?? []).map(
                      (item) => (
                        <li key={item}>• {item}</li>
                      ),
                    )}
                  </ul>
                </CardContent>
              </Card>
            </section>

            <Card id="headlines">
              <CardHeader>
                <Badge variant="muted" className="w-fit">
                  Headline Comparison
                </Badge>
                <CardTitle>Publisher-by-publisher view</CardTitle>
                <CardDescription>
                  Each row links to the canonical source article.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {articles.map((article) => (
                  <a
                    className="grid gap-3 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 transition hover:border-stone-300 hover:bg-white lg:grid-cols-[1.5fr_0.3fr_0.3fr_0.5fr]"
                    href={article.canonicalUrl}
                    key={article.id}
                    rel="noreferrer"
                  >
                    <span className="font-medium text-stone-900">
                      {article.title}
                    </span>
                    <span className="text-sm uppercase tracking-[0.18em] text-stone-500">
                      {article.language ?? "unknown"}
                    </span>
                    <span className="text-sm text-stone-600">
                      {article.paywalled ? "Paywalled" : "Open"}
                    </span>
                    <span className="text-sm text-stone-600">
                      {article.crawlStatus.replaceAll("_", " ")}
                    </span>
                  </a>
                ))}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6" id="coverage">
            <Card>
              <CardHeader>
                <Badge variant="muted" className="w-fit">
                  Coverage Distribution
                </Badge>
                <CardTitle>Country spread</CardTitle>
                <CardDescription>
                  Counts represent the number of participating articles per
                  country in this story.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(story.coverage.byCountry).map(
                  ([country, count]) => (
                    <div key={country} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-stone-700">
                          {country}
                        </span>
                        <span className="text-stone-500">{count}</span>
                      </div>
                      <div className="h-3 rounded-full bg-stone-200">
                        <div
                          className="h-3 rounded-full bg-emerald-600"
                          style={{
                            width: `${Math.max((count / maxCountryCount) * 100, 8)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ),
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Badge variant="muted" className="w-fit">
                  Reader Notes
                </Badge>
                <CardTitle>What the public view excludes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-stone-600">
                <p>
                  Held summaries remain hidden until confidence thresholds pass.
                </p>
                <p>Publisher full text is never republished here.</p>
                <p>
                  Disagreement sections summarize overlap, not objective truth.
                </p>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

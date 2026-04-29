import { ArrowRight, Globe2, ScanSearch, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { env } from "../env";
import { AccountBar } from "./account-bar";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { loadPublicStories } from "./public-story-projection-sync";

export const dynamic = "force-dynamic";

export default async function Home() {
  const stories = await loadPublicStories();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_24%),linear-gradient(180deg,_#fafaf9_0%,_#f5f5f4_100%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-4 lg:px-6 lg:py-6">
        <header className="rounded-[32px] border border-stone-200/80 bg-white/85 px-5 py-5 shadow-[0_24px_80px_rgba(28,25,23,0.08)] backdrop-blur lg:px-8 lg:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <Badge variant="muted" className="w-fit">
                Coverage Lens
              </Badge>
              <div>
                <Link
                  className="font-serif text-4xl font-semibold tracking-tight text-stone-950 lg:text-5xl"
                  href="/"
                >
                  Follow where coverage converges and where it does not.
                </Link>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600 lg:text-base">
                  Public reads come from projected stories only. Low-confidence
                  summaries stay out; source links remain the canonical reading
                  path.
                </p>
              </div>
            </div>
            {env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
              <AccountBar proPriceId={env.CLERK_PRICE_ID_PRO} />
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="secondary">
              <Link href="/?imbalance=true">Blindspots</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/?language=en">English</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/?country=US">United States</Link>
            </Button>
          </div>
        </header>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <Badge variant="muted" className="w-fit">
                  Search
                </Badge>
                <CardTitle>
                  Find stories, publishers, URLs, and entities
                </CardTitle>
                <CardDescription>
                  Search resolves against the projected public store, not the
                  internal admin RPC.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  action="/search"
                  className="flex flex-col gap-3 sm:flex-row"
                >
                  <Input
                    name="q"
                    placeholder="Search stories, publishers, URLs, entities"
                  />
                  <Button type="submit" className="sm:min-w-36">
                    <ScanSearch className="size-4" />
                    Search
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {stories.length > 0 ? (
                stories.map((story) => (
                  <Card key={story.id}>
                    <CardHeader className="gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-3">
                          <Badge variant="muted" className="w-fit">
                            Story
                          </Badge>
                          <Link
                            href={`/stories/${story.id}`}
                            className="block max-w-3xl text-2xl font-semibold tracking-tight text-stone-950 underline-offset-4 hover:underline"
                          >
                            {story.title}
                          </Link>
                        </div>
                        <Button asChild variant="secondary" size="sm">
                          <Link href={`/stories/${story.id}`}>
                            Open
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                      <CardDescription className="max-w-4xl text-sm leading-7 text-stone-600">
                        {story.summary?.neutralSummary ??
                          "Summary pending model review."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Sources
                        </div>
                        <div className="mt-2 text-3xl font-semibold text-stone-950">
                          {Object.values(story.coverage.byCountry).reduce(
                            (sum, count) => sum + count,
                            0,
                          )}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Languages
                        </div>
                        <div className="mt-2 text-3xl font-semibold text-stone-950">
                          {Object.keys(story.coverage.byLanguage).length}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Confidence
                        </div>
                        <div className="mt-2 text-3xl font-semibold text-stone-950">
                          {story.summary
                            ? `${Math.round(story.summary.confidence * 100)}%`
                            : "Held"}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>No stories available</CardTitle>
                    <CardDescription className="leading-7">
                      Public reads now come from Convex projections. If this
                      stays empty outside the demo fallback, check that Convex
                      sync is running and `NEXT_PUBLIC_CONVEX_URL` is
                      configured.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <Badge variant="muted" className="w-fit">
                  Coverage Imbalance
                </Badge>
                <CardTitle>How to read the signal</CardTitle>
                <CardDescription className="leading-7">
                  Blindspots are calculated as uneven coverage patterns by
                  country, language, and available local taxonomy. They are not
                  truth judgments.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="flex items-center gap-3">
                    <Globe2 className="size-4 text-stone-500" />
                    <span className="text-sm font-medium text-stone-700">
                      Geographic spread
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Country balance is derived from publisher origin and public
                    story participation.
                  </p>
                </div>
                <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="size-4 text-stone-500" />
                    <span className="text-sm font-medium text-stone-700">
                      Confidence gating
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Low-confidence labels stay out of public aggregate charts
                    and summaries.
                  </p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

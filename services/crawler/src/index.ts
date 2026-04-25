import {
  extractMetadataEffect,
  makeSnippet,
  parseFeed,
  validateFeedItemAgainstPage,
} from "@news/crawler-core";
import {
  Article as NewspaperArticle,
  Configuration as NewspaperConfiguration,
  CrawlerHttpLive,
} from "@news/newspaper";
import {
  HttpService,
  MetricsService,
  makeAppLayer,
  runMain,
} from "@news/platform";
import { loadServerEnv } from "@news/env";
import { USER_AGENT } from "@news/types";
import { Effect } from "effect";
import { runSeededFeedIngestion, type SeedSourceInput } from "./pipeline";

const newspaperConfig = new NewspaperConfiguration({
  fetchImages: false,
});

const parseArticleWithNewspaper = (url: string, html: string) =>
  Effect.gen(function* () {
    const article = new NewspaperArticle(
      url,
      "",
      "",
      "",
      new NewspaperConfiguration({
        ...newspaperConfig,
        fetchImages: false,
      }),
    );
    article.html = html;
    yield* article.parse().pipe(Effect.provide(CrawlerHttpLive));

    return {
      canonicalUrl: article.canonicalLink || article.url,
      title: article.title || null,
      description: article.metaDescription || null,
      author: article.authors[0] ?? null,
      publishedAt: article.publishDate?.toISOString() ?? null,
      language: article.metaLang || article.config.language || null,
      paywalled: false,
    };
  }).pipe(
    Effect.catchIf(
      () => true,
      () => extractMetadataEffect(html, url),
    ),
  );

export const ingestFeed = (feedUrl: string) =>
  Effect.gen(function* () {
    const http = yield* HttpService;
    const metrics = yield* MetricsService;
    const feedResponse = yield* http.request(feedUrl, {
      headers: { "user-agent": USER_AGENT },
    });
    const items = parseFeed(yield* feedResponse.text);

    return yield* Effect.all(
      items.slice(0, 20).map((item) =>
        http.request(item.url, { headers: { "user-agent": USER_AGENT } }).pipe(
          Effect.flatMap((pageResponse) =>
            Effect.gen(function* () {
              const pageHtml = yield* pageResponse.text;
              const metadata = yield* parseArticleWithNewspaper(
                pageResponse.url,
                pageHtml,
              );
              const validationState = validateFeedItemAgainstPage(
                item,
                metadata,
              );
              if (validationState === "rss_verified") {
                yield* metrics.increment("crawl.success");
              } else {
                yield* metrics.increment("crawl.rss_page_mismatch", {
                  validationState,
                });
              }
              return {
                item,
                metadata: {
                  ...metadata,
                  description: makeSnippet(metadata.description),
                },
                validationState,
              };
            }),
          ),
          Effect.catchIf(
            () => true,
            (error: unknown) =>
              Effect.gen(function* () {
                yield* metrics.increment("crawl.extraction_failure");
                yield* Effect.logWarning("crawler.article_fetch.failed", {
                  url: item.url,
                  error,
                });
                return { item, validationState: "canonical_failed" as const };
              }),
          ),
        ),
      ),
      { concurrency: 4 },
    );
  });

const parseArgs = (argv: readonly string[]) => {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        flags.set(key, "true");
        continue;
      }
      flags.set(key, next);
      index += 1;
      continue;
    }
    positional.push(value);
  }

  return { positional, flags };
};

const requiredFlag = (flags: Map<string, string>, key: string) => {
  const value = flags.get(key);
  if (!value) {
    throw new Error(`Missing required flag --${key}`);
  }
  return value;
};

const seedInputFromFlags = (flags: Map<string, string>): SeedSourceInput => ({
  sourceName: requiredFlag(flags, "source-name"),
  sourceDomain: requiredFlag(flags, "source-domain"),
  feedUrl: requiredFlag(flags, "feed-url"),
  countryCode: flags.get("country-code") ?? null,
  primaryLanguage: flags.get("language") ?? null,
  rssOnly: flags.get("rss-only") === "true",
  noSnippet: flags.get("no-snippet") === "true",
});

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const env = await Effect.runPromise(loadServerEnv(process.env));
  const appLayer = makeAppLayer(env);

  if (args.positional[0] === "seed-and-ingest") {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for seed-and-ingest");
    }

    const seedInput = seedInputFromFlags(args.flags);
    const results = await runMain(
      ingestFeed(seedInput.feedUrl).pipe(Effect.provide(appLayer)),
    );
    const persisted = await runMain(
      runSeededFeedIngestion(env.DATABASE_URL, {
        ...seedInput,
        results,
      }),
    );
    await runMain(
      Effect.logInfo("crawler.seed_and_ingest.completed", {
        sourceName: seedInput.sourceName,
        feedUrl: seedInput.feedUrl,
        ...persisted,
      }).pipe(Effect.provide(appLayer)),
    );
  } else {
    const feedUrl = args.positional[0];
    if (!feedUrl) {
      throw new Error(
        [
          "Usage:",
          "  bun src/index.ts <feed-url>",
          "  bun src/index.ts seed-and-ingest --feed-url <url> --source-name <name> --source-domain <domain> [--country-code <cc>] [--language <lang>] [--rss-only] [--no-snippet]",
        ].join("\n"),
      );
    }

    const results = await runMain(
      ingestFeed(feedUrl).pipe(Effect.provide(appLayer)),
    );
    await runMain(
      Effect.logInfo("crawler.results", { results }).pipe(
        Effect.provide(appLayer),
      ),
    );
  }
}

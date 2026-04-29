import { StructuredAiLive, resolveModelPolicy } from "@news/ai";
import {
  makeSnippet,
  parseFeed,
  validateFeedItemAgainstPage,
} from "@news/crawler-core";
import { loadServerEnv } from "@news/env";
import {
  HttpService,
  MetricsService,
  makeAppLayer,
  runMain,
} from "@news/platform";
import { USER_AGENT } from "@news/types";
import { Effect, Layer } from "effect";
import { parseArticleWithNewspaper } from "./article-metadata";
import { type SeedSourceInput, runSeededFeedIngestion } from "./pipeline";
import {
  type ReingestFailedVerificationInput,
  reingestFailedVerificationArticles,
} from "./reingest";

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

const reingestInputFromFlags = (
  flags: Map<string, string>,
): ReingestFailedVerificationInput => ({
  statuses: (flags.get("statuses") ?? "rss_mismatch_title,rss_mismatch_date")
    .split(",")
    .map((value) => value.trim())
    .filter(
      (value) => value.length > 0,
    ) as ReingestFailedVerificationInput["statuses"],
  sourceDomain: flags.get("source-domain") ?? null,
  limit: flags.get("limit") ? Number(flags.get("limit")) : 100,
  overrideTitleMismatches: flags.get("override-title-mismatches") === "true",
});

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const env = await Effect.runPromise(loadServerEnv(process.env));
  const appLayer = makeAppLayer(env);
  const activeModelPolicy = resolveModelPolicy(env);
  const structuredAiLayer = StructuredAiLive(resolveModelPolicy(env)).pipe(
    Layer.provide(appLayer),
  );
  const crawlerLayer = Layer.mergeAll(appLayer, structuredAiLayer);

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
        aiModelPolicy: activeModelPolicy,
      }).pipe(Effect.provide(crawlerLayer)),
    );
    await runMain(
      Effect.logInfo("crawler.seed_and_ingest.completed", {
        sourceName: seedInput.sourceName,
        feedUrl: seedInput.feedUrl,
        ...persisted,
      }).pipe(Effect.provide(appLayer)),
    );
  } else if (args.positional[0] === "reingest-failed-verification") {
    if (!env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for reingest-failed-verification",
      );
    }

    const outcome = await runMain(
      reingestFailedVerificationArticles(env.DATABASE_URL, {
        ...reingestInputFromFlags(args.flags),
        aiModelPolicy: activeModelPolicy,
      }).pipe(Effect.provide(crawlerLayer)),
    );
    await runMain(
      Effect.logInfo(
        "crawler.reingest_failed_verification.completed",
        outcome,
      ).pipe(Effect.provide(appLayer)),
    );
  } else {
    const feedUrl = args.positional[0];
    if (!feedUrl) {
      throw new Error(
        [
          "Usage:",
          "  bun src/index.ts <feed-url>",
          "  bun src/index.ts seed-and-ingest --feed-url <url> --source-name <name> --source-domain <domain> [--country-code <cc>] [--language <lang>] [--rss-only] [--no-snippet]",
          "  bun src/index.ts reingest-failed-verification [--statuses <csv>] [--source-domain <domain>] [--limit <n>] [--override-title-mismatches]",
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

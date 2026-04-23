import {
  extractMetadataEffect,
  makeSnippet,
  parseFeed,
  validateFeedItemAgainstPage,
} from "@news/crawler-core";
import {
  HttpService,
  MetricsService,
  loadServerEnv,
  makeAppLayer,
  runMain,
} from "@news/platform";
import { USER_AGENT } from "@news/types";
import { Effect } from "effect";

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
              const metadata = yield* extractMetadataEffect(
                yield* pageResponse.text,
                pageResponse.url,
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

if (import.meta.main) {
  const feedUrl = process.argv[2];
  if (!feedUrl) throw new Error("Usage: bun src/index.ts <feed-url>");
  const env = await Effect.runPromise(loadServerEnv(process.env));
  const results = await runMain(
    ingestFeed(feedUrl).pipe(Effect.provide(makeAppLayer(env))),
  );
  await runMain(
    Effect.logInfo("crawler.results", { results }).pipe(
      Effect.provide(makeAppLayer(env)),
    ),
  );
}

import type { AiModelPolicy } from "@news/ai";
import { articleVersions, articles, createDb, sources } from "@news/db";
import { HttpService, MetricsService } from "@news/platform";
import { USER_AGENT, normalizeUrl } from "@news/types";
import { eq } from "drizzle-orm";
import { Data, DateTime, Effect } from "effect";
import { parseArticleWithNewspaper } from "./article-metadata";
import {
  enqueueArticleAndSourceAiJobsBySource,
  rebuildStoriesAndQueueAiJobs,
} from "./pipeline";

const currentDate = DateTime.now.pipe(Effect.map(DateTime.toDateUtc));

const normalizeDomain = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();

const toOptionalString = (value: string | null | undefined) =>
  value ?? undefined;

const toNullableDate = (value: string | null | undefined) =>
  value ? DateTime.toDateUtc(DateTime.makeUnsafe(value)) : null;

const toOptionalDate = (value: string | null | undefined) =>
  toNullableDate(value) ?? undefined;

const snippetFromDescription = (description: string | null | undefined) => {
  if (!description) return undefined;
  const clean = description.replace(/\s+/g, " ").trim();
  return clean.length > 500 ? clean.slice(0, 500) : clean;
};

class ManualIntakeError extends Data.TaggedError("ManualIntakeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const tryIntake = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new ManualIntakeError({ message, cause }),
  });

export const ingestArticleUrls = (
  databaseUrl: string,
  input: {
    readonly urls: ReadonlyArray<string>;
    readonly aiModelPolicy?: AiModelPolicy;
  },
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const http = yield* HttpService;
    const metrics = yield* MetricsService;
    const now = yield* currentDate;
    const articleIdsBySource = new Map<string, string[]>();
    const processed: Array<{
      readonly requestedUrl: string;
      readonly canonicalUrl: string;
      readonly articleId: string;
      readonly sourceId: string;
      readonly title: string;
    }> = [];
    const failures: Array<{
      readonly requestedUrl: string;
      readonly error: string;
    }> = [];

    for (const rawUrl of input.urls) {
      const requestedUrl = normalizeUrl(rawUrl);
      const outcome = yield* Effect.gen(function* () {
        const pageResponse = yield* http.request(requestedUrl, {
          headers: { "user-agent": USER_AGENT },
        });
        const pageHtml = yield* pageResponse.text;
        const metadata = yield* parseArticleWithNewspaper(
          pageResponse.url,
          pageHtml,
        );

        const canonicalUrl = normalizeUrl(metadata.canonicalUrl);
        const domain = normalizeDomain(new URL(canonicalUrl).hostname);
        const title = metadata.title?.trim() || canonicalUrl;
        const snippet = snippetFromDescription(metadata.description);

        const [existingSource] = yield* tryIntake(
          `Failed to load source for ${domain}`,
          () =>
            db
              .select()
              .from(sources)
              .where(eq(sources.domain, domain))
              .limit(1),
        );
        const source =
          existingSource ??
          (yield* tryIntake(`Failed to create source for ${domain}`, () =>
            db
              .insert(sources)
              .values({
                name: domain,
                domain,
                primaryLanguage: metadata.language,
                rssOnly: false,
                noSnippet: false,
              })
              .returning(),
          ))[0];

        if (!source) {
          return yield* new ManualIntakeError({
            message: `Could not create source for ${domain}`,
          });
        }

        const [article] = yield* tryIntake(
          `Failed to persist article for ${canonicalUrl}`,
          () =>
            db
              .insert(articles)
              .values({
                sourceId: source.id,
                canonicalUrl,
                title,
                snippet,
                author: toOptionalString(metadata.author),
                publishedAt: toOptionalDate(metadata.publishedAt),
                updatedAt: now,
                language: toOptionalString(metadata.language),
                type: "unknown",
                paywalled: metadata.paywalled,
                crawlStatus: "rss_verified",
              })
              .onConflictDoUpdate({
                target: articles.canonicalUrl,
                set: {
                  sourceId: source.id,
                  title,
                  snippet,
                  author: toOptionalString(metadata.author),
                  publishedAt: toOptionalDate(metadata.publishedAt),
                  updatedAt: now,
                  language: toOptionalString(metadata.language),
                  paywalled: metadata.paywalled,
                  crawlStatus: "rss_verified",
                },
              })
              .returning({ id: articles.id }),
        );

        if (!article) {
          return yield* new ManualIntakeError({
            message: `Could not persist article for ${canonicalUrl}`,
          });
        }

        yield* tryIntake(
          `Failed to store article version for ${canonicalUrl}`,
          () =>
            db.insert(articleVersions).values({
              articleId: article.id,
              title,
              snippet,
              metadata: {
                manualEnqueue: true,
                requestedUrl,
                fetchedUrl: pageResponse.url,
                canonicalUrl,
              },
              capturedAt: now,
            }),
        );

        return {
          requestedUrl,
          canonicalUrl,
          articleId: article.id,
          sourceId: source.id,
          title,
        };
      }).pipe(
        Effect.map((success) => ({ _tag: "success" as const, success })),
        Effect.catchIf(
          () => true,
          (error: unknown) => Effect.succeed({ _tag: "error" as const, error }),
        ),
      );

      if (outcome._tag === "error") {
        failures.push({
          requestedUrl,
          error:
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error),
        });
        yield* metrics.increment("crawl.extraction_failure");
        continue;
      }

      articleIdsBySource.set(outcome.success.sourceId, [
        ...(articleIdsBySource.get(outcome.success.sourceId) ?? []),
        outcome.success.articleId,
      ]);
      processed.push(outcome.success);
      yield* metrics.increment("crawl.success");
    }

    if (articleIdsBySource.size === 0) {
      return {
        processed,
        failures,
        articleAiJobCount: 0,
        sourceAiJobCount: 0,
        storyCount: 0,
      };
    }

    const enqueued = yield* enqueueArticleAndSourceAiJobsBySource(
      databaseUrl,
      articleIdsBySource,
    );
    const clustered = yield* rebuildStoriesAndQueueAiJobs(databaseUrl, {
      aiModelPolicy: input.aiModelPolicy,
    });

    return {
      processed,
      failures,
      articleAiJobCount: enqueued.articleJobCount,
      sourceAiJobCount: enqueued.sourceJobCount,
      storyCount: clustered.storyCount,
    };
  });

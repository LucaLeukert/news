import {
  decodeHtmlEntities,
  type FeedItem,
  validateFeedItemAgainstPage,
} from "@news/crawler-core";
import type { AiModelPolicy } from "@news/ai";
import { articleVersions, articles, createDb, sources } from "@news/db";
import { HttpService, MetricsService } from "@news/platform";
import { type CrawlValidationState, USER_AGENT, normalizeUrl } from "@news/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import { parseArticleWithNewspaper } from "./article-metadata";
import {
  enqueueArticleAndSourceAiJobsBySource,
  rebuildStoriesAndQueueAiJobs,
  type IngestedFeedItem,
} from "./pipeline";

export type ReingestFailedVerificationInput = {
  readonly statuses?: ReadonlyArray<CrawlValidationState>;
  readonly sourceDomain?: string | null;
  readonly limit?: number;
  readonly overrideTitleMismatches?: boolean;
  readonly aiModelPolicy?: AiModelPolicy;
};

const DEFAULT_REINGEST_STATUSES = [
  "rss_mismatch_title",
  "rss_mismatch_date",
  "canonical_failed",
  "extraction_failed",
] as const satisfies ReadonlyArray<CrawlValidationState>;

const normalizeDomain = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();

const currentDate = DateTime.now.pipe(Effect.map(DateTime.toDateUtc));

const normalizeReingestStatuses = (
  statuses: ReingestFailedVerificationInput["statuses"],
) => {
  const allowed = new Set<CrawlValidationState>(DEFAULT_REINGEST_STATUSES);
  if (!statuses || statuses.length === 0) {
    return [...DEFAULT_REINGEST_STATUSES];
  }

  const normalized = [...new Set(statuses)].filter((status) =>
    allowed.has(status),
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_REINGEST_STATUSES];
};

const toOptionalString = (value: string | null | undefined) => value ?? undefined;

const toNullableDate = (value: string | null | undefined) =>
  value ? DateTime.toDateUtc(DateTime.makeUnsafe(value)) : null;

const toOptionalDate = (value: string | null | undefined) =>
  toNullableDate(value) ?? undefined;

const snippetFromDescription = (
  description: string | null | undefined,
  noSnippet: boolean,
) => {
  if (noSnippet || !description) return undefined;
  const clean = description.replace(/\s+/g, " ").trim();
  return clean.length > 500 ? clean.slice(0, 500) : clean;
};

export const reingestFailedVerificationArticles = (
  databaseUrl: string,
  input: ReingestFailedVerificationInput = {},
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const http = yield* HttpService;
    const metrics = yield* MetricsService;
    const now = yield* currentDate;
    const statuses = normalizeReingestStatuses(input.statuses);
    const limit = Math.max(1, input.limit ?? 100);

    const candidates = yield* Effect.tryPromise({
      try: () =>
        db
          .select({
            article: articles,
            source: sources,
          })
          .from(articles)
          .innerJoin(sources, eq(articles.sourceId, sources.id))
          .where(
            and(
              inArray(articles.crawlStatus, statuses),
              input.sourceDomain
                ? eq(sources.domain, normalizeDomain(input.sourceDomain))
                : undefined,
            ),
          )
          .orderBy(desc(articles.updatedAt), desc(articles.createdAt))
          .limit(limit),
      catch: (cause) =>
        new Error(
          `Failed to load failed-verification articles for reingest: ${String(cause)}`,
        ),
    });

    if (candidates.length === 0) {
      return {
        processedCount: 0,
        reverifiedCount: 0,
        overriddenToVerifiedCount: 0,
        stillFailingCount: 0,
        skippedMissingFeedMetadataCount: 0,
        articleAiJobCount: 0,
        sourceAiJobCount: 0,
        storyCount: 0,
      };
    }

    const versionRows = yield* Effect.tryPromise({
      try: () =>
        db
          .select()
          .from(articleVersions)
          .where(
            inArray(
              articleVersions.articleId,
              candidates.map((row) => row.article.id),
            ),
          )
          .orderBy(desc(articleVersions.capturedAt)),
      catch: (cause) =>
        new Error(
          `Failed to load article versions for failed-verification reingest: ${String(cause)}`,
        ),
    });

    const latestFeedMetadata = new Map<
      string,
      {
        readonly feedTitle: string;
        readonly feedPublishedAt: string | null;
      }
    >();

    for (const row of versionRows) {
      if (latestFeedMetadata.has(row.articleId)) continue;
      const feedTitle = row.metadata["feedTitle"];
      const feedPublishedAt = row.metadata["feedPublishedAt"];
      if (typeof feedTitle !== "string" || feedTitle.trim().length === 0) {
        continue;
      }
      latestFeedMetadata.set(row.articleId, {
        feedTitle: decodeHtmlEntities(feedTitle),
        feedPublishedAt:
          typeof feedPublishedAt === "string" ? feedPublishedAt : null,
      });
    }

    let processedCount = 0;
    let reverifiedCount = 0;
    let overriddenToVerifiedCount = 0;
    let stillFailingCount = 0;
    let skippedMissingFeedMetadataCount = 0;
    const articleIdsBySource = new Map<string, string[]>();

    for (const candidate of candidates) {
      const feedMetadata = latestFeedMetadata.get(candidate.article.id);
      if (!feedMetadata) {
        skippedMissingFeedMetadataCount += 1;
        continue;
      }

      const feedItem: FeedItem = {
        title: feedMetadata.feedTitle,
        url: candidate.article.canonicalUrl,
        publishedAt:
          feedMetadata.feedPublishedAt ??
          candidate.article.publishedAt?.toISOString() ??
          null,
        sourceName: candidate.source.name,
      };

      const outcome = yield* http
        .request(candidate.article.canonicalUrl, {
          headers: { "user-agent": USER_AGENT },
        })
        .pipe(
          Effect.flatMap((pageResponse) =>
            Effect.gen(function* () {
              const pageHtml = yield* pageResponse.text;
              const parsed = yield* parseArticleWithNewspaper(
                pageResponse.url,
                pageHtml,
              );
              const validationState = validateFeedItemAgainstPage(
                feedItem,
                parsed,
              );
              return {
                metadata: {
                  ...parsed,
                  description: parsed.description,
                },
                validationState,
              } satisfies Pick<IngestedFeedItem, "metadata" | "validationState">;
            }),
          ),
          Effect.catchIf(
            () => true,
            () =>
              Effect.succeed({
                metadata: undefined,
                validationState: "canonical_failed" as const,
              }),
          ),
        );

      const effectiveValidationState =
        outcome.validationState === "rss_mismatch_title" &&
        input.overrideTitleMismatches === true
          ? "rss_verified"
          : outcome.validationState;

      if (effectiveValidationState === "rss_verified") {
        reverifiedCount += 1;
        if (outcome.validationState === "rss_mismatch_title") {
          overriddenToVerifiedCount += 1;
        }
        yield* metrics.increment("crawl.success");
      } else {
        stillFailingCount += 1;
        if (effectiveValidationState === "extraction_failed") {
          yield* metrics.increment("crawl.extraction_failure");
        } else {
          yield* metrics.increment("crawl.rss_page_mismatch", {
            validationState: effectiveValidationState,
          });
        }
      }

      const nextSnippet = outcome.metadata
        ? snippetFromDescription(
            outcome.metadata.description,
            candidate.source.noSnippet,
          )
        : candidate.article.snippet;
      const nextCanonicalUrl = outcome.metadata
        ? normalizeUrl(outcome.metadata.canonicalUrl)
        : candidate.article.canonicalUrl;
      const nextTitle = outcome.metadata?.title ?? candidate.article.title;

      yield* Effect.tryPromise({
        try: () =>
          db
            .update(articles)
            .set({
              sourceId: candidate.source.id,
              canonicalUrl: nextCanonicalUrl,
              title: nextTitle,
              snippet: nextSnippet,
              author: outcome.metadata
                ? toOptionalString(outcome.metadata.author)
                : candidate.article.author ?? undefined,
              publishedAt: outcome.metadata
                ? toOptionalDate(outcome.metadata.publishedAt)
                : candidate.article.publishedAt ?? undefined,
              updatedAt: now,
              language: outcome.metadata
                ? toOptionalString(outcome.metadata.language)
                : candidate.article.language ?? undefined,
              paywalled:
                outcome.metadata?.paywalled ?? candidate.article.paywalled,
              crawlStatus: effectiveValidationState,
            })
            .where(eq(articles.id, candidate.article.id)),
        catch: (cause) =>
          new Error(
            `Failed to update article ${candidate.article.id} during reingest: ${String(cause)}`,
          ),
      });

      yield* Effect.tryPromise({
        try: () =>
          db.insert(articleVersions).values({
            articleId: candidate.article.id,
            title: nextTitle,
            snippet: nextSnippet,
            metadata: {
              feedTitle: feedMetadata.feedTitle,
              feedPublishedAt: feedMetadata.feedPublishedAt,
              validationState: effectiveValidationState,
              originalValidationState: outcome.validationState,
              canonicalUrl: nextCanonicalUrl,
              reingestedAt: now.toISOString(),
              overrideTitleMismatch:
                outcome.validationState === "rss_mismatch_title" &&
                effectiveValidationState === "rss_verified",
            },
            capturedAt: now,
          }),
        catch: (cause) =>
          new Error(
            `Failed to capture article version for ${candidate.article.id} during reingest: ${String(cause)}`,
          ),
      });

      articleIdsBySource.set(candidate.source.id, [
        ...(articleIdsBySource.get(candidate.source.id) ?? []),
        candidate.article.id,
      ]);
      processedCount += 1;
    }

    const enqueued = yield* enqueueArticleAndSourceAiJobsBySource(
      databaseUrl,
      articleIdsBySource,
    );
    const clustered = yield* rebuildStoriesAndQueueAiJobs(databaseUrl, {
      aiModelPolicy: input.aiModelPolicy,
    });

    return {
      processedCount,
      reverifiedCount,
      overriddenToVerifiedCount,
      stillFailingCount,
      skippedMissingFeedMetadataCount,
      articleAiJobCount: enqueued.articleJobCount,
      sourceAiJobCount: enqueued.sourceJobCount,
      storyCount: clustered.storyCount,
    };
  });

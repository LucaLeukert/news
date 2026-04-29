import {
  type AiModelPolicy,
  generateEmbeddings,
  modelForFeature,
  modelPolicy,
  rerankDocuments,
} from "@news/ai";
import {
  type ClusterableArticle,
  clusterArticles,
  semanticClusteringTextFor,
  semanticPairKey,
} from "@news/clusterer";
import {
  aiJobs,
  aiResults,
  appendAiJobEvents,
  articleVersions,
  articles,
  createDb,
  entities,
  sourceFeeds,
  sourceRatings,
  sources,
  stories,
  storyArticles,
  storyEntities,
  storyMetrics,
} from "@news/db";
import {
  type CrawlValidationState,
  type SafetyComplianceOutput,
  type SemanticStoryClusteringSupportOutput,
  type StorySummaryOutput,
  articleExtractionQaOutputSchema,
  biasContextOutputSchema,
  claimExtractionOutputSchema,
  decodeUnknownSync,
  factualityReliabilitySupportOutputSchema,
  normalizeUrl,
  ownershipExtractionSupportOutputSchema,
  safetyComplianceOutputSchema,
  shouldTreatArticleExtractionAsValid,
  storyClusteringSupportOutputSchema,
  storySummaryLooksSuspicious,
  storySummaryOutputSchema,
} from "@news/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Data, DateTime, Effect } from "effect";

export type SeedSourceInput = {
  readonly sourceName: string;
  readonly sourceDomain: string;
  readonly feedUrl: string;
  readonly countryCode?: string | null;
  readonly primaryLanguage?: string | null;
  readonly rssOnly?: boolean;
  readonly noSnippet?: boolean;
};

export type IngestedFeedItem = {
  readonly item: {
    readonly title: string;
    readonly url: string;
    readonly publishedAt: string | null;
    readonly sourceName: string | null;
  };
  readonly metadata?: {
    readonly canonicalUrl: string;
    readonly title: string | null;
    readonly description: string | null;
    readonly author: string | null;
    readonly publishedAt: string | null;
    readonly language: string | null;
    readonly paywalled: boolean;
  };
  readonly validationState: CrawlValidationState;
};

class CrawlPipelineError extends Data.TaggedError("CrawlPipelineError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const tryPipeline = <A>(message: string, try_: () => Promise<A>) =>
  Effect.tryPromise({
    try: try_,
    catch: (cause) => new CrawlPipelineError({ message, cause }),
  });

const currentDate = DateTime.now.pipe(Effect.map(DateTime.toDateUtc));

const normalizeDomain = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/^www\./, "")
    .trim();

const toNullableDate = (value: string | null | undefined) =>
  value ? DateTime.toDateUtc(DateTime.makeUnsafe(value)) : null;

const toOptionalString = (value: string | null | undefined) =>
  value ?? undefined;

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

const storySummaryPayloadFor = (cluster: {
  readonly story: { readonly id: string; readonly title: string };
  readonly articles: ReadonlyArray<ClusterableArticle>;
}) => ({
  storyId: cluster.story.id,
  storyTitle: cluster.story.title,
  articles: cluster.articles.map((article) => ({
    id: article.id,
    title: article.title,
    snippet: article.snippet,
    source: article.publisher,
  })),
});

const clusteringSupportPayloadFor = (cluster: {
  readonly story: { readonly id: string; readonly title: string };
  readonly articles: ReadonlyArray<ClusterableArticle>;
}) => ({
  storyId: cluster.story.id,
  storyTitle: cluster.story.title,
  articles: cluster.articles.map((article) => ({
    id: article.id,
    title: article.title,
    snippet: article.snippet,
    source: article.publisher,
  })),
});

const normalizeEntityKey = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeClaimKey = (value: string) =>
  normalizeEntityKey(value)
    .split("-")
    .filter((token) => token.length >= 4)
    .slice(0, 10)
    .join("-");

const STORY_REBUILD_LOCK_ID = 448_210_01;
const PUBLIC_CONFIDENCE_THRESHOLD = 0.8;
const SOFT_METADATA_CONFIDENCE_THRESHOLD = 0.6;
const CLUSTERING_SEMANTIC_TIME_WINDOW_MS = 3 * 86_400_000;
const CLUSTERING_MAX_EMBEDDING_NEIGHBORS = 6;
const CLUSTERING_MIN_COSINE_SIMILARITY = 0.55;
const CLUSTERING_MIN_SEMANTIC_PAIR_SCORE = 0.58;
const decodeArticleExtractionQaOutput = decodeUnknownSync(
  articleExtractionQaOutputSchema,
);
const decodeClaimExtractionOutput = decodeUnknownSync(
  claimExtractionOutputSchema,
);
const decodeStoryClusteringSupportOutput = decodeUnknownSync(
  storyClusteringSupportOutputSchema,
);
const decodeStorySummaryOutput = decodeUnknownSync(storySummaryOutputSchema);
const decodeBiasContextOutput = decodeUnknownSync(biasContextOutputSchema);
const decodeFactualityReliabilitySupportOutput = decodeUnknownSync(
  factualityReliabilitySupportOutputSchema,
);
const decodeOwnershipExtractionSupportOutput = decodeUnknownSync(
  ownershipExtractionSupportOutputSchema,
);
const decodeSafetyComplianceOutput = decodeUnknownSync(
  safetyComplianceOutputSchema,
);

const decodeOrNull = <A>(decode: (value: unknown) => A, value: unknown) => {
  try {
    return decode(value);
  } catch {
    return null;
  }
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const cosineSimilarity = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
) => {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

const normalizeRerankScore = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value <= 1) return value;
  return 1 - Math.exp(-value);
};

const isWithinSemanticTimeWindow = (
  left: string | null,
  right: string | null,
) => {
  if (!left || !right) {
    return true;
  }

  return (
    Math.abs(Date.parse(left) - Date.parse(right)) <=
    CLUSTERING_SEMANTIC_TIME_WINDOW_MS
  );
};

type SemanticPairScoreDetail = {
  readonly leftArticleId: string;
  readonly rightArticleId: string;
  readonly embeddingSimilarity: number;
  readonly rerankScore: number | null;
  readonly finalScore: number;
};

type SemanticPairScoreComputation = {
  readonly pairScores: ReadonlyMap<string, number>;
  readonly pairDetails: ReadonlyArray<SemanticPairScoreDetail>;
  readonly rerankingSupported: boolean;
};

const feedValidationStateFromResults = (
  results: ReadonlyArray<IngestedFeedItem>,
): CrawlValidationState | null => {
  if (results.some((item) => item.validationState === "rss_verified")) {
    return "rss_verified";
  }
  return results[0]?.validationState ?? null;
};

const buildSemanticPairScores = (
  clusterableArticles: ReadonlyArray<ClusterableArticle>,
  _policy: AiModelPolicy,
) =>
  Effect.gen(function* () {
    if (clusterableArticles.length < 2) {
      return {
        pairScores: new Map<string, number>(),
        pairDetails: [],
        rerankingSupported: false,
      } satisfies SemanticPairScoreComputation;
    }

    const semanticTexts = clusterableArticles.map((article) =>
      semanticClusteringTextFor(article),
    );
    const embeddings = yield* generateEmbeddings({
      texts: semanticTexts,
    }).pipe(
      Effect.catchIf(
        () => true,
        (error: unknown) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              "crawler.clustering.semantic_embeddings.batch_failed",
              { error },
            );
            return yield* Effect.forEach(
              semanticTexts,
              (text, index) =>
                generateEmbeddings({
                  texts: [text],
                }).pipe(
                  Effect.map((rows) => rows[0] ?? []),
                  Effect.catchIf(
                    () => true,
                    (singleError: unknown) =>
                      Effect.gen(function* () {
                        yield* Effect.logWarning(
                          "crawler.clustering.semantic_embeddings.single_failed",
                          {
                            articleId:
                              clusterableArticles[index]?.id ?? "unknown",
                            error: singleError,
                          },
                        );
                        return [] as ReadonlyArray<number>;
                      }),
                  ),
                ),
              { concurrency: 1 },
            );
          }),
      ),
    );

    if (embeddings.length !== clusterableArticles.length) {
      return {
        pairScores: new Map<string, number>(),
        pairDetails: [],
        rerankingSupported: false,
      } satisfies SemanticPairScoreComputation;
    }

    const pairScores = new Map<string, number>();
    const pairDetails: SemanticPairScoreDetail[] = [];
    let rerankingSupported = true;

    for (let index = 0; index < clusterableArticles.length; index += 1) {
      const article = clusterableArticles[index];
      const embedding = embeddings[index];
      if (!article || !embedding) continue;

      const candidates = clusterableArticles
        .map((candidate, candidateIndex) => {
          if (candidateIndex === index) {
            return null;
          }
          if (
            !isWithinSemanticTimeWindow(
              article.publishedAt,
              candidate.publishedAt,
            )
          ) {
            return null;
          }
          const candidateEmbedding = embeddings[candidateIndex];
          if (!candidateEmbedding) {
            return null;
          }
          const cosine = cosineSimilarity(embedding, candidateEmbedding);
          if (cosine < CLUSTERING_MIN_COSINE_SIMILARITY) {
            return null;
          }
          return {
            articleId: candidate.id,
            text: semanticTexts[candidateIndex] ?? "",
            cosine,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null)
        .sort((left, right) => right.cosine - left.cosine)
        .slice(0, CLUSTERING_MAX_EMBEDDING_NEIGHBORS);

      if (candidates.length === 0) {
        continue;
      }

      const reranked = yield* rerankDocuments({
        query: semanticTexts[index] ?? article.title,
        documents: candidates.map((candidate) => candidate.text),
        topN: candidates.length,
      }).pipe(
        Effect.catchIf(
          () => true,
          (error: unknown) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                "crawler.clustering.semantic_rerank.failed",
                {
                  articleId: article.id,
                  error,
                },
              );
              if (
                typeof error === "object" &&
                error !== null &&
                "_tag" in error &&
                error._tag === "AiGatewayError" &&
                "message" in error &&
                error.message ===
                  "Configured provider does not support reranking models"
              ) {
                rerankingSupported = false;
              }
              return candidates.map((candidate, candidateIndex) => ({
                originalIndex: candidateIndex,
                score: candidate.cosine,
                document: candidate.text,
              }));
            }),
        ),
      );

      for (const rerankedCandidate of reranked) {
        const candidate = candidates[rerankedCandidate.originalIndex];
        if (!candidate) {
          continue;
        }
        const rerankScore = rerankingSupported
          ? normalizeRerankScore(rerankedCandidate.score)
          : null;
        const semanticScore = Number(
          (
            candidate.cosine * 0.45 +
            (rerankScore ?? candidate.cosine) * 0.55
          ).toFixed(3),
        );
        if (semanticScore < CLUSTERING_MIN_SEMANTIC_PAIR_SCORE) {
          continue;
        }

        const key = semanticPairKey(article.id, candidate.articleId);
        pairScores.set(key, Math.max(pairScores.get(key) ?? 0, semanticScore));
        pairDetails.push({
          leftArticleId: article.id,
          rightArticleId: candidate.articleId,
          embeddingSimilarity: clamp01(Number(candidate.cosine.toFixed(3))),
          rerankScore:
            rerankScore === null
              ? null
              : clamp01(Number(rerankScore.toFixed(3))),
          finalScore: clamp01(semanticScore),
        });
      }
    }

    yield* Effect.logInfo("crawler.clustering.semantic_pairs.completed", {
      articleCount: clusterableArticles.length,
      pairCount: pairScores.size,
    });

    return {
      pairScores,
      pairDetails,
      rerankingSupported,
    } satisfies SemanticPairScoreComputation;
  });

const persistSemanticClusteringSupportResult = (
  databaseUrl: string,
  input: {
    readonly clusterableArticles: ReadonlyArray<ClusterableArticle>;
    readonly semanticComputation: SemanticPairScoreComputation;
    readonly policy: AiModelPolicy;
  },
) =>
  Effect.gen(function* () {
    if (input.clusterableArticles.length === 0) {
      return;
    }

    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const storyId = normalizeEntityKey(
      input.clusterableArticles
        .map((article) => article.id)
        .sort()
        .join("-"),
    );
    const payload = {
      storyId,
      storyTitle:
        input.clusterableArticles[0]?.title ?? "semantic clustering support",
      articles: input.clusterableArticles.map((article) => ({
        id: article.id,
        title: article.title,
        snippet: article.snippet,
        source: article.publisher,
      })),
    };
    const structuredOutput = {
      embedding_model: modelForFeature("embeddings", input.policy),
      reranking_model: input.semanticComputation.rerankingSupported
        ? modelForFeature("reranking", input.policy)
        : null,
      reranking_supported: input.semanticComputation.rerankingSupported,
      article_pair_scores: input.semanticComputation.pairDetails.map(
        (detail) => ({
          left_article_id: detail.leftArticleId,
          right_article_id: detail.rightArticleId,
          embedding_similarity: detail.embeddingSimilarity,
          rerank_score: detail.rerankScore,
          final_score: detail.finalScore,
        }),
      ),
      confidence:
        input.semanticComputation.pairDetails.length === 0
          ? 0
          : clamp01(
              Number(
                (
                  input.semanticComputation.pairDetails.reduce(
                    (sum, detail) => sum + detail.finalScore,
                    0,
                  ) / input.semanticComputation.pairDetails.length
                ).toFixed(3),
              ),
            ),
    } satisfies SemanticStoryClusteringSupportOutput;

    const [job] = yield* tryPipeline(
      "Failed to create semantic clustering AI job",
      () =>
        db
          .insert(aiJobs)
          .values({
            type: "semantic_story_clustering_support",
            status: "completed",
            priority: Math.max(1, 60 - input.clusterableArticles.length),
            payload,
            inputArtifactIds: input.clusterableArticles.map(
              (article) => article.id,
            ),
            leasedBy: null,
            leaseExpiresAt: null,
            attempts: 0,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: aiJobs.id }),
    );

    if (!job) {
      return;
    }

    yield* tryPipeline("Failed to log semantic clustering AI job", () =>
      appendAiJobEvents(db, [
        {
          jobId: job.id,
          attemptNumber: 0,
          eventType: "queued",
          message: "Semantic clustering support job materialized",
          details: {
            articleCount: input.clusterableArticles.length,
          },
          createdAt: now,
        },
        {
          jobId: job.id,
          attemptNumber: 0,
          eventType: "completed",
          message: "Semantic clustering support computed synchronously",
          details: {
            pairCount: input.semanticComputation.pairDetails.length,
            rerankingSupported: input.semanticComputation.rerankingSupported,
          },
          createdAt: now,
        },
      ]),
    );

    yield* tryPipeline("Failed to persist semantic clustering AI result", () =>
      db.insert(aiResults).values({
        jobId: job.id,
        modelName: input.semanticComputation.rerankingSupported
          ? `${modelForFeature("embeddings", input.policy)} + ${modelForFeature("reranking", input.policy)}`
          : modelForFeature("embeddings", input.policy),
        modelVersion: input.semanticComputation.rerankingSupported
          ? `${modelForFeature("embeddings", input.policy)} + ${modelForFeature("reranking", input.policy)}`
          : modelForFeature("embeddings", input.policy),
        promptVersion: "semantic-story-clustering-support@2026-04-28",
        inputArtifactIds: input.clusterableArticles.map(
          (article) => article.id,
        ),
        outputSchemaVersion: "1",
        structuredOutput,
        confidence: structuredOutput.confidence,
        reasons: input.semanticComputation.rerankingSupported
          ? ["semantic pair scores derived from embeddings and reranking"]
          : ["semantic pair scores derived from embeddings"],
        citationsToInputIds: input.clusterableArticles.map(
          (article) => article.id,
        ),
        validationStatus: "valid",
        latencyMs: 0,
        createdAt: now,
      }),
    );
  });

export const ensureSourceWithFeed = (
  databaseUrl: string,
  input: SeedSourceInput,
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const sourceDomain = normalizeDomain(input.sourceDomain);
    const feedUrl = normalizeUrl(input.feedUrl);

    const [source] = yield* tryPipeline(
      `Failed to upsert source ${sourceDomain}`,
      () =>
        db
          .insert(sources)
          .values({
            name: input.sourceName,
            domain: sourceDomain,
            countryCode: input.countryCode ?? null,
            primaryLanguage: input.primaryLanguage ?? null,
            rssOnly: input.rssOnly ?? false,
            noSnippet: input.noSnippet ?? false,
          })
          .onConflictDoUpdate({
            target: sources.domain,
            set: {
              name: input.sourceName,
              countryCode: input.countryCode ?? null,
              primaryLanguage: input.primaryLanguage ?? null,
              rssOnly: input.rssOnly ?? false,
              noSnippet: input.noSnippet ?? false,
              updatedAt: now,
            },
          })
          .returning({ id: sources.id, noSnippet: sources.noSnippet }),
    );
    if (!source) {
      return yield* new CrawlPipelineError({
        message: `Source upsert returned no row for ${sourceDomain}`,
      });
    }

    const [feed] = yield* tryPipeline(`Failed to upsert feed ${feedUrl}`, () =>
      db
        .insert(sourceFeeds)
        .values({
          sourceId: source.id,
          feedUrl,
        })
        .onConflictDoUpdate({
          target: sourceFeeds.feedUrl,
          set: {
            sourceId: source.id,
          },
        })
        .returning({ id: sourceFeeds.id, feedUrl: sourceFeeds.feedUrl }),
    );
    if (!feed) {
      return yield* new CrawlPipelineError({
        message: `Feed upsert returned no row for ${feedUrl}`,
      });
    }

    return {
      sourceId: source.id,
      feedId: feed.id,
      feedUrl: feed.feedUrl,
      noSnippet: source.noSnippet,
    };
  });

export const persistFeedResults = (
  databaseUrl: string,
  input: {
    readonly sourceId: string;
    readonly feedId: string;
    readonly noSnippet: boolean;
    readonly results: ReadonlyArray<IngestedFeedItem>;
  },
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const persistedArticleIds: string[] = [];

    for (const result of input.results) {
      const metadata = result.metadata;
      const title = metadata?.title;
      if (!metadata || !title) {
        continue;
      }

      const snippet = snippetFromDescription(
        metadata.description,
        input.noSnippet,
      );
      const canonicalUrl = normalizeUrl(metadata.canonicalUrl);
      const [article] = yield* tryPipeline(
        `Failed to upsert article ${canonicalUrl}`,
        () =>
          db
            .insert(articles)
            .values({
              sourceId: input.sourceId,
              canonicalUrl,
              title,
              snippet,
              author: toOptionalString(metadata.author),
              publishedAt: toOptionalDate(metadata.publishedAt),
              updatedAt: now,
              language: toOptionalString(metadata.language),
              type: "unknown",
              paywalled: metadata.paywalled,
              crawlStatus: result.validationState,
            })
            .onConflictDoUpdate({
              target: articles.canonicalUrl,
              set: {
                sourceId: input.sourceId,
                title,
                snippet,
                author: toOptionalString(metadata.author),
                publishedAt: toOptionalDate(metadata.publishedAt),
                updatedAt: now,
                language: toOptionalString(metadata.language),
                paywalled: metadata.paywalled,
                crawlStatus: result.validationState,
              },
            })
            .returning({ id: articles.id }),
      );
      if (!article) {
        return yield* new CrawlPipelineError({
          message: `Article upsert returned no row for ${canonicalUrl}`,
        });
      }

      persistedArticleIds.push(article.id);

      yield* tryPipeline(
        `Failed to insert article version for ${canonicalUrl}`,
        () =>
          db.insert(articleVersions).values({
            articleId: article.id,
            title,
            snippet,
            metadata: {
              feedTitle: result.item.title,
              feedPublishedAt: result.item.publishedAt,
              validationState: result.validationState,
              canonicalUrl,
            },
            capturedAt: now,
          }),
      );
    }

    yield* tryPipeline(`Failed to update feed ${input.feedId}`, () =>
      db
        .update(sourceFeeds)
        .set({
          lastFetchedAt: now,
          validationState: feedValidationStateFromResults(input.results),
        })
        .where(eq(sourceFeeds.id, input.feedId)),
    );

    return {
      persistedArticleIds,
      persistedCount: persistedArticleIds.length,
    };
  });

const loadClusterableArticles = (databaseUrl: string) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const [
      articleRows,
      ratingRows,
      articleQaRows,
      claimResultRows,
      clusteringSupportRows,
    ] = yield* Effect.all([
      tryPipeline("Failed to load articles for clustering", () =>
        db
          .select({
            article: articles,
            source: sources,
          })
          .from(articles)
          .innerJoin(sources, eq(articles.sourceId, sources.id))
          .orderBy(desc(articles.publishedAt), desc(articles.createdAt)),
      ),
      tryPipeline("Failed to load source ratings for clustering", () =>
        db.select().from(sourceRatings).orderBy(desc(sourceRatings.createdAt)),
      ),
      tryPipeline("Failed to load article QA AI results", () =>
        db
          .select({
            inputArtifactIds: aiResults.inputArtifactIds,
            structuredOutput: aiResults.structuredOutput,
            confidence: aiResults.confidence,
            createdAt: aiResults.createdAt,
          })
          .from(aiResults)
          .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
          .where(
            and(
              eq(aiJobs.type, "article_extraction_qa"),
              eq(aiResults.validationStatus, "valid"),
            ),
          )
          .orderBy(desc(aiResults.createdAt)),
      ),
      tryPipeline("Failed to load claim extraction AI results", () =>
        db
          .select({
            inputArtifactIds: aiResults.inputArtifactIds,
            structuredOutput: aiResults.structuredOutput,
            createdAt: aiResults.createdAt,
          })
          .from(aiResults)
          .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
          .where(
            and(
              eq(aiJobs.type, "claim_extraction"),
              eq(aiResults.validationStatus, "valid"),
            ),
          )
          .orderBy(desc(aiResults.createdAt)),
      ),
      tryPipeline("Failed to load clustering-support AI results", () =>
        db
          .select({
            inputArtifactIds: aiResults.inputArtifactIds,
            structuredOutput: aiResults.structuredOutput,
            createdAt: aiResults.createdAt,
          })
          .from(aiResults)
          .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
          .where(
            and(
              eq(aiJobs.type, "story_clustering_support"),
              eq(aiResults.validationStatus, "valid"),
            ),
          )
          .orderBy(desc(aiResults.createdAt)),
      ),
    ]);

    const latestRatings = new Map<string, (typeof ratingRows)[number]>();
    for (const rating of ratingRows) {
      if (!latestRatings.has(rating.sourceId)) {
        latestRatings.set(rating.sourceId, rating);
      }
    }

    const articleQaById = new Map<
      string,
      {
        extractionValid: boolean;
        articleType: ClusterableArticle["articleType"];
        confidence: number;
      }
    >();
    for (const row of articleQaRows) {
      const output = decodeOrNull(
        decodeArticleExtractionQaOutput,
        row.structuredOutput,
      );
      if (!output) continue;
      for (const articleId of row.inputArtifactIds) {
        if (articleQaById.has(articleId)) {
          continue;
        }
        const extractionValid = shouldTreatArticleExtractionAsValid(output);
        articleQaById.set(articleId, {
          extractionValid,
          articleType: output.article_type ?? "news",
          confidence: output.confidence ?? row.confidence,
        });
      }
    }

    const articleEntityKeys = new Map<string, Set<string>>();
    const articleClaimKeys = new Map<string, Set<string>>();
    for (const row of claimResultRows) {
      const claimsOutput = decodeOrNull(
        decodeClaimExtractionOutput,
        row.structuredOutput,
      );
      if (!claimsOutput) continue;
      for (const articleId of row.inputArtifactIds) {
        if (
          articleEntityKeys.has(articleId) ||
          articleClaimKeys.has(articleId)
        ) {
          continue;
        }
        const entityKeys =
          articleEntityKeys.get(articleId) ?? new Set<string>();
        const claimKeys = articleClaimKeys.get(articleId) ?? new Set<string>();
        for (const claim of claimsOutput.claims ?? []) {
          if (
            (claim.confidence ?? 1) >= SOFT_METADATA_CONFIDENCE_THRESHOLD &&
            claim.text
          ) {
            const claimKey = normalizeClaimKey(claim.text);
            if (claimKey.length > 0) {
              claimKeys.add(claimKey);
            }
          }
          for (const entity of claim.entities ?? []) {
            const normalized = normalizeEntityKey(entity);
            if (normalized.length > 0) {
              entityKeys.add(normalized);
            }
          }
        }
        articleEntityKeys.set(articleId, entityKeys);
        articleClaimKeys.set(articleId, claimKeys);
      }
    }

    const articleSemanticCues = new Map<string, Set<string>>();
    const articleFingerprints = new Map<string, string>();
    for (const row of clusteringSupportRows) {
      const supportOutput = decodeOrNull(
        decodeStoryClusteringSupportOutput,
        row.structuredOutput,
      );
      if (!supportOutput) continue;
      for (const articleId of row.inputArtifactIds) {
        if (
          articleSemanticCues.has(articleId) ||
          articleFingerprints.has(articleId)
        ) {
          continue;
        }
        if (supportOutput.fingerprint) {
          articleFingerprints.set(articleId, supportOutput.fingerprint);
        }
        const cues = articleSemanticCues.get(articleId) ?? new Set<string>();
        for (const phrase of supportOutput.same_event_candidates ?? []) {
          const normalized = normalizeEntityKey(phrase);
          if (normalized.length > 0) {
            cues.add(normalized);
          }
        }
        articleSemanticCues.set(articleId, cues);
      }
    }

    return articleRows.map(({ article, source }) => {
      const rating = latestRatings.get(source.id);
      const qa = articleQaById.get(article.id);
      return {
        id: article.id,
        sourceId: article.sourceId,
        canonicalUrl: article.canonicalUrl,
        title: article.title,
        snippet: article.snippet,
        author: article.author,
        publishedAt: article.publishedAt?.toISOString() ?? null,
        language: article.language,
        articleType: qa?.articleType ?? article.type,
        paywalled: article.paywalled,
        crawlStatus: article.crawlStatus,
        publisher: source.name,
        country: source.countryCode,
        taxonomyBucket: rating?.taxonomyBucket,
        ownershipCategory: rating?.ownershipCategory ?? null,
        reliabilityBand: rating?.reliabilityBand ?? null,
        aiEntityKeys: [
          ...(articleEntityKeys.get(article.id) ?? new Set<string>()),
        ],
        aiClaimKeys: [
          ...(articleClaimKeys.get(article.id) ?? new Set<string>()),
        ],
        semanticCuePhrases: [
          ...(articleSemanticCues.get(article.id) ?? new Set<string>()),
        ],
        semanticFingerprint: articleFingerprints.get(article.id) ?? null,
        extractionValid: qa?.extractionValid,
        extractionConfidence: qa?.confidence,
      } satisfies ClusterableArticle;
    });
  });

const populateStoryEntities = (
  databaseUrl: string,
  clusters: ReadonlyArray<{
    readonly story: { readonly id: string };
    readonly articles: ReadonlyArray<ClusterableArticle>;
  }>,
) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);

    for (const cluster of clusters) {
      const entityConfidence = new Map<string, number>();
      for (const article of cluster.articles) {
        for (const key of article.aiEntityKeys ?? []) {
          entityConfidence.set(
            key,
            Math.max(entityConfidence.get(key) ?? 0, 0.75),
          );
        }
        for (const key of article.semanticCuePhrases ?? []) {
          entityConfidence.set(
            key,
            Math.max(entityConfidence.get(key) ?? 0, 0.6),
          );
        }
      }

      for (const [canonicalKey, confidence] of entityConfidence) {
        const [existing] = yield* tryPipeline(
          `Failed to load entity ${canonicalKey}`,
          () =>
            db
              .select()
              .from(entities)
              .where(eq(entities.canonicalKey, canonicalKey))
              .limit(1),
        );
        const entityId =
          existing?.id ??
          (yield* tryPipeline(`Failed to create entity ${canonicalKey}`, () =>
            db
              .insert(entities)
              .values({
                name: canonicalKey.replace(/-/g, " "),
                type: "ai_extracted",
                canonicalKey,
              })
              .returning({ id: entities.id }),
          ))[0]?.id;

        if (!entityId) {
          continue;
        }

        yield* tryPipeline(
          `Failed to link entity ${canonicalKey} to story ${cluster.story.id}`,
          () =>
            db.insert(storyEntities).values({
              storyId: cluster.story.id,
              entityId,
              confidence,
            }),
        );
      }
    }
  });

const enqueueArticleAndSourceAiJobs = (
  databaseUrl: string,
  input: {
    readonly sourceId: string;
    readonly articleIds: ReadonlyArray<string>;
  },
) =>
  Effect.gen(function* () {
    if (input.articleIds.length === 0) {
      return {
        articleJobCount: 0,
        sourceJobCount: 0,
      };
    }

    const db = createDb(databaseUrl);
    const now = yield* currentDate;
    const articleRows = yield* tryPipeline(
      "Failed to load articles for AI enqueue",
      () =>
        db
          .select({
            article: articles,
            source: sources,
          })
          .from(articles)
          .innerJoin(sources, eq(articles.sourceId, sources.id))
          .where(inArray(articles.id, [...input.articleIds])),
    );
    const first = articleRows[0];
    if (!first) {
      return {
        articleJobCount: 0,
        sourceJobCount: 0,
      };
    }

    const articleJobs: Array<typeof aiJobs.$inferInsert> = [];
    for (const row of articleRows) {
      const payload = {
        article: {
          articleId: row.article.id,
          sourceId: row.source.id,
          sourceName: row.source.name,
          sourceDomain: row.source.domain,
          countryCode: row.source.countryCode,
          title: row.article.title,
          snippet: row.article.snippet,
          author: row.article.author,
          publishedAt: row.article.publishedAt?.toISOString() ?? null,
          language: row.article.language,
          canonicalUrl: row.article.canonicalUrl,
        },
      };

      articleJobs.push(
        {
          type: "article_extraction_qa",
          status: "pending",
          priority: 10,
          payload,
          inputArtifactIds: [row.article.id],
          leasedBy: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          type: "claim_extraction",
          status: "pending",
          priority: 15,
          payload,
          inputArtifactIds: [row.article.id],
          leasedBy: null,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
      );
    }

    const sourcePayload = {
      sourceId: first.source.id,
      sourceName: first.source.name,
      domain: first.source.domain,
      countryCode: first.source.countryCode,
      primaryLanguage: first.source.primaryLanguage,
      recentArticleTitles: articleRows
        .map((row) => row.article.title)
        .slice(0, 8),
    };
    const sourceJobs: Array<typeof aiJobs.$inferInsert> = [
      {
        type: "bias_context_classification",
        status: "pending",
        priority: 20,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        type: "factuality_reliability_support",
        status: "pending",
        priority: 25,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        type: "ownership_extraction_support",
        status: "pending",
        priority: 30,
        payload: sourcePayload,
        inputArtifactIds: [first.source.id],
        leasedBy: null,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const insertedArticleJobs = yield* tryPipeline(
      "Failed to enqueue article AI jobs",
      () =>
        db
          .insert(aiJobs)
          .values(articleJobs)
          .returning({ id: aiJobs.id, type: aiJobs.type }),
    );
    const insertedSourceJobs = yield* tryPipeline(
      "Failed to enqueue source AI jobs",
      () =>
        db
          .insert(aiJobs)
          .values(sourceJobs)
          .returning({ id: aiJobs.id, type: aiJobs.type }),
    );
    yield* tryPipeline("Failed to log queued article/source AI jobs", () =>
      appendAiJobEvents(db, [
        ...insertedArticleJobs.map((job) => ({
          jobId: job.id,
          attemptNumber: 0,
          eventType: "queued",
          message: "Article AI job queued",
          details: {
            type: job.type,
          },
          createdAt: now,
        })),
        ...insertedSourceJobs.map((job) => ({
          jobId: job.id,
          attemptNumber: 0,
          eventType: "queued",
          message: "Source AI job queued",
          details: {
            type: job.type,
            sourceId: first.source.id,
          },
          createdAt: now,
        })),
      ]),
    );

    return {
      articleJobCount: articleJobs.length,
      sourceJobCount: sourceJobs.length,
    };
  });

export const enqueueArticleAndSourceAiJobsBySource = (
  databaseUrl: string,
  input: ReadonlyMap<string, ReadonlyArray<string>>,
) =>
  Effect.gen(function* () {
    let articleJobCount = 0;
    let sourceJobCount = 0;

    for (const [sourceId, articleIds] of input.entries()) {
      const enqueued = yield* enqueueArticleAndSourceAiJobs(databaseUrl, {
        sourceId,
        articleIds,
      });
      articleJobCount += enqueued.articleJobCount;
      sourceJobCount += enqueued.sourceJobCount;
    }

    return {
      articleJobCount,
      sourceJobCount,
    };
  });

type LatestValidAiRow = {
  readonly inputArtifactIds: ReadonlyArray<string>;
  readonly structuredOutput: unknown;
  readonly confidence: number;
  readonly createdAt: Date;
};

type LatestDecodedAiRow<A> = {
  readonly inputArtifactIds: ReadonlyArray<string>;
  readonly structuredOutput: A;
  readonly confidence: number;
  readonly createdAt: Date;
};

const latestDecodedAiRowsByInput = <A>(
  db: ReturnType<typeof createDb>,
  type: (typeof aiJobs.$inferSelect)["type"],
  decode: (value: unknown) => A,
): Effect.Effect<Map<string, LatestDecodedAiRow<A>>, CrawlPipelineError> =>
  Effect.gen(function* () {
    const rows: ReadonlyArray<LatestValidAiRow> = yield* tryPipeline(
      `Failed to load latest valid ${type} AI results`,
      () =>
        db
          .select({
            inputArtifactIds: aiResults.inputArtifactIds,
            structuredOutput: aiResults.structuredOutput,
            confidence: aiResults.confidence,
            createdAt: aiResults.createdAt,
          })
          .from(aiResults)
          .innerJoin(aiJobs, eq(aiResults.jobId, aiJobs.id))
          .where(
            and(eq(aiJobs.type, type), eq(aiResults.validationStatus, "valid")),
          )
          .orderBy(desc(aiResults.createdAt)),
    );

    const latest = new Map<string, LatestDecodedAiRow<A>>();
    for (const row of rows) {
      const structuredOutput = decodeOrNull(decode, row.structuredOutput);
      if (!structuredOutput) continue;
      for (const id of row.inputArtifactIds) {
        if (!latest.has(id)) {
          latest.set(id, {
            ...row,
            structuredOutput,
          });
        }
      }
    }
    return latest;
  });

const syncSourceRatingsFromAiResults = (databaseUrl: string) =>
  Effect.gen(function* () {
    const db = createDb(databaseUrl);
    const now = yield* currentDate;

    const [
      existingRatings,
      biasBySource,
      reliabilityBySource,
      ownershipBySource,
    ] = yield* Effect.all([
      tryPipeline("Failed to load current source ratings", () =>
        db.select().from(sourceRatings).orderBy(desc(sourceRatings.createdAt)),
      ),
      latestDecodedAiRowsByInput(
        db,
        "bias_context_classification",
        decodeBiasContextOutput,
      ),
      latestDecodedAiRowsByInput(
        db,
        "factuality_reliability_support",
        decodeFactualityReliabilitySupportOutput,
      ),
      latestDecodedAiRowsByInput(
        db,
        "ownership_extraction_support",
        decodeOwnershipExtractionSupportOutput,
      ),
    ]);

    const latestExistingRatings = new Map<
      string,
      (typeof existingRatings)[number]
    >();
    for (const rating of existingRatings) {
      if (!latestExistingRatings.has(rating.sourceId)) {
        latestExistingRatings.set(rating.sourceId, rating);
      }
    }

    const sourceIds = new Set([
      ...biasBySource.keys(),
      ...reliabilityBySource.keys(),
      ...ownershipBySource.keys(),
    ]);
    let inserted = 0;

    for (const sourceId of sourceIds) {
      const bias = biasBySource.get(sourceId);
      const reliability = reliabilityBySource.get(sourceId);
      const ownership = ownershipBySource.get(sourceId);
      const existing = latestExistingRatings.get(sourceId);
      const biasOutput = bias?.structuredOutput;
      const reliabilityOutput = reliability?.structuredOutput;
      const ownershipOutput = ownership?.structuredOutput;

      const biasConfidence = biasOutput?.confidence ?? bias?.confidence ?? 0;
      const reliabilityConfidence =
        reliabilityOutput?.confidence ?? reliability?.confidence ?? 0;
      const ownershipConfidence =
        ownershipOutput?.confidence ?? ownership?.confidence ?? 0;

      let taxonomyBucket = existing?.taxonomyBucket ?? "unrated";
      let reliabilityBand = existing?.reliabilityBand ?? null;
      let ownershipCategory = existing?.ownershipCategory ?? null;
      let evidence = existing?.evidence ?? [];
      let publishedAt = existing?.publishedAt ?? null;

      if (
        biasOutput?.publishable === true &&
        biasConfidence >= PUBLIC_CONFIDENCE_THRESHOLD &&
        biasOutput.evidence_strength !== "weak"
      ) {
        taxonomyBucket = biasOutput.taxonomy_bucket ?? "unrated";
        publishedAt = now;
      }

      if (reliabilityConfidence >= SOFT_METADATA_CONFIDENCE_THRESHOLD) {
        reliabilityBand = reliabilityOutput?.reliability_band ?? null;
      }

      if (
        ownershipOutput?.publishable === true &&
        ownershipConfidence >= PUBLIC_CONFIDENCE_THRESHOLD
      ) {
        ownershipCategory = ownershipOutput.ownership_category ?? null;
        evidence = ownershipOutput.citations.map((url) => ({
          url,
          note: "ownership citation",
        }));
        publishedAt = now;
      }

      yield* tryPipeline(`Failed to insert source rating ${sourceId}`, () =>
        db.insert(sourceRatings).values({
          sourceId,
          taxonomyBucket,
          reliabilityBand,
          ownershipCategory,
          confidence: Math.max(
            biasConfidence,
            reliabilityConfidence,
            ownershipConfidence,
          ),
          evidence,
          publishedAt,
          createdAt: now,
        }),
      );
      inserted += 1;
    }

    return inserted;
  });

const applyValidatedStorySummaries = (
  databaseUrl: string,
  storyIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (storyIds.length === 0) return 0;
    const db = createDb(databaseUrl);
    const latestSummaryByStory = yield* latestDecodedAiRowsByInput(
      db,
      "neutral_story_summary",
      decodeStorySummaryOutput,
    );
    const safetyByStory = yield* latestDecodedAiRowsByInput(
      db,
      "safety_compliance_check",
      decodeSafetyComplianceOutput,
    );
    const now = yield* currentDate;

    let applied = 0;
    for (const storyId of storyIds) {
      const summaryRow = latestSummaryByStory.get(storyId);
      if (!summaryRow) continue;
      const output: StorySummaryOutput = summaryRow.structuredOutput;
      const confidence = output.confidence ?? summaryRow.confidence;
      const safetyRow = safetyByStory.get(storyId);
      const safety: SafetyComplianceOutput | undefined =
        safetyRow?.structuredOutput;
      const safetyConfidence = safety?.confidence ?? safetyRow?.confidence ?? 0;
      const safe =
        Boolean(safetyRow) &&
        safety?.safe_to_publish === true &&
        safetyConfidence >= SOFT_METADATA_CONFIDENCE_THRESHOLD;

      if (
        confidence < PUBLIC_CONFIDENCE_THRESHOLD ||
        !safe ||
        !output.neutralSummary ||
        storySummaryLooksSuspicious({
          neutralSummary: output.neutralSummary,
          agreed: output.agreed ?? [],
          differs: output.differs ?? [],
          contestedOrUnverified: output.contestedOrUnverified ?? [],
          confidence,
          reasons: [],
        })
      ) {
        continue;
      }

      yield* tryPipeline(`Failed to apply story summary ${storyId}`, () =>
        db
          .update(stories)
          .set({
            summary: {
              neutralSummary: output.neutralSummary,
              agreed: output.agreed ?? [],
              differs: output.differs ?? [],
              contestedOrUnverified: output.contestedOrUnverified ?? [],
              confidence,
              lastUpdatedAt: now.toISOString(),
            },
          })
          .where(eq(stories.id, storyId)),
      );
      applied += 1;
    }
    return applied;
  });

export const rebuildStoriesAndQueueAiJobs = (
  databaseUrl: string,
  options: {
    readonly includeClusteringSupportJobs?: boolean;
    readonly aiModelPolicy?: AiModelPolicy;
  } = {},
) =>
  Effect.gen(function* () {
    const activePolicy = options.aiModelPolicy ?? modelPolicy;
    const db = createDb(databaseUrl);
    const rebuild = Effect.gen(function* () {
      const now = yield* currentDate;
      yield* syncSourceRatingsFromAiResults(databaseUrl);
      const clusterableArticles = yield* loadClusterableArticles(databaseUrl);
      const semanticComputation = yield* buildSemanticPairScores(
        clusterableArticles,
        activePolicy,
      );
      yield* persistSemanticClusteringSupportResult(databaseUrl, {
        clusterableArticles,
        semanticComputation,
        policy: activePolicy,
      });
      const clusters = clusterArticles(clusterableArticles, {
        semanticPairScores: semanticComputation.pairScores,
      });

      yield* tryPipeline("Failed to reset story graph", () =>
        db.execute(
          sql`TRUNCATE TABLE "story_entities", "story_articles", "story_metrics", "stories"`,
        ),
      );

      if (clusters.length === 0) {
        return {
          storyCount: 0,
          aiJobCount: 0,
        };
      }

      yield* tryPipeline("Failed to insert clustered stories", () =>
        db.insert(stories).values(
          clusters.map((cluster): typeof stories.$inferInsert => ({
            id: cluster.story.id,
            title: cluster.story.title,
            summary: null,
            topicTags: [...cluster.story.topicTags],
            firstSeenAt: toNullableDate(cluster.story.firstSeenAt) ?? now,
            lastSeenAt: toNullableDate(cluster.story.lastSeenAt) ?? now,
            disabledAt: null,
          })),
        ),
      );

      yield* tryPipeline("Failed to insert story/article links", () =>
        db.insert(storyArticles).values(
          clusters.flatMap((cluster) =>
            cluster.articles.map(
              (article): typeof storyArticles.$inferInsert => ({
                storyId: cluster.story.id,
                articleId: article.id,
                clusterConfidence: cluster.articleScores[article.id] ?? 0,
                createdAt: now,
              }),
            ),
          ),
        ),
      );

      yield* tryPipeline("Failed to insert story metrics", () =>
        db.insert(storyMetrics).values(
          clusters.map((cluster): typeof storyMetrics.$inferInsert => ({
            storyId: cluster.story.id,
            byCountry: cluster.story.coverage.byCountry,
            byLanguage: cluster.story.coverage.byLanguage,
            byTaxonomy: cluster.story.coverage.byTaxonomy,
            byOwnership: cluster.story.coverage.byOwnership,
            byReliability: cluster.story.coverage.byReliability,
            updatedAt: now,
          })),
        ),
      );
      yield* populateStoryEntities(databaseUrl, clusters);

      yield* tryPipeline("Failed to clear pending story-level AI jobs", () =>
        db
          .delete(aiJobs)
          .where(
            and(
              inArray(
                aiJobs.type,
                options.includeClusteringSupportJobs === false
                  ? ["neutral_story_summary", "safety_compliance_check"]
                  : [
                      "story_clustering_support",
                      "neutral_story_summary",
                      "safety_compliance_check",
                    ],
              ),
              eq(aiJobs.status, "pending"),
            ),
          ),
      );

      const insertedStoryJobs = yield* tryPipeline(
        "Failed to enqueue story-level AI jobs",
        () =>
          db
            .insert(aiJobs)
            .values(
              clusters.flatMap((cluster): Array<typeof aiJobs.$inferInsert> => {
                const jobs: Array<typeof aiJobs.$inferInsert> = [];
                if (options.includeClusteringSupportJobs !== false) {
                  jobs.push({
                    type: "story_clustering_support",
                    status: "pending",
                    priority: Math.max(1, 60 - cluster.articles.length),
                    payload: clusteringSupportPayloadFor(cluster),
                    inputArtifactIds: cluster.articles.map(
                      (article) => article.id,
                    ),
                    leasedBy: null,
                    leaseExpiresAt: null,
                    attempts: 0,
                    lastError: null,
                    createdAt: now,
                    updatedAt: now,
                  });
                }
                const summaryPayload = storySummaryPayloadFor(cluster);
                jobs.push({
                  type: "neutral_story_summary",
                  status: "pending",
                  priority: Math.max(1, 100 - cluster.articles.length),
                  payload: summaryPayload,
                  inputArtifactIds: [cluster.story.id],
                  leasedBy: null,
                  leaseExpiresAt: null,
                  attempts: 0,
                  lastError: null,
                  createdAt: now,
                  updatedAt: now,
                });
                return jobs;
              }),
            )
            .returning({
              id: aiJobs.id,
              type: aiJobs.type,
              inputArtifactIds: aiJobs.inputArtifactIds,
            }),
      );
      yield* tryPipeline("Failed to log queued story AI jobs", () =>
        appendAiJobEvents(
          db,
          insertedStoryJobs.map((job) => ({
            jobId: job.id,
            attemptNumber: 0,
            eventType: "queued",
            message: "Story-level AI job queued",
            details: {
              type: job.type,
              inputArtifactIds: job.inputArtifactIds,
            },
            createdAt: now,
          })),
        ),
      );

      yield* applyValidatedStorySummaries(
        databaseUrl,
        clusters.map((cluster) => cluster.story.id),
      );

      return {
        storyCount: clusters.length,
        aiJobCount:
          clusters.length *
          (options.includeClusteringSupportJobs === false ? 1 : 2),
      };
    });

    yield* tryPipeline("Failed to acquire story rebuild lock", () =>
      db.execute(sql`select pg_advisory_lock(${STORY_REBUILD_LOCK_ID})`),
    );
    return yield* rebuild.pipe(
      Effect.ensuring(
        tryPipeline("Failed to release story rebuild lock", () =>
          db.execute(sql`select pg_advisory_unlock(${STORY_REBUILD_LOCK_ID})`),
        ).pipe(
          Effect.catchIf(
            () => true,
            () => Effect.void,
          ),
          Effect.orDie,
        ),
      ),
    );
  });

export const runSeededFeedIngestion = (
  databaseUrl: string,
  input: SeedSourceInput & {
    readonly results: ReadonlyArray<IngestedFeedItem>;
    readonly aiModelPolicy?: AiModelPolicy;
  },
) =>
  Effect.gen(function* () {
    const seeded = yield* ensureSourceWithFeed(databaseUrl, input);
    const persisted = yield* persistFeedResults(databaseUrl, {
      sourceId: seeded.sourceId,
      feedId: seeded.feedId,
      noSnippet: seeded.noSnippet,
      results: input.results,
    });
    const enqueued = yield* enqueueArticleAndSourceAiJobs(databaseUrl, {
      sourceId: seeded.sourceId,
      articleIds: persisted.persistedArticleIds,
    });
    const clustered = yield* rebuildStoriesAndQueueAiJobs(databaseUrl, {
      aiModelPolicy: input.aiModelPolicy,
    });

    return {
      sourceId: seeded.sourceId,
      feedId: seeded.feedId,
      persistedArticleCount: persisted.persistedCount,
      articleAiJobCount: enqueued.articleJobCount,
      sourceAiJobCount: enqueued.sourceJobCount,
      storyCount: clustered.storyCount,
      aiJobCount:
        clustered.aiJobCount +
        enqueued.articleJobCount +
        enqueued.sourceJobCount,
    };
  });

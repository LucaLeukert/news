import { MetricsService } from "@news/platform";
import type {
  ArticleMetadata,
  CoverageDistribution,
  CrawlValidationState,
  Story,
  TaxonomyBucket,
} from "@news/types";
import { Effect } from "effect";

export type ClusterCandidate = {
  id: string;
  canonicalUrl: string;
  title: string;
  entityKeys: string[];
  publishedAt: string | null;
  semanticFingerprint: string | null;
};

export type ClusterableArticle = ArticleMetadata & {
  publisher: string;
  country: string | null;
  taxonomyBucket?: TaxonomyBucket;
  ownershipCategory?: string | null;
  reliabilityBand?: string | null;
  aiEntityKeys?: string[];
  aiClaimKeys?: string[];
  semanticCuePhrases?: string[];
  semanticFingerprint?: string | null;
  extractionValid?: boolean;
  extractionConfidence?: number;
};

export type StoryCluster = {
  story: Story;
  articles: ClusterableArticle[];
  articleScores: Record<string, number>;
};

export type SemanticPairScoreMap = ReadonlyMap<string, number>;

const DEFAULT_CLUSTER_THRESHOLD = 0.3;
const AI_SOFT_HIDE_CONFIDENCE = 0.6;
const TOKEN_PATTERN = /\p{L}[\p{L}\p{N}]*/gu;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "new",
  "of",
  "on",
  "or",
  "over",
  "the",
  "to",
  "with",
]);

function stableUuidFromText(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-0000-4000-8000-${hex}${hex}`.slice(0, 36);
}

function normalizeClusteringText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/white house|weissen haus|weißen haus/gu, " whitehouse ")
    .replace(/state visit/gu, " statevisit ")
    .replace(/staatsbesuch(?:es|e|en)?/gu, " statevisit ")
    .replace(/u\.s\.a?|\busa\b|united states|vereinigten staaten/gu, " usa ")
    .replace(/britisch(?:e|en|er|es)?/gu, " british ")
    .replace(/koenig|konig|king/gu, " king ")
    .replace(/kongress/gu, " congress ");
}

function tokenizeClusteringText(value: string) {
  return normalizeClusteringText(value).match(TOKEN_PATTERN) ?? [];
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size === 0 && b.size === 0) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(new Set([...a, ...b]).size, 1);
}

function fingerprintTokens(value: string | null) {
  return new Set(
    tokenizeClusteringText(value ?? "").filter((token) => token.length >= 3),
  );
}

export function semanticPairKey(aId: string, bId: string) {
  return aId < bId ? `${aId}::${bId}` : `${bId}::${aId}`;
}

export function extractEntityKeysFromTitle(title: string) {
  return [
    ...new Set(
      tokenizeClusteringText(title)
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
        .slice(0, 12),
    ),
  ];
}

export function toClusterCandidate(
  article: ClusterableArticle,
): ClusterCandidate {
  return {
    id: article.id,
    canonicalUrl: article.canonicalUrl,
    title: article.title,
    entityKeys: [
      ...new Set([
        ...extractEntityKeysFromTitle(article.title),
        ...(article.aiEntityKeys ?? []).flatMap(extractEntityKeysFromTitle),
        ...(article.aiClaimKeys ?? []).flatMap(extractEntityKeysFromTitle),
        ...(article.semanticCuePhrases ?? []).flatMap(extractEntityKeysFromTitle),
      ]),
    ],
    publishedAt: article.publishedAt,
    semanticFingerprint: article.semanticFingerprint ?? null,
  };
}

export function semanticClusteringTextFor(article: ClusterableArticle) {
  return [
    article.title,
    article.snippet ?? "",
    article.semanticFingerprint ?? "",
    ...(article.semanticCuePhrases ?? []),
    ...(article.aiEntityKeys ?? []),
    ...(article.aiClaimKeys ?? []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");
}

export function combineClusterScores(
  lexicalScore: number,
  semanticScore?: number,
) {
  if (semanticScore === undefined) {
    return lexicalScore;
  }

  return Number(
    Math.max(lexicalScore, lexicalScore * 0.4 + semanticScore * 0.6).toFixed(3),
  );
}

export function scoreSameStory(a: ClusterCandidate, b: ClusterCandidate) {
  const titleTokensA = new Set(
    tokenizeClusteringText(a.title).filter(Boolean),
  );
  const titleTokensB = new Set(
    tokenizeClusteringText(b.title).filter(Boolean),
  );
  const titleScore = jaccard(titleTokensA, titleTokensB);
  const sharedEntities = a.entityKeys.filter((entity) =>
    b.entityKeys.includes(entity),
  ).length;
  const entityScore =
    sharedEntities / Math.max(a.entityKeys.length, b.entityKeys.length, 1);
  const fingerprintTokensA = fingerprintTokens(a.semanticFingerprint);
  const fingerprintTokensB = fingerprintTokens(b.semanticFingerprint);
  const fingerprintScore =
    fingerprintTokensA.size > 0 && fingerprintTokensB.size > 0
      ? jaccard(fingerprintTokensA, fingerprintTokensB)
      : 0;
  const timeScore =
    a.publishedAt && b.publishedAt
      ? Math.max(
          0,
          1 -
            Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) /
              86_400_000,
        )
      : 0.5;
  const sharedEntityBoost =
    timeScore >= 0.8 && sharedEntities >= 4
      ? 0.2
      : timeScore >= 0.8 && sharedEntities >= 3
        ? 0.1
        : 0;

  return Number(
    (
      titleScore * 0.2 +
      entityScore * 0.25 +
      fingerprintScore * 0.45 +
      timeScore * 0.1 +
      sharedEntityBoost
    ).toFixed(3),
  );
}

function incrementRecord(
  record: Record<string, number>,
  key: string | null | undefined,
) {
  if (!key) return;
  record[key] = (record[key] ?? 0) + 1;
}

export function buildCoverageDistribution(
  articles: readonly ClusterableArticle[],
): CoverageDistribution {
  const coverage: CoverageDistribution = {
    byCountry: {},
    byLanguage: {},
    byTaxonomy: {
      left: 0,
      center_left: 0,
      center: 0,
      center_right: 0,
      right: 0,
      regionalist: 0,
      state_aligned: 0,
      religious: 0,
      populist: 0,
      mixed_context: 0,
      insufficient_context: 0,
      unrated: 0,
    },
    byOwnership: {},
    byReliability: {},
  };

  for (const article of articles) {
    incrementRecord(coverage.byCountry, article.country);
    incrementRecord(coverage.byLanguage, article.language);
    const taxonomyBucket = article.taxonomyBucket ?? "unrated";
    coverage.byTaxonomy[taxonomyBucket] =
      (coverage.byTaxonomy[taxonomyBucket] ?? 0) + 1;
    incrementRecord(
      coverage.byOwnership,
      article.ownershipCategory ?? "unpublished",
    );
    incrementRecord(
      coverage.byReliability,
      article.reliabilityBand ?? "unrated",
    );
  }

  return coverage;
}

function earliestIso(articles: readonly ClusterableArticle[]) {
  return (
    articles
      .map((article) => article.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ??
    "1970-01-01T00:00:00.000Z"
  );
}

function latestIso(articles: readonly ClusterableArticle[]) {
  return (
    articles
      .map((article) => article.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ??
    "1970-01-01T00:00:00.000Z"
  );
}

function chooseStoryTitle(articles: readonly ClusterableArticle[]) {
  return (
    [...articles].sort((a, b) => {
      const aTime = a.publishedAt
        ? Date.parse(a.publishedAt)
        : Number.MAX_SAFE_INTEGER;
      const bTime = b.publishedAt
        ? Date.parse(b.publishedAt)
        : Number.MAX_SAFE_INTEGER;
      return aTime - bTime || b.title.length - a.title.length;
    })[0]?.title ?? "Untitled story"
  );
}

function canProceedToClustering(state: CrawlValidationState) {
  return state === "rss_verified";
}

function canUseArticleForPublicClustering(article: ClusterableArticle) {
  if (!canProceedToClustering(article.crawlStatus)) return false;
  if (
    article.extractionValid === false &&
    (article.extractionConfidence ?? 1) >= AI_SOFT_HIDE_CONFIDENCE
  ) {
    return false;
  }
  if (["non_article", "duplicate", "sponsored", "satire"].includes(article.articleType)) {
    return false;
  }
  return true;
}

function makeStoryCluster(articles: ClusterableArticle[]): StoryCluster {
  const title = chooseStoryTitle(articles);
  const firstSeenAt = earliestIso(articles);
  const lastSeenAt = latestIso(articles);
  const storyId = stableUuidFromText(
    articles
      .map((article) => article.canonicalUrl)
      .sort()
      .join("|"),
  );

  return {
    story: {
      id: storyId,
      title,
      topicTags: extractEntityKeysFromTitle(title).slice(0, 6),
      firstSeenAt,
      lastSeenAt,
      summary: null,
      coverage: buildCoverageDistribution(articles),
    },
    articles,
    articleScores: Object.fromEntries(
      articles.map((article, index) => [article.id, index === 0 ? 1 : 0]),
    ),
  };
}

export function clusterArticles(
  input: readonly ClusterableArticle[],
  options: {
    threshold?: number;
    semanticPairScores?: SemanticPairScoreMap;
  } = {},
) {
  const threshold = options.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const clusters: Array<{
    anchor: ClusterCandidate;
    articles: ClusterableArticle[];
    scores: Record<string, number>;
  }> = [];

  for (const article of input) {
    if (!canUseArticleForPublicClustering(article)) continue;
    const candidate = toClusterCandidate(article);
    let best:
      | {
          cluster: (typeof clusters)[number];
          score: number;
        }
      | undefined;

    for (const cluster of clusters) {
      const score = combineClusterScores(
        scoreSameStory(cluster.anchor, candidate),
        options.semanticPairScores?.get(
          semanticPairKey(cluster.anchor.id, candidate.id),
        ),
      );
      if (score >= threshold && (!best || score > best.score)) {
        best = { cluster, score };
      }
    }

    if (best) {
      best.cluster.articles.push(article);
      best.cluster.scores[article.id] = best.score;
      continue;
    }

    clusters.push({
      anchor: candidate,
      articles: [article],
      scores: { [article.id]: 1 },
    });
  }

  return clusters.map((cluster) => {
    const storyCluster = makeStoryCluster(cluster.articles);
    return {
      ...storyCluster,
      articleScores: cluster.scores,
    };
  });
}

export const scoreSameStoryEffect = (
  a: ClusterCandidate,
  b: ClusterCandidate,
) =>
  Effect.gen(function* () {
    const score = scoreSameStory(a, b);
    const metrics = yield* MetricsService;
    yield* metrics.gauge("cluster.score", score);
    return score;
  });

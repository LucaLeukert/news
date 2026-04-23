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
};

export type ClusterableArticle = ArticleMetadata & {
  publisher: string;
  country: string | null;
  taxonomyBucket?: TaxonomyBucket;
  ownershipCategory?: string | null;
  reliabilityBand?: string | null;
};

export type StoryCluster = {
  story: Story;
  articles: ClusterableArticle[];
  articleScores: Record<string, number>;
};

const DEFAULT_CLUSTER_THRESHOLD = 0.58;

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

export function extractEntityKeysFromTitle(title: string) {
  return [
    ...new Set(
      title
        .toLowerCase()
        .split(/\W+/)
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
    entityKeys: extractEntityKeysFromTitle(article.title),
    publishedAt: article.publishedAt,
  };
}

export function scoreSameStory(a: ClusterCandidate, b: ClusterCandidate) {
  const titleTokensA = new Set(
    a.title.toLowerCase().split(/\W+/).filter(Boolean),
  );
  const titleTokensB = new Set(
    b.title.toLowerCase().split(/\W+/).filter(Boolean),
  );
  const sharedTitle = [...titleTokensA].filter((token) =>
    titleTokensB.has(token),
  ).length;
  const titleScore =
    sharedTitle / Math.max(titleTokensA.size, titleTokensB.size, 1);
  const sharedEntities = a.entityKeys.filter((entity) =>
    b.entityKeys.includes(entity),
  ).length;
  const entityScore =
    sharedEntities / Math.max(a.entityKeys.length, b.entityKeys.length, 1);
  const timeScore =
    a.publishedAt && b.publishedAt
      ? Math.max(
          0,
          1 -
            Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) /
              86_400_000,
        )
      : 0.5;

  return Number(
    (titleScore * 0.45 + entityScore * 0.35 + timeScore * 0.2).toFixed(3),
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
  options: { threshold?: number } = {},
) {
  const threshold = options.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const clusters: Array<{
    anchor: ClusterCandidate;
    articles: ClusterableArticle[];
    scores: Record<string, number>;
  }> = [];

  for (const article of input) {
    if (!canProceedToClustering(article.crawlStatus)) continue;
    const candidate = toClusterCandidate(article);
    let best:
      | {
          cluster: (typeof clusters)[number];
          score: number;
        }
      | undefined;

    for (const cluster of clusters) {
      const score = scoreSameStory(cluster.anchor, candidate);
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

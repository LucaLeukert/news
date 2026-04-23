import { Data, Schema } from "effect";
import { AI_CONFIDENCE, ARTICLE_TYPES, TAXONOMY_BUCKETS } from "./constants";

const uuidString = Schema.String.check(Schema.isUUID());
const nonEmptyString = Schema.String.check(Schema.isNonEmpty());
const countryCodeString = Schema.String.check(Schema.isLengthBetween(2, 2));
const dateTimeString = Schema.String.check(
  Schema.makeFilter((value: string) => !Number.isNaN(Date.parse(value)), {
    expected: "an ISO date-time string",
  }),
);
const urlString = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { expected: "a URL string" },
  ),
);
const confidenceNumber = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);
const nonNegativeInteger = Schema.Number.check(Schema.isInt()).check(
  Schema.isGreaterThanOrEqualTo(0),
);

export const languageSchema = Schema.String.check(
  Schema.isLengthBetween(2, 12),
);
export type LanguageCode = typeof languageSchema.Type;

export const articleTypeSchema = Schema.Literals(ARTICLE_TYPES);
export type ArticleType = typeof articleTypeSchema.Type;

export const crawlValidationStateSchema = Schema.Literals([
  "rss_verified",
  "rss_mismatch_title",
  "rss_mismatch_date",
  "canonical_failed",
  "blocked_by_policy",
  "extraction_failed",
]);
export type CrawlValidationState = typeof crawlValidationStateSchema.Type;

export const taxonomyBucketSchema = Schema.Literals(TAXONOMY_BUCKETS);
export type TaxonomyBucket = typeof taxonomyBucketSchema.Type;

export const sourceSchema = Schema.Struct({
  id: uuidString,
  name: nonEmptyString,
  domain: nonEmptyString,
  countryCode: Schema.NullOr(countryCodeString),
  primaryLanguage: Schema.NullOr(languageSchema),
  rssOnly: Schema.Boolean,
  noSnippet: Schema.Boolean,
  doNotCrawl: Schema.Boolean,
});
export type Source = typeof sourceSchema.Type;

export const articleMetadataSchema = Schema.Struct({
  id: uuidString,
  sourceId: uuidString,
  canonicalUrl: urlString,
  title: Schema.String.check(Schema.isMinLength(1)).check(
    Schema.isMaxLength(500),
  ),
  snippet: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  author: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
  publishedAt: Schema.NullOr(dateTimeString),
  language: Schema.NullOr(languageSchema),
  articleType: articleTypeSchema,
  paywalled: Schema.Boolean,
  crawlStatus: crawlValidationStateSchema,
});
export type ArticleMetadata = typeof articleMetadataSchema.Type;

export const articleWithPublisherSchema = Schema.Struct({
  ...articleMetadataSchema.fields,
  publisher: nonEmptyString,
  country: Schema.NullOr(countryCodeString),
});
export type ArticleWithPublisher = typeof articleWithPublisherSchema.Type;

export const storySummarySchema = Schema.Struct({
  neutralSummary: Schema.String.check(Schema.isMaxLength(1600)),
  agreed: Schema.Array(Schema.String.check(Schema.isMaxLength(500))),
  differs: Schema.Array(Schema.String.check(Schema.isMaxLength(500))),
  contestedOrUnverified: Schema.Array(
    Schema.String.check(Schema.isMaxLength(500)),
  ),
  confidence: confidenceNumber,
  lastUpdatedAt: dateTimeString,
});
export type StorySummary = typeof storySummarySchema.Type;

export const coverageDistributionSchema = Schema.Struct({
  byCountry: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonNegativeInteger),
  ),
  byLanguage: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonNegativeInteger),
  ),
  byTaxonomy: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonNegativeInteger),
  ),
  byOwnership: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonNegativeInteger),
  ),
  byReliability: Schema.Record(
    Schema.String,
    Schema.mutableKey(nonNegativeInteger),
  ),
});
export type CoverageDistribution = typeof coverageDistributionSchema.Type;

export const storySchema = Schema.Struct({
  id: uuidString,
  title: Schema.String.check(Schema.isMinLength(1)).check(
    Schema.isMaxLength(500),
  ),
  topicTags: Schema.Array(Schema.String),
  firstSeenAt: dateTimeString,
  lastSeenAt: dateTimeString,
  summary: Schema.NullOr(storySummarySchema),
  coverage: coverageDistributionSchema,
});
export type Story = typeof storySchema.Type;

export const storyDetailSchema = Schema.Struct({
  story: storySchema,
  articles: Schema.Array(articleMetadataSchema),
});
export type StoryDetail = typeof storyDetailSchema.Type;

export const resolveUrlResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("matched"),
    url: urlString,
    storyId: uuidString,
    articleId: Schema.NullOr(uuidString),
    queued: Schema.Literal(false),
  }),
  Schema.Struct({
    status: Schema.Literal("queued_or_matched"),
    url: urlString,
    storyId: Schema.Null,
    queued: Schema.Literal(true),
  }),
]);
export type ResolveUrlResult = typeof resolveUrlResultSchema.Type;

export const crawlEnqueueRequestSchema = Schema.Struct({
  kind: Schema.Literals(["rss_checks", "stale_story_refresh"]),
  scheduledAt: dateTimeString,
});
export type CrawlEnqueueRequest = typeof crawlEnqueueRequestSchema.Type;

export const aiJobTypeSchema = Schema.Literals([
  "article_extraction_qa",
  "claim_extraction",
  "story_clustering_support",
  "neutral_story_summary",
  "bias_context_classification",
  "factuality_reliability_support",
  "ownership_extraction_support",
  "safety_compliance_check",
]);
export type AiJobType = typeof aiJobTypeSchema.Type;

export const aiValidationStatusSchema = Schema.Literals([
  "valid",
  "failed_schema_validation",
  "failed_safety_validation",
  "retry_pending",
]);
export type AiValidationStatus = typeof aiValidationStatusSchema.Type;

export const articleExtractionQaOutputSchema = Schema.Struct({
  extraction_valid: Schema.Boolean,
  article_type: articleTypeSchema,
  title_quality: Schema.Literals(["valid", "missing", "clickbait", "mismatch"]),
  date_quality: Schema.Literals(["valid", "missing", "mismatch", "ambiguous"]),
  language_quality: Schema.Literals(["valid", "missing", "mismatch"]),
  reasons: Schema.Array(Schema.String),
  confidence: confidenceNumber,
});
export type ArticleExtractionQaOutput =
  typeof articleExtractionQaOutputSchema.Type;

export const claimExtractionOutputSchema = Schema.Struct({
  claims: Schema.Array(
    Schema.Struct({
      text: Schema.String.check(Schema.isMaxLength(500)),
      speaker: Schema.NullOr(Schema.String),
      entities: Schema.Array(Schema.String),
      confidence: confidenceNumber,
    }),
  ),
  confidence: confidenceNumber,
});
export type ClaimExtractionOutput = typeof claimExtractionOutputSchema.Type;

export const storyClusteringSupportOutputSchema = Schema.Struct({
  fingerprint: Schema.String,
  same_event_candidates: Schema.Array(Schema.String),
  confidence: confidenceNumber,
});
export type StoryClusteringSupportOutput =
  typeof storyClusteringSupportOutputSchema.Type;

export const storySummaryOutputSchema = Schema.Struct({
  neutralSummary: Schema.String.check(Schema.isMaxLength(1600)),
  agreed: Schema.Array(Schema.String.check(Schema.isMaxLength(500))),
  differs: Schema.Array(Schema.String.check(Schema.isMaxLength(500))),
  contestedOrUnverified: Schema.Array(
    Schema.String.check(Schema.isMaxLength(500)),
  ),
  confidence: confidenceNumber,
  reasons: Schema.Array(Schema.String),
});
export type StorySummaryOutput = typeof storySummaryOutputSchema.Type;

export const biasContextOutputSchema = Schema.Struct({
  taxonomy_bucket: taxonomyBucketSchema,
  country_context: Schema.NullOr(countryCodeString),
  publishable: Schema.Boolean,
  evidence_strength: Schema.Literals(["strong", "moderate", "weak", "none"]),
  confidence: confidenceNumber,
  reasons: Schema.Array(Schema.String),
});
export type BiasContextOutput = typeof biasContextOutputSchema.Type;

export const factualityReliabilitySupportOutputSchema = Schema.Struct({
  quality_signals: Schema.Array(Schema.String),
  reliability_band: Schema.Literals([
    "high",
    "medium",
    "low",
    "insufficient_context",
  ]),
  confidence: confidenceNumber,
});
export type FactualityReliabilitySupportOutput =
  typeof factualityReliabilitySupportOutputSchema.Type;

export const ownershipExtractionSupportOutputSchema = Schema.Struct({
  ownership_category: Schema.NullOr(Schema.String),
  citations: Schema.Array(urlString),
  publishable: Schema.Boolean,
  confidence: confidenceNumber,
});
export type OwnershipExtractionSupportOutput =
  typeof ownershipExtractionSupportOutputSchema.Type;

export const safetyComplianceOutputSchema = Schema.Struct({
  safe_to_publish: Schema.Boolean,
  risks: Schema.Array(
    Schema.Literals([
      "defamatory_certainty",
      "unsupported_truth_claim",
      "overlong_snippet",
      "copyright_leakage",
      "sensitive_policy_output",
    ]),
  ),
  confidence: confidenceNumber,
  reasons: Schema.Array(Schema.String),
});
export type SafetyComplianceOutput = typeof safetyComplianceOutputSchema.Type;

export const aiStructuredOutputSchema = Schema.Union([
  articleExtractionQaOutputSchema,
  claimExtractionOutputSchema,
  storyClusteringSupportOutputSchema,
  storySummaryOutputSchema,
  biasContextOutputSchema,
  factualityReliabilitySupportOutputSchema,
  ownershipExtractionSupportOutputSchema,
  safetyComplianceOutputSchema,
]);
export type AiStructuredOutput = typeof aiStructuredOutputSchema.Type;

export const aiResultEnvelopeSchema = Schema.Struct({
  job_id: uuidString,
  model_name: nonEmptyString,
  model_version: nonEmptyString,
  prompt_version: nonEmptyString,
  input_artifact_ids: Schema.Array(uuidString),
  output_schema_version: nonEmptyString,
  structured_output: aiStructuredOutputSchema,
  confidence: confidenceNumber,
  reasons: Schema.Array(Schema.String),
  citations_to_input_ids: Schema.Array(uuidString),
  validation_status: aiValidationStatusSchema,
  created_at: dateTimeString,
  latency_ms: nonNegativeInteger,
});
export type AiResultEnvelope = typeof aiResultEnvelopeSchema.Type;

export const aiStorySummaryJobArticleSchema = Schema.Struct({
  id: uuidString,
  title: Schema.String.check(Schema.isMinLength(1)),
  snippet: Schema.NullOr(Schema.String),
  source: Schema.String,
});
export type AiStorySummaryJobArticle =
  typeof aiStorySummaryJobArticleSchema.Type;

export const neutralStorySummaryJobPayloadSchema = Schema.Struct({
  storyTitle: Schema.String.check(Schema.isMinLength(1)),
  articles: Schema.Array(aiStorySummaryJobArticleSchema),
});
export type NeutralStorySummaryJobPayload =
  typeof neutralStorySummaryJobPayloadSchema.Type;

export const leasedAiJobSchema = Schema.Struct({
  id: uuidString,
  type: Schema.Literal("neutral_story_summary"),
  payload: neutralStorySummaryJobPayloadSchema,
  inputArtifactIds: Schema.Array(uuidString),
  leaseExpiresAt: dateTimeString,
});
export type LeasedAiJob = typeof leasedAiJobSchema.Type;

export const resolveUrlRequestSchema = Schema.Struct({
  url: urlString,
});
export type ResolveUrlRequest = typeof resolveUrlRequestSchema.Type;

export const storyListQuerySchema = Schema.Struct({
  topic: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(countryCodeString),
  language: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  entity: Schema.optionalKey(Schema.String),
  imbalance: Schema.optionalKey(Schema.Boolean),
});
export type StoryListQuery = typeof storyListQuerySchema.Type;

export const userFollowTargetTypeSchema = Schema.Literals([
  "topic",
  "source",
  "entity",
  "country",
  "language",
]);
export type UserFollowTargetType = typeof userFollowTargetTypeSchema.Type;

export const userFollowRequestSchema = Schema.Struct({
  targetType: userFollowTargetTypeSchema,
  targetId: nonEmptyString,
});
export type UserFollowRequest = typeof userFollowRequestSchema.Type;

export const userHideRequestSchema = Schema.Union([
  Schema.Struct({
    targetType: Schema.Literal("source"),
    targetId: uuidString,
  }),
  Schema.Struct({
    targetType: Schema.Literal("topic"),
    targetId: nonEmptyString,
  }),
]);
export type UserHideRequest = typeof userHideRequestSchema.Type;

export const saveStoryRequestSchema = Schema.Struct({
  storyId: uuidString,
});
export type SaveStoryRequest = typeof saveStoryRequestSchema.Type;

export const userActionResultSchema = Schema.Struct({
  status: Schema.Literals(["created", "exists", "deleted", "missing"]),
  userId: nonEmptyString,
  projection: Schema.Literal("convex"),
});
export type UserActionResult = typeof userActionResultSchema.Type;

export function decodeUnknownSync<S extends Schema.Decoder<unknown>>(
  schema: S,
) {
  return Schema.decodeUnknownSync(schema);
}

export function publicConfidenceState(confidence: number) {
  if (confidence >= AI_CONFIDENCE.publish) return "publish";
  if (confidence >= AI_CONFIDENCE.limited) return "limited";
  return "hold";
}

export class DomainValidationError extends Data.TaggedError(
  "DomainValidationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

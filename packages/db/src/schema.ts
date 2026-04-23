import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const crawlValidationState = pgEnum("crawl_validation_state", [
  "rss_verified",
  "rss_mismatch_title",
  "rss_mismatch_date",
  "canonical_failed",
  "blocked_by_policy",
  "extraction_failed",
]);

export const articleType = pgEnum("article_type", [
  "news",
  "opinion",
  "liveblog",
  "press_release",
  "satire",
  "sponsored",
  "duplicate",
  "non_article",
  "unknown",
]);

export const aiJobType = pgEnum("ai_job_type", [
  "article_extraction_qa",
  "claim_extraction",
  "story_clustering_support",
  "neutral_story_summary",
  "bias_context_classification",
  "factuality_reliability_support",
  "ownership_extraction_support",
  "safety_compliance_check",
]);

export const aiJobStatus = pgEnum("ai_job_status", [
  "pending",
  "leased",
  "completed",
  "failed",
  "failed_schema_validation",
]);

export const taxonomyBucket = pgEnum("taxonomy_bucket", [
  "left",
  "center_left",
  "center",
  "center_right",
  "right",
  "regionalist",
  "state_aligned",
  "religious",
  "populist",
  "mixed_context",
  "insufficient_context",
  "unrated",
]);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    countryCode: text("country_code"),
    primaryLanguage: text("primary_language"),
    ownershipStatus: text("ownership_status").default("unpublished").notNull(),
    robotsAllowed: boolean("robots_allowed").default(true).notNull(),
    crawlDelayMs: integer("crawl_delay_ms").default(1000).notNull(),
    allowedPaths: jsonb("allowed_paths")
      .$type<string[]>()
      .default([])
      .notNull(),
    disallowedPaths: jsonb("disallowed_paths")
      .$type<string[]>()
      .default([])
      .notNull(),
    termsNotes: text("terms_notes"),
    maxRequestsPerHour: integer("max_requests_per_hour").default(60).notNull(),
    requiresJs: boolean("requires_js").default(false).notNull(),
    rssOnly: boolean("rss_only").default(false).notNull(),
    noSnippet: boolean("no_snippet").default(false).notNull(),
    doNotCrawl: boolean("do_not_crawl").default(false).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    domainIdx: uniqueIndex("sources_domain_idx").on(table.domain),
    countryIdx: index("sources_country_idx").on(table.countryCode),
  }),
);

export const sourceFeeds = pgTable(
  "source_feeds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .references(() => sources.id)
      .notNull(),
    feedUrl: text("feed_url").notNull(),
    feedType: text("feed_type").default("rss").notNull(),
    validationState: crawlValidationState("validation_state"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    feedUrlIdx: uniqueIndex("source_feeds_url_idx").on(table.feedUrl),
  }),
);

export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").references(() => sources.id),
    feedId: uuid("feed_id").references(() => sourceFeeds.id),
    targetUrl: text("target_url").notNull(),
    status: text("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    domainLease: text("domain_lease"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    runAfter: timestamp("run_after", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    runnableIdx: index("crawl_jobs_runnable_idx").on(
      table.status,
      table.runAfter,
    ),
    domainIdx: index("crawl_jobs_domain_idx").on(table.domainLease),
  }),
);

export const crawlArtifacts = pgTable(
  "crawl_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlJobId: uuid("crawl_job_id").references(() => crawlJobs.id),
    fetchedUrl: text("fetched_url").notNull(),
    statusCode: integer("status_code").notNull(),
    contentHash: text("content_hash").notNull(),
    r2Key: text("r2_key").notNull(),
    metadataHash: text("metadata_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    contentHashIdx: index("crawl_artifacts_content_hash_idx").on(
      table.contentHash,
    ),
  }),
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .references(() => sources.id)
      .notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    language: text("language"),
    type: articleType("type").default("unknown").notNull(),
    paywalled: boolean("paywalled").default(false).notNull(),
    crawlStatus: crawlValidationState("crawl_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    canonicalUrlIdx: uniqueIndex("articles_canonical_url_idx").on(
      table.canonicalUrl,
    ),
    sourcePublishedIdx: index("articles_source_published_idx").on(
      table.sourceId,
      table.publishedAt,
    ),
  }),
);

export const articleVersions = pgTable("article_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  articleId: uuid("article_id")
    .references(() => articles.id)
    .notNull(),
  title: text("title").notNull(),
  snippet: text("snippet"),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const stories = pgTable("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  topicTags: jsonb("topic_tags").$type<string[]>().default([]).notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export const storyArticles = pgTable(
  "story_articles",
  {
    storyId: uuid("story_id")
      .references(() => stories.id)
      .notNull(),
    articleId: uuid("article_id")
      .references(() => articles.id)
      .notNull(),
    clusterConfidence: real("cluster_confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.storyId, table.articleId] }),
  }),
);

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  canonicalKey: text("canonical_key").notNull(),
});

export const storyEntities = pgTable(
  "story_entities",
  {
    storyId: uuid("story_id")
      .references(() => stories.id)
      .notNull(),
    entityId: uuid("entity_id")
      .references(() => entities.id)
      .notNull(),
    confidence: real("confidence").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.storyId, table.entityId] }),
  }),
);

export const claims = pgTable("claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  articleId: uuid("article_id")
    .references(() => articles.id)
    .notNull(),
  claimText: text("claim_text").notNull(),
  speaker: text("speaker"),
  confidence: real("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: aiJobType("type").notNull(),
    status: aiJobStatus("status").default("pending").notNull(),
    priority: integer("priority").default(100).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    inputArtifactIds: jsonb("input_artifact_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    leasedBy: text("leased_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    leaseIdx: index("ai_jobs_lease_idx").on(
      table.status,
      table.priority,
      table.createdAt,
    ),
  }),
);

export const aiResults = pgTable("ai_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .references(() => aiJobs.id)
    .notNull(),
  modelName: text("model_name").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputArtifactIds: jsonb("input_artifact_ids").$type<string[]>().notNull(),
  outputSchemaVersion: text("output_schema_version").notNull(),
  structuredOutput: jsonb("structured_output")
    .$type<Record<string, unknown>>()
    .notNull(),
  confidence: real("confidence").notNull(),
  reasons: jsonb("reasons").$type<string[]>().default([]).notNull(),
  citationsToInputIds: jsonb("citations_to_input_ids")
    .$type<string[]>()
    .default([])
    .notNull(),
  validationStatus: text("validation_status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const taxonomies = pgTable(
  "taxonomies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    countryCode: text("country_code").notNull(),
    version: text("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    countryVersionIdx: uniqueIndex("taxonomies_country_version_idx").on(
      table.countryCode,
      table.version,
    ),
  }),
);

export const sourceRatings = pgTable("source_ratings", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id")
    .references(() => sources.id)
    .notNull(),
  taxonomyBucket: taxonomyBucket("taxonomy_bucket")
    .default("unrated")
    .notNull(),
  ownershipCategory: text("ownership_category"),
  reliabilityBand: text("reliability_band"),
  confidence: real("confidence").notNull(),
  evidence: jsonb("evidence")
    .$type<Array<{ url: string; note: string }>>()
    .default([])
    .notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const storyMetrics = pgTable("story_metrics", {
  storyId: uuid("story_id")
    .references(() => stories.id)
    .primaryKey(),
  byCountry: jsonb("by_country")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  byLanguage: jsonb("by_language")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  byTaxonomy: jsonb("by_taxonomy")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  byOwnership: jsonb("by_ownership")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  byReliability: jsonb("by_reliability")
    .$type<Record<string, number>>()
    .default({})
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const takedownRequests = pgTable("takedown_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterEmail: text("requester_email").notNull(),
  targetUrl: text("target_url").notNull(),
  reason: text("reason").notNull(),
  status: text("status").default("open").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

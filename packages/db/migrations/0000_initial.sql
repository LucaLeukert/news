CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE crawl_validation_state AS ENUM (
  'rss_verified',
  'rss_mismatch_title',
  'rss_mismatch_date',
  'canonical_failed',
  'blocked_by_policy',
  'extraction_failed'
);

CREATE TYPE article_type AS ENUM (
  'news',
  'opinion',
  'liveblog',
  'press_release',
  'satire',
  'sponsored',
  'duplicate',
  'non_article',
  'unknown'
);

CREATE TYPE ai_job_type AS ENUM (
  'article_extraction_qa',
  'claim_extraction',
  'story_clustering_support',
  'neutral_story_summary',
  'bias_context_classification',
  'factuality_reliability_support',
  'ownership_extraction_support',
  'safety_compliance_check'
);

CREATE TYPE ai_job_status AS ENUM (
  'pending',
  'leased',
  'completed',
  'failed',
  'failed_schema_validation'
);

CREATE TYPE taxonomy_bucket AS ENUM (
  'left',
  'center_left',
  'center',
  'center_right',
  'right',
  'regionalist',
  'state_aligned',
  'religious',
  'populist',
  'mixed_context',
  'insufficient_context',
  'unrated'
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL UNIQUE,
  country_code text,
  primary_language text,
  ownership_status text NOT NULL DEFAULT 'unpublished',
  robots_allowed boolean NOT NULL DEFAULT true,
  crawl_delay_ms integer NOT NULL DEFAULT 1000,
  allowed_paths jsonb NOT NULL DEFAULT '[]',
  disallowed_paths jsonb NOT NULL DEFAULT '[]',
  terms_notes text,
  max_requests_per_hour integer NOT NULL DEFAULT 60,
  requires_js boolean NOT NULL DEFAULT false,
  rss_only boolean NOT NULL DEFAULT false,
  no_snippet boolean NOT NULL DEFAULT false,
  do_not_crawl boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sources_country_idx ON sources(country_code);

CREATE TABLE source_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  feed_url text NOT NULL UNIQUE,
  feed_type text NOT NULL DEFAULT 'rss',
  validation_state crawl_validation_state,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crawl_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES sources(id),
  feed_id uuid REFERENCES source_feeds(id),
  target_url text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  domain_lease text,
  error_details jsonb,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crawl_jobs_runnable_idx ON crawl_jobs(status, run_after);
CREATE INDEX crawl_jobs_domain_idx ON crawl_jobs(domain_lease);

CREATE TABLE crawl_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_job_id uuid REFERENCES crawl_jobs(id),
  fetched_url text NOT NULL,
  status_code integer NOT NULL,
  content_hash text NOT NULL,
  r2_key text NOT NULL,
  metadata_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crawl_artifacts_content_hash_idx ON crawl_artifacts(content_hash);

CREATE TABLE articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  canonical_url text NOT NULL UNIQUE,
  title text NOT NULL,
  snippet text,
  author text,
  published_at timestamptz,
  updated_at timestamptz,
  language text,
  type article_type NOT NULL DEFAULT 'unknown',
  paywalled boolean NOT NULL DEFAULT false,
  crawl_status crawl_validation_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX articles_source_published_idx ON articles(source_id, published_at);

CREATE TABLE article_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id),
  title text NOT NULL,
  snippet text,
  metadata jsonb NOT NULL DEFAULT '{}',
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary jsonb,
  topic_tags jsonb NOT NULL DEFAULT '[]',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE story_articles (
  story_id uuid NOT NULL REFERENCES stories(id),
  article_id uuid NOT NULL REFERENCES articles(id),
  cluster_confidence real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, article_id)
);

CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  canonical_key text NOT NULL
);

CREATE TABLE story_entities (
  story_id uuid NOT NULL REFERENCES stories(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  confidence real NOT NULL,
  PRIMARY KEY (story_id, entity_id)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES articles(id),
  claim_text text NOT NULL,
  speaker text,
  confidence real NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type ai_job_type NOT NULL,
  status ai_job_status NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  payload jsonb NOT NULL,
  input_artifact_ids jsonb NOT NULL DEFAULT '[]',
  leased_by text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_jobs_lease_idx ON ai_jobs(status, priority, created_at);

CREATE TABLE ai_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES ai_jobs(id),
  model_name text NOT NULL,
  model_version text NOT NULL,
  prompt_version text NOT NULL,
  input_artifact_ids jsonb NOT NULL,
  output_schema_version text NOT NULL,
  structured_output jsonb NOT NULL,
  confidence real NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  citations_to_input_ids jsonb NOT NULL DEFAULT '[]',
  validation_status text NOT NULL,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE taxonomies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  version text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, version)
);

CREATE TABLE source_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  taxonomy_bucket taxonomy_bucket NOT NULL DEFAULT 'unrated',
  ownership_category text,
  reliability_band text,
  confidence real NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE story_metrics (
  story_id uuid PRIMARY KEY REFERENCES stories(id),
  by_country jsonb NOT NULL DEFAULT '{}',
  by_language jsonb NOT NULL DEFAULT '{}',
  by_taxonomy jsonb NOT NULL DEFAULT '{}',
  by_ownership jsonb NOT NULL DEFAULT '{}',
  by_reliability jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE takedown_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email text NOT NULL,
  target_url text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

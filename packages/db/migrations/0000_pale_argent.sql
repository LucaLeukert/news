CREATE TYPE "public"."ai_job_status" AS ENUM('pending', 'leased', 'completed', 'failed', 'failed_schema_validation');--> statement-breakpoint
CREATE TYPE "public"."ai_job_type" AS ENUM('article_extraction_qa', 'claim_extraction', 'story_clustering_support', 'neutral_story_summary', 'bias_context_classification', 'factuality_reliability_support', 'ownership_extraction_support', 'safety_compliance_check');--> statement-breakpoint
CREATE TYPE "public"."article_type" AS ENUM('news', 'opinion', 'liveblog', 'press_release', 'satire', 'sponsored', 'duplicate', 'non_article', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."crawl_validation_state" AS ENUM('rss_verified', 'rss_mismatch_title', 'rss_mismatch_date', 'canonical_failed', 'blocked_by_policy', 'extraction_failed');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_bucket" AS ENUM('left', 'center_left', 'center', 'center_right', 'right', 'regionalist', 'state_aligned', 'religious', 'populist', 'mixed_context', 'insufficient_context', 'unrated');--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "ai_job_type" NOT NULL,
	"status" "ai_job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"payload" jsonb NOT NULL,
	"input_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"leased_by" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_artifact_ids" jsonb NOT NULL,
	"output_schema_version" text NOT NULL,
	"structured_output" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations_to_input_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"author" text,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"language" text,
	"type" "article_type" DEFAULT 'unknown' NOT NULL,
	"paywalled" boolean DEFAULT false NOT NULL,
	"crawl_status" "crawl_validation_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"speaker" text,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_job_id" uuid,
	"fetched_url" text NOT NULL,
	"status_code" integer NOT NULL,
	"content_hash" text NOT NULL,
	"r2_key" text NOT NULL,
	"metadata_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"feed_id" uuid,
	"target_url" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"domain_lease" text,
	"error_details" jsonb,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"canonical_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"feed_url" text NOT NULL,
	"feed_type" text DEFAULT 'rss' NOT NULL,
	"validation_state" "crawl_validation_state",
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"taxonomy_bucket" "taxonomy_bucket" DEFAULT 'unrated' NOT NULL,
	"ownership_category" text,
	"reliability_band" text,
	"confidence" real NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"country_code" text,
	"primary_language" text,
	"ownership_status" text DEFAULT 'unpublished' NOT NULL,
	"robots_allowed" boolean DEFAULT true NOT NULL,
	"crawl_delay_ms" integer DEFAULT 1000 NOT NULL,
	"allowed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disallowed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"terms_notes" text,
	"max_requests_per_hour" integer DEFAULT 60 NOT NULL,
	"requires_js" boolean DEFAULT false NOT NULL,
	"rss_only" boolean DEFAULT false NOT NULL,
	"no_snippet" boolean DEFAULT false NOT NULL,
	"do_not_crawl" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" jsonb,
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_articles" (
	"story_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"cluster_confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_articles_story_id_article_id_pk" PRIMARY KEY("story_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "story_entities" (
	"story_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	CONSTRAINT "story_entities_story_id_entity_id_pk" PRIMARY KEY("story_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "story_metrics" (
	"story_id" uuid PRIMARY KEY NOT NULL,
	"by_country" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_language" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_taxonomy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_ownership" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_reliability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takedown_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_email" text NOT NULL,
	"target_url" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "taxonomies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_artifacts" ADD CONSTRAINT "crawl_artifacts_crawl_job_id_crawl_jobs_id_fk" FOREIGN KEY ("crawl_job_id") REFERENCES "public"."crawl_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_feed_id_source_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."source_feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_feeds" ADD CONSTRAINT "source_feeds_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_ratings" ADD CONSTRAINT "source_ratings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_articles" ADD CONSTRAINT "story_articles_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_articles" ADD CONSTRAINT "story_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_entities" ADD CONSTRAINT "story_entities_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_entities" ADD CONSTRAINT "story_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_metrics" ADD CONSTRAINT "story_metrics_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_lease_idx" ON "ai_jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_canonical_url_idx" ON "articles" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "articles_source_published_idx" ON "articles" USING btree ("source_id","published_at");--> statement-breakpoint
CREATE INDEX "crawl_artifacts_content_hash_idx" ON "crawl_artifacts" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "crawl_jobs_runnable_idx" ON "crawl_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "crawl_jobs_domain_idx" ON "crawl_jobs" USING btree ("domain_lease");--> statement-breakpoint
CREATE UNIQUE INDEX "source_feeds_url_idx" ON "source_feeds" USING btree ("feed_url");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_domain_idx" ON "sources" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "sources_country_idx" ON "sources" USING btree ("country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomies_country_version_idx" ON "taxonomies" USING btree ("country_code","version");
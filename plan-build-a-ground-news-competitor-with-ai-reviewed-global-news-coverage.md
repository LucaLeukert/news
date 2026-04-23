# Plan: Build a Ground News Competitor With AI-Reviewed Global News Coverage

## Summary

Build a production-oriented multilingual news comparison platform that ingests from thousands of sources, verifies RSS/Google News RSS entries against canonical article pages, clusters coverage into stories, and uses a local `gpt-oss-20b` inference node to replace human article review for classification, summarization, bias/context labeling, and quality checks.

Chosen defaults:

- Frontend: `Next.js` on Vercel.
- Monorepo: Turborepo + Bun.
- Frontend reactive layer: Convex only for frontend-facing user state/projections.
- Primary database: Neon Postgres free tier for bootstrap, schema designed to migrate to paid Neon/managed Postgres without rework.
- Cloud edge/runtime: Cloudflare Workers, Queues/Durable Objects where suitable, R2 for object storage.
- Local AI: home/office `gpt-oss-20b` machine connected securely to cloud.
- Initial market: global, multilingual.
- Initial source target: 5,000 compliant sources.
- Crawling posture: compliant crawl, respect robots.txt/terms/rate limits, display metadata/snippets only.
- Bias taxonomy: country-specific political spectrum where possible; otherwise label as `insufficient_context`.
- Low-confidence AI output: hold/soft-hide from user-facing summaries.

## Product Requirements

### Core User-Facing Features

1. Story comparison pages
   - Show clustered coverage for the same event.
   - Display publisher, country, language, timestamp, title, short snippet, canonical URL, paywall indicator, and crawl status.
   - Compare headlines across outlets.
   - Link out to original publisher pages.

2. Coverage distribution
   - Show source counts by:
     - Country or region.
     - Language.
     - Political taxonomy bucket where available.
     - Ownership category where available.
     - Factuality/reliability band where available.
   - Avoid universal left/center/right where it is not meaningful.

3. AI-generated story summary
   - Generate neutral cross-source summary.
   - Include “what is agreed,” “what differs,” and “unverified/contested claims.”
   - Show confidence and last-updated timestamp.

4. Blindspot-like feed
   - Surface stories disproportionately covered by specific country/region/political clusters.
   - For v1, define blindspots as coverage imbalance, not ideological truth.
   - Soft-hide low-confidence cluster labels.

5. Search and discovery
   - Search by keyword, publisher, URL, topic, entity, country, and language.
   - Paste an article URL to find or create its coverage cluster.
   - “For You” feed based on followed topics/sources/regions.

6. User features
   - Follow topics, sources, entities, countries, and languages.
   - Save articles/stories.
   - Hide topics/sources.
   - Basic account system.
   - No payment/subscription work for now.

## Key Limitations and Risk Boundaries

1. The system is not a real-time fact checker.
   - It compares claims and source patterns.
   - It should not claim that the AI determines objective truth.

2. AI labels are probabilistic.
   - Every model output must store confidence, prompt version, model version, input IDs, and validation result.
   - Low-confidence outputs are excluded from public aggregate labels.

3. Publisher content storage is limited.
   - Store URL, canonical URL, title, author, publish/update times, metadata, short snippet, extracted entities/claims, embeddings, and internal processing artifacts.
   - Do not display full article text.
   - Prefer short snippets and links to original publishers.

4. Free-tier database is only a bootstrap constraint.
   - Neon free tier will not support production-scale article ingestion.
   - The architecture must support easy upgrade to paid Neon, Crunchy Bridge, RDS, or self-hosted Postgres.

5. Global political bias is hard.
   - Use country-specific taxonomies.
   - Use `unrated`, `mixed_context`, or `insufficient_context` aggressively where mappings are not reliable.

## System Architecture

### High-Level Components

1. `apps/web`
   - Next.js app deployed on Vercel.
   - Reads public APIs from Cloudflare Workers.
   - Uses Convex for frontend-facing realtime user state and feed projections.

2. `apps/api`
   - Cloudflare Worker API gateway.
   - Handles public read APIs, authenticated user actions, source search, story search, and article URL lookup.
   - Talks to Neon Postgres for canonical data.
   - Writes frontend projections to Convex when needed.

3. `apps/admin`
   - Internal Next.js admin console, protected by Cloudflare Access.
   - Source onboarding, crawl health, AI job review, model confidence dashboards, takedown workflow, and taxonomy management.

4. `services/crawler`
   - Bun service deployable as Cloudflare Workers for lightweight fetches and Fly/VPS later for heavier crawling.
   - Responsible for RSS discovery, Google News RSS discovery, canonical page validation, robots.txt policy, extraction, and recrawl scheduling.

5. `services/parser`
   - Article extraction pipeline.
   - Uses HTML metadata, schema.org `NewsArticle`, OpenGraph, canonical links, language detection, date extraction, and paywall detection.
   - Playwright fallback only for sources that require JS and allow crawling.

6. `services/clusterer`
   - Groups articles into stories.
   - Uses URL canonicalization, title similarity, entity overlap, timestamp windows, embeddings, and claim similarity.
   - Re-clusters when better articles arrive.

7. `services/ai-runner`
   - Local home/office machine service.
   - Long-polls cloud job API, runs `gpt-oss-20b`, validates structured outputs, and posts results back.
   - No inbound public port required.

8. `services/scheduler`
   - Schedules source recrawls, RSS checks, Google News RSS checks, stale-story refreshes, AI jobs, and data cleanup.
   - Implement with Cloudflare Cron Triggers initially.

9. `packages/shared`
   - Shared TypeScript types, Zod schemas, constants, taxonomy definitions, URL normalization, language helpers.

10. `packages/db`
   - Drizzle ORM schema and migrations for Neon Postgres.
   - Strict SQL migrations committed in repo.

11. `packages/ai`
   - Prompt templates, model adapters, JSON schemas, confidence scoring, retry policies, eval fixtures.

12. `packages/crawler-core`
   - Robots parser, fetch policy, source adapters, RSS parser, canonical validator, extraction utilities.

## Cloud and Local Infrastructure

### Vercel

Use only for:

- Next.js frontend hosting.
- Server components that call Cloudflare/Convex APIs.
- Preview deployments.

Do not use Vercel for crawler or AI workloads.

### Cloudflare

Use for:

- Public API gateway via Workers.
- CDN/cache for public story pages.
- Cron scheduling.
- R2 object storage for raw crawl artifacts and screenshots where legally allowed.
- Durable Objects for per-domain crawl leases/rate-limit coordination.
- Cloudflare Access for admin and internal endpoints.
- Optional Queues for cloud-native pipeline steps.

### Neon Postgres

Use as canonical relational store.

Bootstrap with Neon free tier, but enforce:

- Partition large tables by time.
- Aggressive retention for raw crawl artifacts in Postgres.
- Store large raw HTML only in R2, not Postgres.
- Add migration path to paid Postgres by month one.

### Convex

Use Convex only for frontend-facing state/projections:

- User follows.
- Saved stories.
- Hide preferences.
- Realtime feed projection documents.
- Lightweight notification state.

Postgres remains the source of truth for articles, stories, sources, classifications, crawler state, and AI results.

### Local AI Inference Node

Run on home/office hardware:

- Recommended minimum: NVIDIA GPU with at least 16 GB VRAM or equivalent supported runtime.
- Model server: vLLM or Ollama/OpenAI-compatible server, chosen behind an adapter.
- Service: `services/ai-runner`.
- Connection pattern: outbound-only long polling to Cloudflare API.
- Authentication: Cloudflare Access service token plus signed job payloads.
- Job leasing: API leases one job at a time or small batches from Postgres.
- Result posting: local runner submits structured JSON, token usage, model version, prompt version, latency, and confidence.

No cloud service should directly call the local machine over an open inbound port.

## AI Pipeline

### AI Job Types

1. Article language and extraction QA
   - Validate title/body/date/source extraction.
   - Detect article type: news, opinion, liveblog, press release, satire, sponsored, duplicate, non-article.

2. Claim extraction
   - Extract atomic claims, named entities, locations, dates, organizations, and quoted speakers.

3. Story clustering support
   - Generate short semantic fingerprints.
   - Identify whether two articles describe the same event.

4. Neutral story summary
   - Summarize only from clustered sources.
   - Separate consensus, disagreement, and missing context.

5. Bias/context classification
   - Apply country-specific taxonomy only when source country/context is known.
   - Return `insufficient_context` when not reliable.

6. Factuality/reliability support
   - Do not judge truth directly.
   - Estimate article/source quality signals: sourcing, corrections, named evidence, sensational wording, unsupported claims.
   - Store as AI-assessed signals, not definitive factuality.

7. Ownership extraction support
   - Assist in source ownership research from public metadata.
   - Require confidence and citations/URLs.
   - Low-confidence ownership data remains unpublished.

8. Safety/compliance check
   - Detect defamatory summaries, unsupported certainty, overlong snippets, copyrighted text leakage, and policy-sensitive outputs.

### AI Output Contract

Every AI result must include:

- `job_id`
- `model_name`
- `model_version`
- `prompt_version`
- `input_artifact_ids`
- `output_schema_version`
- `structured_output`
- `confidence`
- `reasons`
- `citations_to_input_ids`
- `validation_status`
- `created_at`
- `latency_ms`

Invalid JSON or schema failures are retried once, then marked `failed_schema_validation`.

### Confidence Gates

User-facing output rules:

- `confidence >= 0.80`: publish normally.
- `0.60 <= confidence < 0.80`: publish only non-sensitive metadata; exclude from aggregate bias/factuality charts.
- `< 0.60`: hold/soft-hide; visible only in admin/debug tooling.
- Any ownership or bias label with weak evidence remains unpublished.

## Ingestion and Crawling

### Source Discovery

Initial sources come from:

- Publisher RSS/Atom feeds.
- Google News RSS topic/search feeds.
- Public news sitemaps.
- Curated seed lists by country/language/category.
- User-submitted source suggestions.
- Links discovered from existing clustered coverage.

### RSS Validation Requirement

RSS/Google News RSS entries are never trusted as final truth.

For every RSS item:

1. Fetch RSS item.
2. Resolve redirects.
3. Fetch canonical article page.
4. Extract canonical URL from HTML.
5. Compare RSS title/date/source with page title/date/source.
6. Extract metadata from:
   - canonical link
   - OpenGraph tags
   - Twitter card tags
   - schema.org JSON-LD
   - article HTML
7. Mark validation state:
   - `rss_verified`
   - `rss_mismatch_title`
   - `rss_mismatch_date`
   - `canonical_failed`
   - `blocked_by_policy`
   - `extraction_failed`

Only `rss_verified` or manually allowed mismatch states proceed to clustering.

### Crawl Compliance

Per-source policy table:

- `robots_allowed`
- `crawl_delay_ms`
- `allowed_paths`
- `disallowed_paths`
- `terms_notes`
- `max_requests_per_hour`
- `requires_js`
- `rss_only`
- `no_snippet`
- `do_not_crawl`

Crawler behavior:

- Respect robots.txt.
- Use clear user agent with contact email.
- Per-domain rate limits.
- Back off on 403/429/5xx.
- No paywall bypassing.
- No login-wall scraping.
- Honor takedown requests.

### Article Extraction

Extraction steps:

1. URL normalization.
2. HTML fetch.
3. boilerplate removal.
4. metadata extraction.
5. language detection.
6. author/date extraction.
7. short snippet generation.
8. duplicate detection.
9. paywall detection.
10. article type classification.

## Data Model

### Core Tables

- `sources`
  - publisher identity, domain, country, language, ownership status, crawl policy, trust metadata.

- `source_feeds`
  - RSS/Atom/Google News RSS feed URLs, validation state, last fetched.

- `crawl_jobs`
  - queued fetches, retries, status, domain lease, error details.

- `crawl_artifacts`
  - fetched URL, status code, content hash, R2 key, metadata hash.

- `articles`
  - canonical URL, source ID, title, snippet, author, publish time, language, article type, paywall flag.

- `article_versions`
  - captures changed title/snippet/metadata over time.

- `stories`
  - clustered event object, summary, topic tags, first/last seen.

- `story_articles`
  - many-to-many articles to stories, with cluster confidence.

- `entities`
  - people, organizations, locations, topics.

- `story_entities`
  - story/entity links.

- `claims`
  - extracted claims from articles.

- `ai_jobs`
  - pending/leased/completed/failed local AI jobs.

- `ai_results`
  - structured outputs from model.

- `taxonomies`
  - country-specific political spectrum definitions.

- `source_ratings`
  - AI/public-data-derived source labels, ownership, confidence, evidence.

- `story_metrics`
  - precomputed counts by source country/language/taxonomy/factuality/ownership.

- `takedown_requests`
  - publisher/user compliance workflow.

### Convex Collections

- `user_profiles`
- `user_follows`
- `user_hidden_sources`
- `user_hidden_topics`
- `saved_stories`
- `feed_projections`
- `notifications`

Convex records should reference Postgres IDs, not duplicate canonical article/story data.

## Public APIs

### Read APIs

- `GET /stories`
  - filters: topic, country, language, date, source, entity, coverage imbalance.

- `GET /stories/:id`
  - story metadata, summary, articles, coverage distribution.

- `GET /articles/:id`
  - article metadata and source link.

- `GET /sources/:id`
  - publisher profile, crawl metadata, ratings, ownership if published.

- `GET /search`
  - query by keyword, URL, source, entity.

- `POST /resolve-url`
  - accepts article URL, returns matching story or queues crawl.

### User APIs

- `POST /user/follow`
- `POST /user/hide`
- `POST /user/save-story`
- `DELETE /user/save-story/:id`

### Internal APIs

- `POST /internal/crawl/enqueue`
- `POST /internal/ai/jobs/lease`
- `POST /internal/ai/jobs/:id/result`
- `POST /internal/sources/:id/policy`
- `POST /internal/takedown`

All internal APIs require Cloudflare Access or signed service tokens.

## Monorepo Structure

```text
apps/
  web/
  admin/
  api/

services/
  crawler/
  parser/
  clusterer/
  scheduler/
  ai-runner/

packages/
  db/
  shared/
  ai/
  crawler-core/
  config/
  observability/
  convex-sync/

infra/
  cloudflare/
  vercel/
  neon/
  runbooks/

docs/
  architecture/
  compliance/
  prompts/
  evals/
```

## Tooling

Use:

- Bun for package manager, scripts, tests.
- Turborepo for orchestration.
- TypeScript everywhere.
- Drizzle for Postgres schema/migrations.
- Zod for API and AI output validation.
- Playwright only for compliant JS-rendered extraction fallback.
- OpenTelemetry for traces.
- Sentry for frontend/API errors.
- Better Stack, Axiom, or Grafana Cloud free tier for logs initially.
- Vitest for unit tests.
- Docker Compose for local Postgres, Redis-compatible queue if needed, and local model server mocks.
- Biome for lint/format.
- GitHub Actions for CI.

## Observability Requirements

Track:

- Crawl success rate by domain.
- Robots/policy blocks.
- RSS/page mismatch rate.
- Extraction failure rate.
- Cluster merge/split corrections.
- AI job latency.
- AI schema failure rate.
- AI confidence distribution.
- Local inference node uptime.
- Queue depth.
- Cost per 1,000 articles.
- Takedown/compliance events.

Admin dashboards must expose these before public launch.

## Testing Plan

### Unit Tests

- URL canonicalization.
- RSS parsing.
- Google News RSS URL resolution.
- robots.txt parsing.
- rate-limit policy.
- article metadata extraction.
- language detection wrapper.
- Zod validation for all AI outputs.
- taxonomy mapping.

### Integration Tests

- RSS item to canonical page validation.
- crawler to parser to article insert.
- article cluster creation.
- local AI runner job lease/result lifecycle.
- Convex projection sync from Postgres.
- story API response correctness.

### Evaluation Sets

Create fixed eval datasets for:

- 100 English articles.
- 100 non-English articles.
- 100 RSS/page mismatch examples.
- 100 duplicate/near-duplicate article pairs.
- 100 same-event/different-event clustering pairs.
- 50 opinion vs news vs press release examples.
- 50 low-confidence AI labeling cases.

### Acceptance Criteria for First Real Launch

- 5,000 configured sources.
- At least 70% daily successful source checks.
- At least 80% successful extraction on crawl-allowed pages.
- At least 90% AI output schema validity.
- Median story page API response under 500 ms from cache.
- No full article text displayed publicly.
- All public AI summaries have confidence `>= 0.80`.
- Admin can disable a source, story, article, or AI label within 60 seconds.

## Rollout Plan

### Phase 1: Foundation

- Create monorepo.
- Add Next.js app, Cloudflare Worker API, Convex setup, Drizzle schema.
- Implement source, feed, article, story, AI job tables.
- Build local `ai-runner` with mocked model adapter.
- Build admin skeleton.

### Phase 2: Ingestion MVP

- Add RSS/Atom parser.
- Add Google News RSS seed ingestion.
- Add canonical page verification.
- Add robots and rate-limit policy.
- Ingest 100 sources across 5 languages.
- Store metadata/snippets only.

### Phase 3: AI Review MVP

- Run `gpt-oss-20b` locally behind an OpenAI-compatible adapter.
- Implement article QA, type classification, entity extraction, and summary jobs.
- Add confidence gates and schema validation.
- Add admin review dashboard for failed/held outputs.

### Phase 4: Clustering and Story Pages

- Implement clustering pipeline.
- Build public story pages.
- Show source comparison, headline comparison, coverage distribution, and AI summary.
- Add search and URL lookup.

### Phase 5: Globalization

- Add country-specific taxonomies.
- Add translation support for internal processing.
- Add language/country filtering.
- Expand to 1,000 sources.

### Phase 6: Production-Ready Beta

- Expand to 5,000 sources.
- Add compliance/takedown workflows.
- Add observability dashboards.
- Add source quality dashboards.
- Add feed personalization through Convex projections.
- Run private beta.

## Recommendations Beyond Requested Stack

1. Add R2 object storage from day one.
   - Postgres should not hold raw HTML at scale.

2. Use Postgres as canonical source of truth, not Convex.
   - Convex is excellent for frontend state, but article/story ingestion needs relational integrity, batch jobs, and SQL analytics.

3. Treat AI labels as versioned data products.
   - Prompt/model/schema versions are mandatory or the system becomes impossible to audit.

4. Build admin tooling early.
   - A news product without source controls, takedowns, confidence inspection, and crawl health dashboards will fail operationally.

5. Avoid “AI bias rating” claims early.
   - Position v1 as “coverage context” and “source-pattern analysis.”
   - Strong public claims require evals, methodology pages, and ongoing audits.

6. Plan to leave the free database tier quickly.
   - Free Neon is acceptable for development and early demos.
   - Real ingestion from 5,000 sources will require paid Postgres, storage, and monitoring.

## Explicit Assumptions

- Payment and subscriptions are out of scope.
- Expo/mobile is out of scope for now.
- The first launch is web-only.
- The product displays snippets and metadata, not full publisher articles.
- The crawler obeys robots.txt, publisher terms, and takedown requests.
- The local `gpt-oss-20b` node is allowed to be offline temporarily; jobs remain queued and user-facing summaries degrade gracefully.
- Low-confidence AI outputs are not used in public aggregate labels.
- Global political labels are country-specific and may be unavailable for many sources at launch.

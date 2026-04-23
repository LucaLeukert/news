# Architecture Overview

Coverage Lens separates public product surfaces from ingestion and review workloads.

## Runtime Boundaries

- Vercel hosts `apps/web` and `apps/admin`.
- Cloudflare Workers host `apps/api` and `services/scheduler`.
- Neon/Postgres is canonical for sources, feeds, crawl state, articles, stories, AI jobs, AI results, ratings, metrics, and takedowns.
- Convex stores user-facing projections only: follows, saved stories, hidden preferences, feed projection documents, and notifications.
- R2 stores raw crawl artifacts where legally allowed. Postgres stores hashes, keys, and metadata.
- The local AI node polls outbound to `/internal/ai/jobs/lease` and posts versioned result envelopes back to `/internal/ai/jobs/:id/result`.
- Effect services/layers provide the runtime boundary for HTTP, AI, logging, metrics, Clerk auth, billing, and fallbacks.
- T3 Env validates runtime config in apps, services, and package-level config.

## Confidence Gates

- `confidence >= 0.80`: public AI output may publish after safety validation.
- `0.60 <= confidence < 0.80`: limited metadata only; excluded from aggregate bias/factuality charts.
- `< 0.60`: held for admin/debug tooling.
- Weak ownership or political-context evidence remains unpublished regardless of numeric score.

## Crawl Rules

RSS entries are discovery hints only. Each item must resolve redirects, fetch the canonical page, extract metadata, compare title/date/source, and receive a validation state before clustering. The crawler respects robots.txt, source policy rows, takedowns, rate limits, login walls, and paywalls.

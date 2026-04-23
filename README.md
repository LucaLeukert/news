# Coverage Lens

Production-oriented multilingual news comparison platform scaffolded for:

- Next.js on Vercel for public/admin UI.
- Cloudflare Workers for public/internal APIs and cron entrypoints.
- Neon/Postgres via Drizzle as canonical data storage.
- Convex for frontend-facing user state and feed projections only.
- Local outbound-only `gpt-oss-20b` AI runner.
- Effect services/layers for runtime composition, logging, metrics, retries, and typed fallback paths.
- Clerk for user management and billing identity.
- T3 Env for package/runtime environment validation.
- Oxlint plus Biome for fast linting and formatting.

The repository intentionally stores and displays publisher metadata, links, and short snippets only. Raw crawl artifacts belong in R2, not Postgres.

## Quick Start

```sh
bun install
bun test
bun typecheck
bun --filter @news/api dev
bun --filter @news/web dev
```

Use `docker compose up -d postgres model-mock` for local infrastructure.

## Workspace

- `apps/web`: public story comparison product.
- `apps/admin`: internal operations console.
- `apps/api`: Cloudflare Worker API gateway.
- `services/*`: crawler, parser, clusterer, scheduler, and local AI runner.
- `packages/shared`: Zod contracts, constants, taxonomy helpers, URL normalization.
- `packages/types`: canonical shared domain types, Zod contracts, and value helpers.
- `packages/platform`: Effect runtime services for env, HTTP, metrics, auth, billing, AI, and logging.
- `packages/db`: Drizzle schema and SQL migrations.
- `packages/ai`: prompt versions, structured output schemas, model adapter.
- `packages/crawler-core`: compliant crawling primitives.

## Non-Negotiables

- RSS and Google News RSS items must be verified against canonical article pages.
- AI labels are versioned probabilistic outputs with confidence gates.
- Public AI summaries require `confidence >= 0.80`.
- Weak bias/ownership evidence remains unpublished.
- The product compares source patterns; it is not a real-time fact checker.

## Effect Runtime

Application code should return `Effect.Effect` at service boundaries. Use
`@news/platform` tags and layers for HTTP, metrics, AI, Clerk auth, billing, and
runtime configuration. Package env validation should use T3 Env directly or
through `loadServerEnv`.

Effect devtools are wired through the TypeScript language-service plugin in
`tsconfig.base.json`; run `bun effect:lsp` when configuring editor integration.

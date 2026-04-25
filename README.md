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

Frontend user interactions such as follows, hides, saved stories, feed
projections, and notifications belong in Convex. Backend APIs use the
Neon/Postgres side for canonical news data, crawl state, AI jobs, and
compliance workflows.

## Quick Start

```sh
bun install
bun test
bun typecheck
bun run dev
```

Use `docker compose up -d postgres model-mock` for local infrastructure.

`bun run dev` is the local app/dev entrypoint. It starts `@news/api`,
`@news/web`, and `@news/admin` only, and does not require the local AI runner
or a configured AI model. Use `bun run dev:all` only when you explicitly want
the full workspace dev graph, including service packages.

## First Ingestion Run

```sh
bun run db:migrate
bun run crawler:seed-and-ingest --feed-url <feed-url> --source-name <publisher> --source-domain <publisher-domain> [--country-code <cc>] [--language <lang>]
```

That seeded crawler command will upsert the source/feed rows, fetch and
validate feed items, persist article metadata into Postgres, rebuild current
story clusters, and enqueue `neutral_story_summary` AI jobs.

Then run:

```sh
bun run api:dev
bun run ai:runner
```

The AI runner now uses `LOCAL_MODEL_NAME` for summary generation, so the first
leased jobs will target the configured local model instead of the static model
policy defaults.

## Remote AI Runner

To run the AI worker on the Windows LM Studio host:

```sh
bun run api:dev:lan
bun run remote:ai:sync
bun run remote:ai:start
```

Use [.env.remote-ai.example](/Users/lucaleukert/src/news/.env.remote-ai.example:1)
as the template for the remote `.env.remote-ai` file. The AI runner now leases
jobs grouped by model policy order, processing a batch of one model before
moving to the next to avoid repeated model hot-loading on the LM Studio host.

## Workspace

- `apps/web`: public story comparison product.
- `apps/admin`: internal operations console.
- `apps/api`: Cloudflare Worker API gateway.
- `services/*`: crawler, parser, clusterer, scheduler, and local AI runner.
- `packages/shared`: shared Effect Schema contracts, constants, taxonomy helpers, and URL normalization.
- `packages/types`: canonical shared domain types, Effect Schema contracts, and value helpers.
- `packages/platform`: Effect runtime services for HTTP, metrics, auth, billing, AI, and logging.
- `packages/env`: shared T3 Env schemas and typed env loaders for Next, workers, services, Convex, and DB tooling.
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
runtime configuration. Environment validation should come from `@news/env`, with
root `.env` as the single local source of truth.

Effect devtools are wired through the TypeScript language-service plugin in
`tsconfig.base.json`; run `bun effect:lsp` when configuring editor integration.

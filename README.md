# Coverage Lens

Coverage Lens is a multilingual news comparison platform built around one
principle: canonical backend state stays typed, reviewable, and operationally
observable.

The stack is intentionally split:

- `apps/web`: public product UI on Next.js. Reads projection data and does not
  call internal RPC directly.
- `apps/admin`: internal operations UI on Next.js. Uses typed internal RPC for
  operational reads and mutations.
- `apps/api`: Cloudflare Worker API and Effect RPC boundary.
- `services/*`: crawler, scheduler, clusterer, parser, and AI runner.
- `packages/*`: shared domain schemas, DB schema, Effect platform services,
  env parsing, crawler primitives, and AI contracts.

The repository stores publisher metadata, links, and short snippets only. Raw
HTML and other crawl artifacts belong in object storage, not Postgres.

## Quick Start

```sh
bun install
bun test
bun run typecheck
bun run lint
bun run dev
```

Use `docker compose up -d postgres model-mock` for local infrastructure when
you need the local database and model fixtures.

`bun run dev` starts the main local app graph:

- `@news/api`
- `@news/web`
- `@news/admin`
- `@news/convex`

Use `bun run dev:all` only when you explicitly want the full workspace graph.

## First Crawl

```sh
bun run db:migrate
bun run crawler:seed-and-ingest --feed-url <feed-url> --source-name <publisher> --source-domain <publisher-domain> [--country-code <cc>] [--language <lang>]
```

That command seeds the source/feed rows, verifies feed items against canonical
article pages, persists article metadata, rebuilds current story clusters, and
queues story-summary AI jobs.

To run the local stack afterward:

```sh
bun run api:dev
bun run ai:runner
```

## Architecture

### Runtime Boundaries

- Vercel hosts `apps/web` and `apps/admin`.
- Cloudflare Workers host `apps/api` and `services/scheduler`.
- Neon/Postgres is the canonical store for sources, feeds, crawl state,
  articles, stories, AI jobs, AI results, and review/compliance state.
- Convex holds frontend-facing projections and user state only.
- R2 stores raw crawl artifacts where legally allowed.
- The AI runner polls outbound, leases jobs from the API, and posts structured
  results back.

### Internal Networking

- Services and admin operations go through Effect RPC exposed by `apps/api`.
- Public product pages should read projection data, not internal RPC.
- Neon is canonical; Convex is a derived read model.
- Avoid ad hoc REST endpoints when a typed RPC contract exists.

### Effect Runtime

Application boundaries use `Effect.Effect` and runtime services from
`@news/platform`:

- `HttpService`
- `MetricsService`
- `AiGateway`
- `AuthService`
- `BillingService`

Runtime composition happens through layers, with env validation coming from
`@news/env`.

### AI and Publication Gates

- AI outputs are versioned, probabilistic, and stored with validation status.
- Public AI summaries require `confidence >= 0.80`.
- Weak ownership or political-context evidence remains unpublished even when a
  numeric score is present.
- The product compares coverage patterns; it is not a fact-checker.

### Crawl Rules

- RSS and Google News RSS items are discovery hints only.
- Every item must resolve to a canonical article page and receive a validation
  state before clustering.
- The crawler must respect robots.txt, source policy rows, rate limits,
  takedowns, login walls, and paywalls.

## Quality Gates

Run these before finishing backend-heavy work:

```sh
bun test
bun run typecheck
bun run lint
bun effect:lsp diagnostics --project /Users/lucaleukert/src/news/tsconfig.base.json --format text
```

Effect LSP errors are blockers. Warnings in untouched legacy code should be
reduced when practical, not ignored by default.

## Runbook

Operational procedures, compliance notes, remote AI runner steps, and eval
dataset guidance live in [RUNBOOK.md](/Users/lucaleukert/src/news/RUNBOOK.md).

## Historical Planning

The original product planning document is kept in
[plan-build-a-ground-news-competitor-with-ai-reviewed-global-news-coverage.md](/Users/lucaleukert/src/news/plan-build-a-ground-news-competitor-with-ai-reviewed-global-news-coverage.md)
as background context, not as the current source of truth.

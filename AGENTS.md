## Project Rules

### Type Safety

- Type safety is this codebase's top priority. Make every technical decision with type safety in mind.

### Effect

- Use Effect for service boundaries, IO, async work, retries, logging, metrics, env access, and dependency injection. Keep pure deterministic functions pure; use Effect only for boundaries or dependency, failure, concurrency, resources, logging, metrics, or time.
- Model dependencies as Effect services, never untyped helpers or module globals. Use `*Shape` plus `Context.Service`, for example `export class Name extends Context.Service<Name, NameShape>()("@news/package/Name") {}`. Do not use `Context.GenericTag` for new services.
- Runtime dependencies are `Layer`s. Use `Layer.effect` when construction needs services, and expose fully provided `*Live` layers when callers should not see internals.
- Service methods return `Effect.Effect<Success, Failure, Requirements>`. Capture logging, metrics, HTTP, DB, auth, or config in the layer or expose it honestly in `Requirements`; public services should not leak internals like `MetricsService` or DB requirements.
- Prefer `Data.TaggedError` over `unknown`, raw `Error`, or string failures. In Effect code, use `Clock`, Effect logging, and Effect platform services instead of `Date.now`, `new Date`, `console`, global `fetch`, timers, or direct process access.

### Effect LSP

- Effect LSP is configured in `tsconfig.base.json`; editors should use the workspace TypeScript version.
- Before finishing Effect-heavy changes, run `bun effect:lsp diagnostics --project /Users/lucaleukert/src/news/tsconfig.base.json --format text`.
- Effect LSP errors are blockers. Reduce warnings touching changed code unless compatibility prevents it. Keep diagnostics editor-side; do not patch `tsc` unless explicitly requested.

### Environment

- Parse runtime env only through `@t3-oss/env-core` or `@t3-oss/env-nextjs`.
- Shared server env lives in `packages/platform/src/env.ts` via `loadServerEnv`; app env modules like `apps/web/env.ts` and `apps/admin/env.ts` use T3 Env directly.
- Do not read `process.env` deep in application logic. Parse near the runtime entrypoint and pass typed config through Effect layers or explicit inputs. Normalize Cloudflare Worker env bindings into the same typed env shape before core logic.

### Shared Types And Schemas

- Put public API contracts, article/story/source types, AI envelopes, crawl states, taxonomy buckets, URL helpers, and constants in `@news/types` or `@news/shared`.
- Validate external inputs and API outputs with shared Effect `Schema` definitions from `@news/types` using v4 APIs such as `Schema.decodeUnknownSync`, `Schema.decodeUnknownEffect`, `Schema.encodeEffect`, `Schema.Literals`, `Schema.Struct`, `Schema.Record(key, value)`, and `.check(...)` filters.
- Keep Zod limited to libraries that require it directly, such as `@t3-oss/env-*` and AI SDK structured output schemas. Do not use Zod for shared public/domain contracts.
- Do not duplicate domain literals such as crawl states, article types, AI job types, taxonomy buckets, languages, or confidence gates in app code.
- Keep publisher full text out of public schemas; store and display metadata/snippets only.

### Logging And Metrics

- Use `Effect.log*` for app logging. No `console.*` inside services, API handlers, runners, or crawler code except isolated temporary CLI/debug output.
- Use `MetricsService` from `@news/platform` for counters and gauges. Emit metrics through Effect at operational boundaries: crawl success/failure, RSS mismatches, queue depth, cluster scores, AI latency/confidence/schema failures, and compliance events.

### Implementation

- Keep fixtures behind the same Effect service interfaces as production code.
- Add Postgres-backed implementations by swapping layers, not API handler logic.
- Preserve graceful offline AI behavior: AI jobs may queue or return `null`, and public summaries stay absent unless confidence-gated output exists.
- After meaningful backend changes, run `bun test`, `bun run typecheck`, and Effect LSP diagnostics.

# Effect Runtime

The production runtime is centered on `packages/platform`, with shared env
validation in `packages/env`.

## Services

- `HttpService`: typed fetch wrapper with retry, logging, and metrics.
- `MetricsService`: Effect metrics counters/gauges plus structured logs.
- `AiGateway`: AI SDK `createOpenAICompatible` adapter for LM Studio or another local OpenAI-compatible server.
- `AuthService`: Clerk request authentication through the backend SDK.
- `BillingService`: Clerk billing identity boundary. The current app exposes billing state/links and keeps plan data as projections.

## Layers

`makeAppLayer(env)` composes the live services. Cloudflare Workers, schedulers,
the crawler, and the AI runner provide this layer before running service
programs.

## Error Handling

Expected failures use tagged errors in `packages/platform/src/errors.ts` and
domain validation failures use `DomainValidationError` from `@news/types`.
Fallbacks are explicit with `Effect.catchAll` or tag-specific handlers.

## Env

T3 Env is used for:

- Shared schemas and loaders in `@news/env`.
- Thin app re-exports in `apps/web/env.ts` and `apps/admin/env.ts`.
- Worker/service env through `loadServerEnv`.
- Database config through `packages/db`.

Empty strings are treated as undefined so local development can run without
Clerk/Neon secrets until those integrations are configured.

# Networking

This project uses a strict split between internal service networking and
client-facing data access.

## Rules

- Internal service-to-service communication goes through Effect RPC exposed by
  `apps/api`.
- Neon/Postgres is the canonical store for backend data: sources, crawl state,
  articles, stories, AI jobs, and review/compliance state.
- Convex is the client-facing read model. Public product pages should read from
  Convex projections instead of calling backend RPC directly.
- Admin is an internal surface. It may use RPC for operational actions and
  Convex for projection-backed reads.

## Allowed Paths

- Services/workers -> Effect RPC -> API -> Neon
- Neon change -> sync worker -> Convex projection tables
- Web/admin clients -> Convex queries and mutations

## Not Allowed

- Client apps calling Neon directly
- Public product pages calling internal RPC directly for page data
- Service-to-service traffic over ad hoc REST endpoints when an RPC contract
  exists
- Treating Convex as the canonical backend store for crawler, article, or AI
  pipeline state

## Sync Model

The intended flow is write to Neon first, then update Convex from a worker or
background sync process. Convex should be treated as a derived cache/projection,
not the source of truth.

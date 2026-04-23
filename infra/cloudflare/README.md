# Cloudflare

Use Cloudflare for:

- `apps/api` Worker.
- `services/scheduler` Cron Triggers.
- Queues for crawl and AI handoff points.
- R2 for crawl artifacts.
- Durable Objects for per-domain leases and rate limiting once crawler volume grows.
- Access for admin and internal endpoints.

Internal routes require Cloudflare Access JWTs or signed service tokens.

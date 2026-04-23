# Neon/Postgres

Neon free tier is acceptable for development and demos only. The schema keeps canonical records in relational tables and avoids raw HTML in Postgres.

Month-one migration options:

- Paid Neon.
- Crunchy Bridge.
- RDS Postgres.
- Self-hosted Postgres with managed backups.

Operational priorities:

- Partition large article/artifact/result tables by time before scale ingestion.
- Keep R2 as raw artifact storage.
- Monitor queue depth and write throughput before expanding source count.

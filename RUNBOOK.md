# Runbook

This file replaces the old split between architecture, compliance, prompt, and
eval notes for day-to-day operation.

## Crawling Compliance

The crawler must:

- Use a clear user agent with contact details.
- Respect robots.txt and per-source policy rows.
- Back off on `403`, `429`, and `5xx`.
- Avoid paywall bypassing and login-wall scraping.
- Store raw HTML only in object storage when legally allowed.
- Display only metadata, short snippets, and publisher links publicly.
- Honor `no_snippet` and `do_not_crawl` source policy fields.
- Keep takedown and override workflows visible in admin tooling.

## Local Ingestion

```sh
bun run db:migrate
bun run crawler:seed-and-ingest --feed-url <feed-url> --source-name <publisher> --source-domain <publisher-domain> [--country-code <cc>] [--language <lang>]
```

For targeted recovery of bad validations:

```sh
bun run crawler:reingest-failed-verification
```

## Remote AI Runner

To run the Windows-hosted AI worker:

```sh
bun run api:dev:lan
bun run remote:ai:sync
bun run remote:ai:start
```

Use [.env.remote-ai.example](/Users/lucaleukert/src/news/.env.remote-ai.example:1)
as the template for `.env.remote-ai`.

Recommended settings there:

- `AI_HOST_PROFILE=real`
- `AI_MODEL_POLICY_PROFILE=real`

For local `ollama` or mock testing, use:

- `AI_HOST_PROFILE=local`
- `AI_MODEL_POLICY_PROFILE=local_test`

## Admin Operations

The admin app is an internal surface:

- Operational actions should go through typed RPC exposed by `apps/api`.
- Admin server actions should stay thin and avoid importing crawler/runtime
  internals directly.
- AI jobs should be inspected per run, with grouped attempts and event logs.

## Prompt Contract

Current story-summary prompt version:

- `story-summary@2026-04-24`

The prompt contract is:

- Use only supplied metadata and snippets.
- Do not claim objective truth.
- Separate agreement, differences, and contested or unverified claims.
- Return structured JSON.
- Include confidence and reasons.
- Never include full article text.

## Evaluation Coverage

Keep fixed evaluation datasets before beta:

- 100 English articles
- 100 non-English articles
- 100 RSS/page mismatch examples
- 100 duplicate or near-duplicate article pairs
- 100 same-event/different-event clustering pairs
- 50 opinion/news/press-release examples
- 50 low-confidence AI labeling cases

Each fixture should record:

- source URL
- country and language context
- expected validation state
- expected public visibility
- why the case is difficult

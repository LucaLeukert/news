1. Start the API on the local machine so the Windows runner can reach it:
   `bun run api:dev:lan`
2. Seed the first source/feed locally:
   `bun run crawler:seed-and-ingest --feed-url <feed-url> --source-name <publisher> --source-domain <publisher-domain> [--country-code <cc>] [--language <lang>]`
3. Sync the repo to the Windows AI host:
   `bun run remote:ai:sync`
4. Start the remote AI runner:
   `bun run remote:ai:start`

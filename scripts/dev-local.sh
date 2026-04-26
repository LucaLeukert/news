#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

bun run api:prepare-local
bash ./scripts/sync-remote-ai-runner.sh
#bash ./scripts/start-remote-ai-runner-detached.sh

exec bun --env-file ./.env turbo dev:local \
  --filter=@news/api \
  --filter=@news/admin \
  --filter=@news/web \
  --filter=@news/convex \
  --ui tui

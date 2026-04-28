#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

AI_HOST_PROFILE="$(
  awk -F= '
    $1 == "AI_HOST_PROFILE" {
      gsub(/\r/, "", $2)
      print $2
      exit
    }
  ' .env
)"

bun run api:prepare-local

FILTERS=(
  --filter=@news/api
  --filter=@news/admin
  --filter=@news/web
  --filter=@news/convex
)

if [[ "${AI_HOST_PROFILE:-local}" == "real" ]]; then
  bash ./scripts/sync-remote-ai-runner.sh
else
  FILTERS+=(--filter=@news/ai-runner)
fi

exec bun --env-file ./.env turbo dev:local \
  "${FILTERS[@]}" \
  --ui tui

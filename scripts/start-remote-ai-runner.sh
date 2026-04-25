#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_AI_HOST:-luca@10.25.97.107}"
REMOTE_DIR='C:/Users/luca/src/news'
REMOTE_ENV_FILE='C:/Users/luca/src/news/.env.remote-ai'

ssh "${REMOTE_HOST}" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"cd '${REMOTE_DIR}'; bun --env-file '${REMOTE_ENV_FILE}' --filter @news/ai-runner dev\""

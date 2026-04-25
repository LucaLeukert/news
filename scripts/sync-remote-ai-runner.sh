#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_AI_HOST:-luca@10.25.97.107}"
REMOTE_DIR='C:/Users/luca/src/news'

ssh "${REMOTE_HOST}" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path 'C:\\Users\\luca\\src\\news' | Out-Null\""

tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.turbo' \
  --exclude='apps/*/.next' \
  --exclude='apps/*/dist' \
  --exclude='packages/*/dist' \
  -czf - . \
  | ssh "${REMOTE_HOST}" "tar -xzf - -C ${REMOTE_DIR}"

ssh "${REMOTE_HOST}" "cd ${REMOTE_DIR} && bun install --frozen-lockfile"

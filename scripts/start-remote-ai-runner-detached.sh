#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_AI_HOST:-luca@10.25.97.107}"
REMOTE_DIR='C:\Users\luca\src\news'
REMOTE_ENV_FILE='C:\Users\luca\src\news\.env.remote-ai'
REMOTE_LOG_FILE='C:\Users\luca\src\news\.remote-ai-runner.log'
REMOTE_ERR_FILE='C:\Users\luca\src\news\.remote-ai-runner.err.log'

PS_SCRIPT="$(cat <<EOF
\$ProgressPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process |
  Where-Object { \$_.CommandLine -like '*@news/ai-runner dev*' } |
  ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path '${REMOTE_LOG_FILE}') { Remove-Item '${REMOTE_LOG_FILE}' -Force }
if (Test-Path '${REMOTE_ERR_FILE}') { Remove-Item '${REMOTE_ERR_FILE}' -Force }
\$command = 'cd /d ${REMOTE_DIR} && C:\\Users\\luca\\.bun\\bin\\bun.exe --env-file ${REMOTE_ENV_FILE} --filter @news/ai-runner dev 1>${REMOTE_LOG_FILE} 2>${REMOTE_ERR_FILE}'
\$process = Start-Process -FilePath 'C:\\Windows\\System32\\cmd.exe' -ArgumentList @('/c', \$command) -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
if (Get-Process -Id \$process.Id -ErrorAction SilentlyContinue) {
  Write-Output 'remote ai runner started'
  exit 0
}
Write-Output 'remote ai runner failed'
if (Test-Path '${REMOTE_ERR_FILE}') { Get-Content '${REMOTE_ERR_FILE}' -Tail 80 }
if (Test-Path '${REMOTE_LOG_FILE}') { Get-Content '${REMOTE_LOG_FILE}' -Tail 80 }
exit 1
EOF
)"

ENCODED_COMMAND="$(
  printf '%s' "${PS_SCRIPT}" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n'
)"

ssh "${REMOTE_HOST}" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${ENCODED_COMMAND}"

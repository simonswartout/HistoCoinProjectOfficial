#!/usr/bin/env bash
set -euo pipefail

MODEL=${1:-llama3}
HOST=${OLLAMA_HOST:-http://localhost:11434}

if ! command -v curl >/dev/null 2>&1; then
  echo "[setup-llama] curl is required" >&2
  exit 1
fi

echo "[setup-llama] Requesting ${MODEL} from ${HOST}"
RESP=$(curl -sS -X POST "${HOST}/api/pull" -H 'Content-Type: application/json' -d "{\"model\":\"${MODEL}\"}") || {
  echo "[setup-llama] Failed to reach Ollama host" >&2
  exit 1
}

echo "${RESP}"
echo "[setup-llama] If this shows \"status\": \"success\" the model is ready."

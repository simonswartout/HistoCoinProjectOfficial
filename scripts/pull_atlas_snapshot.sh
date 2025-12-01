#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="$ROOT_DIR/config/atlas-index.json"
ENDPOINT="${ATLAS_PULL_ENDPOINT:-${1:-}}"
if [[ -z "$ENDPOINT" ]]; then
  echo "Usage: ATLAS_PULL_ENDPOINT=https://worker-atlas.example.workers.dev/api/atlas $0"
  echo "   or   $0 https://worker-atlas.example.workers.dev/api/atlas"
  exit 1
fi
TMP_FILE="${OUTPUT_FILE}.tmp"
echo "Pulling atlas snapshot from $ENDPOINT"
http_status=$(curl -fsSL -w "%{http_code}" "$ENDPOINT" -o "$TMP_FILE")
if [[ "$http_status" != "200" ]]; then
  echo "Snapshot fetch failed with status $http_status" >&2
  rm -f "$TMP_FILE"
  exit 1
fi
mv "$TMP_FILE" "$OUTPUT_FILE"
echo "Updated $OUTPUT_FILE"

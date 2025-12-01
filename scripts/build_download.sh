#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/node"
DOWNLOAD_DIR="$ROOT_DIR/downloads/histograph-node"

echo "[build-download] Installing node dependencies"
cd "$NODE_DIR"
npm install

echo "[build-download] Building TypeScript CLI"
npm run build

echo "[build-download] Refreshing packaged CLI"
cd "$ROOT_DIR"
rm -rf "$DOWNLOAD_DIR/cli"
mkdir -p "$DOWNLOAD_DIR/cli"
cp -r "$NODE_DIR/dist"/* "$DOWNLOAD_DIR/cli/"

echo "[build-download] Syncing sample configs"
cp "$NODE_DIR/config/sources.sample.json" "$DOWNLOAD_DIR/sources.sample.json"
cp "$NODE_DIR/config/sources.sample.json" "$DOWNLOAD_DIR/sources.json"
cp "$NODE_DIR/config/global-sources.json" "$DOWNLOAD_DIR/global-sources.json"

echo "[build-download] Installing runtime dependencies inside bundle"
cd "$DOWNLOAD_DIR"
npm ci --omit=dev --ignore-scripts
chmod +x setup-llama.sh

echo "[build-download] Repacking zip bundle"
cd "$ROOT_DIR/downloads"
rm -f histograph-node.zip
zip -r histograph-node.zip histograph-node >/dev/null

echo "[build-download] Bundle ready at downloads/histograph-node.zip"
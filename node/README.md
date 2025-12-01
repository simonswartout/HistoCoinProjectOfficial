# HistoCoin Node CLI

This package provides a headless, resource-aware CLI that lets any contributor run a mining node outside the FastAPI master. Each node pulls sources from a local JSON file (or directly from the master), scrapes CC0-friendly artifacts, and reports the results back through the `/master/ingest` endpoint.

## Features
- Declarative source configuration (`config/sources.sample.json`).
- Pluggable scraping strategies (generic HTML today, extensible for APIs like the Met).
- Lightweight CC0 heuristics (keyword + metadata scanning) before sending artifacts.
- Structured payloads with provenance metadata so the master can append validator-friendly bubbles.
- Continuous mode with per-loop cooldowns to avoid hammering sources.

## Prerequisites
- Node.js **18.17+** (fetch + WHATWG streams built in).
- `MASTER_URL` environment variable that points at a running FastAPI master (defaults to `http://localhost:8000`).
- Optional `NODE_ID` (falls back to a random UUID each run).

Install dependencies:
```bash
cd node
npm install
```

## Configure Sources
Copy the sample file and edit it with URLs you are allowed to scrape:
```bash
cp config/sources.sample.json config/sources.json
```
Each source entry supports:
```json
{
  "id": "met-demo",
  "name": "Met Museum Sample",
  "baseUrl": "https://www.metmuseum.org/art/collection/search/436535",
  "type": "generic",
  "notes": "Known CC0 object"
}
```

## Global Source Index

Use `config/global-sources.json` as a shared clipboard of promising archives. Add URLs via CLI so everyone gets them automatically:

```bash
npm run dev -- add-source https://archives.si.edu/object/ark:/65665/123 \
  --name "Smithsonian Notebook"
```

- `--index /custom/path/global.json` stores the registry elsewhere (e.g. `$HOME/.histograph`).
- `run --target-url <url>` ensures the URL is present (adding it if necessary) and scrapes it immediately.
- `run --random-global` picks a random entry from the registry when you want variety.

## Run the Miner
Development mode (TypeScript + tsx):
```bash
npm run dev -- --sources config/sources.json --loop
```
Compiled mode:
```bash
npm run build
node dist/index.js run --sources config/sources.json
```

Key flags:
- `--master-url` overrides `MASTER_URL`.
- `--node-id` overrides `NODE_ID`.
- `--loop` keeps the miner running indefinitely.
- `--interval 60` waits N seconds between loops (default 30).
- `--dry-run` prints payloads instead of POSTing.
- `--fetch-remote-sources` pulls `GET /sources` from the master instead of reading JSON.
- `--target-url https://...` scrapes one URL and adds it to the global index.
- `--random-global` selects a random record from the global index.
- `--global-index /path/to/global.json` lets you relocate the registry.

## Packaged Download

A prebuilt archive lives at `downloads/histograph-node.zip` in the repo root (and is served via GitHub Pages). It contains the compiled `cli/` bundle, `sources.sample.json`, `sources.json`, `global-sources.json`, a lightweight README, and a minimal `package.json` (so Node treats the bundle as ESM) — unzip and run the miner with nothing but Node 18+.

To refresh the downloadable archive after you change the CLI code:

```bash
cd node
npm install            # once
npm run build          # updates dist/
cd ..
rm -rf downloads/histograph-node/cli
mkdir -p downloads/histograph-node/cli
cp -r node/dist/* downloads/histograph-node/cli/
cp node/config/sources.sample.json downloads/histograph-node/sources.sample.json
cp node/config/global-sources.json downloads/histograph-node/global-sources.json
cd downloads
zip -r histograph-node.zip histograph-node
```

(Any equivalent automation is fine—the key requirement is that `downloads/histograph-node.zip` always ships the compiled CLI and sample config.)

## Roadmap
- Support authenticated node tokens once the master issues API keys.
- Add Playwright-powered scraping for interactive sources.
- Integrate transformer-based CC0 verification and on-device GPU helpers.
- Persist local cache to skip URLs that have already been mined.

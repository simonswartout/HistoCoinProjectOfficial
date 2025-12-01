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

## Roadmap
- Support authenticated node tokens once the master issues API keys.
- Add Playwright-powered scraping for interactive sources.
- Integrate transformer-based CC0 verification and on-device GPU helpers.
- Persist local cache to skip URLs that have already been mined.

# HistoCoin Node CLI

This package provides a headless, resource-aware CLI that lets any contributor run a mining node outside the FastAPI master. Each node pulls sources from a local JSON file (or directly from the master), scrapes CC0-friendly artifacts, and reports the results back through the `/master/ingest` endpoint.

## Features
- Declarative source configuration (`config/sources.sample.json`).
- Pluggable scraping strategies (generic HTML today, extensible for APIs like the Met).
- Collection traversal that walks listing/search pages and hydrates each artifact detail view.
- Auto-append of discovered artifact URLs into the shared global index for future random sampling.
- Optional Meta Llama 3 validation via a local Ollama endpoint for historical relevance scoring.
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
Each source entry can either be a single URL or describe a **collection traversal**:
```json
{
  "id": "nmaa-search",
  "name": "Smithsonian NMAA",
  "baseUrl": "https://asia.si.edu",
  "type": "generic",
  "notes": "Harvests CC0 artifacts from the public search portal",
  "collection": {
    "searchUrlTemplate": "https://asia.si.edu/explore-art-culture/collections/search/?keyword={query}",
    "searchTerms": ["bronze", "silk", "manuscript"],
    "resultItemSelector": ".search-results-image-grid__result a.secondary-link",
    "linkAttribute": "href",
    "maxItems": 9
  }
}
```

Collection fields:
- `listingUrls`: Array of pre-built listing pages to scan.
- `searchUrlTemplate`: URL containing `{query}` placeholder plus a `searchTerms` list for templated listings.
- `resultItemSelector`: CSS selector that points at `<a>` tags to follow (required).
- `linkAttribute`: Attribute that holds the href (defaults to `href`).
- `maxItems`: Caps detail pages per source per loop (defaults to `8`).

## Global Source Index

Use `config/global-sources.json` as a shared clipboard of promising archives. Add URLs via CLI so everyone gets them automatically:

```bash
npm run dev -- add-source https://archives.si.edu/object/ark:/65665/123 \
  --name "Smithsonian Notebook"
```

- `--index /custom/path/global.json` stores the registry elsewhere (e.g. `$HOME/.histograph`).
- `run --target-url <url>` ensures the URL is present (adding it if necessary) and scrapes it immediately.
- `run --random-global` picks a random entry from the registry when you want variety.
- Every time the crawler surfaces a new artifact URL, it will automatically add that URL back into the registry (unless you pass `--no-append-artifacts`).

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
- `--no-append-artifacts` turns off the automatic artifact-to-registry sync.
- `--llama-model llama3.1` and `--llama-endpoint http://localhost:11434/api/generate` configure the Llama classifier (defaults assume Ollama + `llama3`).
- `--disable-llama` skips Llama validation entirely.
- `--atlas-url https://worker.example.com` and `--atlas-key sk_live_...` push each discovery to the Cloudflare worker so the static atlas can ingest it live.
- `--disable-atlas-sync` stops the worker upload step (fallbacks to local-only behavior).

### Llama 3 validation

The CLI can call any Ollama-compatible `/generate` endpoint running an open-source Llama 3 model. By default it targets `http://localhost:11434/api/generate` and `llama3`. To enable it:

```bash
ollama pull llama3
OLLAMA_HOST=http://localhost:11434 # default
npm run dev -- run --llama-model llama3 --llama-endpoint http://localhost:11434/api/generate
```

For each artifact, the node asks Llama for a JSON verdict (`historical` vs `reject`). Rejected artifacts are skipped before submission, and successful verdicts are logged in the payload metadata for future validator review. Disable the step via `--disable-llama` if you do not have a local model.

## Atlas Worker Sync

Set `ATLAS_API_URL` to your deployed Cloudflare Worker (for example `https://histocoin-atlas.workers.dev/api`) and `ATLAS_API_KEY` to the shared bearer token that worker expects. Every accepted source and artifact will be mirrored to the worker so the static atlas map can read live data without needing a site rebuild. Pass `--disable-atlas-sync` (or omit the env vars) if you want purely local runs.

## Packaged Download

A prebuilt archive lives at `downloads/histograph-node.zip` in the repo root (and is served via GitHub Pages). It ships with:
- Compiled `cli/` bundle + production `node_modules` (cheerio, commander, zod) so no `npm install` is required.
- `sources.sample.json`, `sources.json`, `global-sources.json`, and README.
- `package.json`/`package-lock.json` for reference plus a `setup-llama.sh` helper that hits your Ollama daemon to pull `llama3`.

To refresh the downloadable archive after you change the CLI code simply run:

```bash
./scripts/build_download.sh
```

The script installs dependencies (if needed), rebuilds the TypeScript bundle, syncs the sample configs, and regenerates `downloads/histograph-node.zip` in one go.

## Roadmap
- Support authenticated node tokens once the master issues API keys.
- Add Playwright-powered scraping for interactive sources.
- Integrate transformer-based CC0 verification and on-device GPU helpers.
- Persist local cache to skip URLs that have already been mined.

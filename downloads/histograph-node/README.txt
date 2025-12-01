HistoGraphPublic Node CLI
==========================

Contents
--------
- cli/ : Compiled JavaScript bundle (TypeScript source lives in /node).
- node_modules/ : Runtime dependencies (cheerio, commander, zod) already installed for you.
- sources.sample.json : Example CC0-friendly source list (shows collection traversal fields).
- global-sources.json : Shared registry for quick `--random-global` runs.
- sources.json : Editable copy ready for your URLs (pre-copied from sample).
- package.json / package-lock.json : Metadata for completeness if you want to run npm commands.
- setup-llama.sh : Helper that tells Ollama to pull the `llama3` model locally.

Requirements
------------
- Node.js 18.17+ (needed to run the bundled CLI)
- Network access to your master API (default http://localhost:8000)

Quick Start
-----------
1. Extract this folder somewhere safe (e.g. ~/histograph-node).
2. (Optional) Refresh the editable sources list:
   cp sources.sample.json sources.json
3. (Optional) Pull Meta Llama 3 via Ollama (requires `ollama serve` running):
   ./setup-llama.sh
   # uses $OLLAMA_HOST if provided (default http://localhost:11434)
4. (Optional) Add URLs to the shared registry:
   node cli/index.js add-source https://example.org/archive/123 --name "Example Archive"
5. Run the CLI:
   node cli/index.js run --sources sources.json --loop

Collection Fields
-----------------
Each entry inside sources.json can describe listing/search traversal:
- `listingUrls`: Array of list pages to scan.
- `searchUrlTemplate` + `searchTerms`: Build listing URLs with `{query}` substitution.
- `resultItemSelector`: CSS selector pointing at the `<a>` elements to follow.
- `linkAttribute`: Attribute containing the URL (defaults to `href`).
- `maxItems`: Cap the number of detail pages per pass (default 8).

Common Flags
------------
--master-url <url>      Point to a remote master API
--node-id <uuid>        Provide a stable identifier for this machine
--fetch-remote-sources  Pull the /sources list from the master instead of local JSON
--dry-run               Print payloads without submitting to /master/ingest
--target-url <url>      Scrape one URL (auto-adds it to global-sources.json)
--random-global         Pick a random entry from global-sources.json
--no-append-artifacts   Opt out of auto-copying discovered artifact URLs into the registry
--llama-model / --llama-endpoint / --disable-llama  Configure optional Meta Llama 3 validation (defaults expect Ollama at http://localhost:11434)

Llama Prep
----------
- `./setup-llama.sh` issues `POST /api/pull` to your Ollama daemon with the `llama3` model name so you don’t have to memorize the API call.
- Set `OLLAMA_HOST` before running the script (e.g. `OLLAMA_HOST=http://ollama.lan:11434 ./setup-llama.sh`).
- The node CLI automatically checks the endpoint at startup; if the model isn’t ready yet, it logs a warning and continues without Llama validation.

Need help? Email simon@luminarylabs.dev

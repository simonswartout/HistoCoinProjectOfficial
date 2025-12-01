# HistoCoin Distributed Auto‑Miner

## Overview

**HistoCoin** is an open‑source, **headless** application that runs a **genetic neural network** on every client (node) that visits the web front‑end. While the auto‑miner is active, each node uses its own compute resources to:

1. **Scrape** the web for new historical entries.
2. **Compare** the scraped entry against a **global master index** stored in a cloud database.
3. **If the entry already exists** – the node generates AI‑derived content and **appends it as a new "bubble"** to the existing artifact.
4. **If the entry is new** – the node creates a fresh artifact in the master index.

The system is designed to be **distributed**, **scalable**, and **contributable** – anyone can run a node, contribute compute, and help evolve the underlying genetic neural net.

---

## Architecture

```
+-------------------+      HTTP/JSON      +-------------------+
|   Node (headless) | <----------------> |   Master Server   |
|  - Scraper        |   /master/ingest   |  - FastAPI API    |
|  - Genetic NN     |                    |  - PostgreSQL DB  |
|  - CLI entrypoint |                    |  - Artifact index |
+-------------------+                    +-------------------+
```

* **Node** – a lightweight, headless process (Docker container or binary) that runs the scraper continuously. It communicates with the master via the `/master/ingest` endpoint (already added).
* **Master Server** – the central authority that stores the **master index** (PostgreSQL) and aggregates bubbles from all nodes. It also hosts the UI (`databasecollector.html`).
* **Genetic Neural Net** – a custom evolutionary algorithm that evolves a small neural network used for artifact description generation. Implemented with the **DEAP** library (or similar) and persisted in the master DB.

---

## Repository Layout

```
HistoCoinProjectOfficial/
├─ backend/                # FastAPI server (master)
│   ├─ app/
│   │   ├─ main.py        # API endpoints, scraper logic
│   │   ├─ models.py      # SQLAlchemy models (Source, Artifact, Bubble)
│   │   ├─ neural_net.py  # GeneticNeuralNet scaffolding
│   │   └─ ...
│   ├─ Dockerfile          # Build master container
│   └─ requirements.txt
├─ node/                    # Headless Node.js CLI package
│   ├─ README.md           # Usage instructions
│   ├─ package.json        # TypeScript workspace for miners
│   └─ src/                # CLI + scraper + CC0 heuristics
├─ worker-atlas/           # Cloudflare Worker that serves live atlas data
├─ scripts/                # Helper scripts (verify.sh, migrations)
├─ docker-compose.yml      # Orchestration for dev (master + db)
├─ README.md               # **This file**
└─ .gitignore
```

---

## Getting Started (Development)

1. **Clone the repo**
   ```bash
   git clone https://github.com/your-org/HistoCoinProjectOfficial.git
   cd HistoCoinProjectOfficial
   ```
2. **Create a cloud PostgreSQL database** (e.g., Supabase, Railway, or self‑hosted). Set the `DATABASE_URL` env var.
3. **Run the master locally**
   ```bash
   docker compose up -d db api
   # The API will be available at http://localhost:8000
   ```
4. **Start a node** (headless) on the same machine for testing
   ```bash
   NODE_MODE=true NODE_ID=$(uuidgen) MASTER_URL=http://localhost:8000 docker compose run --rm node
   ```
   - `NODE_MODE=true` tells the code to act as a node.
   - `NODE_ID` uniquely identifies the node for bubble attribution.
   - `MASTER_URL` points to the master server.

---

## Implementation Roadmap

| Phase | Goal | Tasks |
|------|------|-------|
| **0 – Foundations** | Existing code base ready for distribution | • Separate node‑specific logic from master (use `NODE_MODE`).<br>• Add `bubbles` JSON column to `Artifact` model (already scaffolded).<br>• Document the `/master/ingest` endpoint. |
| **1 – Node Package** | Provide a clean CLI for running a node | • Create `node/entrypoint.sh` that starts `run_scraper` in background.<br>• Add a small wrapper script (`node/run_node.py`) that sets `NODE_MODE` and calls the scraper.<br>• Build a Docker image `histo-node`.
| **2 – Genetic Neural Net** | Introduce evolutionary AI for description generation | • Add `backend/app/neural_net.py` with a `GeneticNeuralNet` class (using DEAP).<br>• Provide a training loop that runs periodically on the master (e.g., via a background task).<br>• Expose an endpoint `/nn/predict` that nodes can call to get a model‑generated description.
| **3 – Master Index & Bubbles** | Enable nodes to contribute bubbles | • Ensure `Artifact` model has a `bubbles` TEXT column storing JSON list of `{node_id, content}`.
• Update `process_generic_url` / `process_met_object` to send `content` to master via `/master/ingest` when `NODE_MODE` is true.
| **4 – Security & Auth** | Authenticate nodes | • Generate a simple API‑key per node (store in DB).<br>• Require the key in the `Authorization: Bearer <key>` header for `/master/ingest`.
| **5 – Open‑Source Release** | Publish and document | • Add LICENSE (MIT).
• Write CONTRIBUTING.md.
• Set up GitHub Actions for CI (lint, tests, Docker build).
• Publish Docker images to GitHub Packages.

---

## Example Node Workflow
1. **Start** – Node boots, reads `NODE_ID`, `MASTER_URL`, and `NODE_MODE=true`.
2. **Scrape Loop** – Runs the existing auto‑miner loop, fetching sources.
3. **Process** – For each new artifact, the node calls the master `/master/ingest` with JSON `{url, content, node_id}`.
4. **Master Response** – If the URL already exists, the master appends the node’s content as a bubble; otherwise it creates a new artifact.
5. **Genetic NN** – Periodically (e.g., nightly) the master trains the genetic neural net on all stored artifacts and updates the model used by nodes.

---

## Node CLI (TypeScript)

The `node/` workspace provides a standalone CLI for community miners that prefer Node.js over the Python entry point. It mirrors the FastAPI node behaviour and talks to `/master/ingest` directly.

1. Install dependencies:
   ```bash
   cd node
   npm install
   ```
2. Seed a local sources file and edit it with CC0-friendly URLs you are allowed to crawl:
   ```bash
   cp config/sources.sample.json config/sources.json
   ```
3. Describe collections, not single URLs, when archives expose search/listing pages:
   ```json
   {
     "id": "nmaa-search",
     "name": "Smithsonian NMAA",
     "baseUrl": "https://asia.si.edu",
     "collection": {
       "searchUrlTemplate": "https://asia.si.edu/explore-art-culture/collections/search/?keyword={query}",
       "searchTerms": ["bronze", "silk"],
       "resultItemSelector": ".search-results-image-grid__result a.secondary-link",
       "maxItems": 9
     }
   }
   ```
   The node walks each listing, follows every matching link (up to `maxItems`), and hydrates the detail pages before running CC0 heuristics.
4. Run the miner once:
   ```bash
   npm run dev -- run --sources config/sources.json
   ```
5. Run continuously with your master URL and node id:
   ```bash
   MASTER_URL=https://your-master.example.com \
   NODE_ID=$(uuidgen) \
   npm run dev -- run --loop --sources config/sources.json
   ```

Flags worth knowing:
- `--fetch-remote-sources` – ignore the local JSON file and pull `/sources` directly from the master.
- `--dry-run` – print payloads instead of POSTing (great for debugging CC0 heuristics).
- `--interval` / `--cooldown` – throttle loops or per-source scraping to avoid hammering archives.
- `--target-url` – scrape a single URL (it is auto-added to the shared `config/global-sources.json`).
- `--random-global` – pick a random entry from the global index when you want serendipity.
- `--global-index <path>` – point both commands at a custom shared index file.
- `--no-append-artifacts` – opt out of syncing every discovered artifact URL into the shared index.
- `--llama-model`, `--llama-endpoint`, `--disable-llama` – control the built-in Meta Llama 3 historical relevance check (defaults assume a local Ollama daemon running `llama3`).

Global source index helpers:

- Add URLs once via `npm run dev -- add-source https://example.org/archive/123`.
- Everyone shares the same `config/global-sources.json` (bundled in the downloadable ZIP) so random selection works across contributors.
- Each time the crawler discovers a new artifact URL it automatically appends it to the registry (unless disabled), so future nodes can grab it via `--random-global` without manual curation.

Prefer not to build locally? Download `downloads/histograph-node.zip` (served on the GitHub Pages site) and run `node cli/index.js` from the unzipped folder; it now ships with the compiled CLI, production `node_modules` (cheerio/commander/zod already installed), and the `setup-llama.sh` helper so you can trigger `ollama pull llama3` with one command.

See `node/README.md` for additional options, packaging, and roadmap items. When you do need to rebuild the downloadable archive locally, run `./scripts/build_download.sh` to compile the CLI, sync configs, and regenerate `downloads/histograph-node.zip` automatically.

## Live Atlas Data (Cloudflare Worker)

- `worker-atlas/` contains a lightweight Worker that persists sources/artifacts in KV and exposes `/api/atlas`, `/api/artifacts`, and `/api/sources`. Follow its README to bind KV namespaces (`ATLAS_SOURCES`, `ATLAS_ARTIFACTS`), set `ATLAS_API_KEY`, and deploy via `npm run deploy`.
- Ship the Worker URL to the static site by either updating `<html data-atlas-endpoint>` in `index.html` or editing `config/atlas-config.json`. The frontend now loads that file automatically and falls back to `config/atlas-index.json` (plus the inline seed data) if the Worker is unreachable.
- Give node operators the Worker URL and bearer key. They can export `ATLAS_API_URL` / `ATLAS_API_KEY` or pass `--atlas-url` / `--atlas-key` to mirror every accepted discovery back to the Worker.
- Regenerate the static snapshot at any time with `./scripts/pull_atlas_snapshot.sh https://worker-atlas.<subdomain>.workers.dev/api/atlas`, which overwrites `config/atlas-index.json` for offline demos.
- Use Cloudflare’s dashboard (Workers → `worker-atlas`) to tail logs, watch KV sizes, and confirm inbound submissions.

---

## Contributing

- Fork the repository and create a feature branch.
- Follow the **PEP‑8** style guide and run `ruff`/`black` before committing.
- Write unit tests for any new logic (especially the genetic algorithm).
- Submit a pull request; CI will automatically build Docker images and run tests.

---

## License

MIT License – see `LICENSE` file.

---

*Happy mining!*

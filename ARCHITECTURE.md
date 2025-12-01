# HistoCoin Distributed Auto‑Miner Architecture

> **TL;DR** – The system consists of a **FastAPI master server** that stores a global master index in PostgreSQL, and **headless nodes** that run the same scraper code, use their local compute to generate AI descriptions, and report results back to the master. The master aggregates contributions from many nodes in a `bubbles` JSON column.

---

## Table of Contents
1. [Key Components](#key-components)
2. [Data Flow Overview](#data-flow-overview)
3. [Node vs. Master Roles](#node-vs-master-roles)
4. [Database Schema Changes](#database-schema-changes)
5. [API Endpoints](#api-endpoints)
6. [Running the System](#running-the-system)
7. [How the UI Works](#how-the-ui-works)
8. [Future Extensions](#future-extensions)

---

## Key Components

| Component | Responsibility |
|-----------|----------------|
| **FastAPI Master** (`backend/app/main.py`) | Exposes HTTP endpoints, holds the **master index** (PostgreSQL), stores artifacts and bubbles, serves the frontend UI. |
| **Database Models** (`backend/app/models.py`) | `Source` – URLs to crawl. `Artifact` – saved results. New `bubbles` column stores a JSON list of node contributions. |
| **Auto‑Miner Scraper** (`run_scraper` function) | Loops over all `Source`s, fetches pages, runs the Ollama AI to generate a description, saves an `Artifact`. In auto‑miner mode it repeats forever with a 10 s cooldown. |
| **Node Mode** (environment variable `NODE_MODE=true`) | The same code runs headlessly. After each source is processed it **POSTs** a payload to the master’s `/master/ingest` endpoint, adding its result as a bubble. |
| **Frontend UI** (`databasecollector.html`) | Shows total artifact count, current crawl status, and start/stop controls. Uses `/stats` for the true count and `/artifacts` for the latest 50 items. |

---

## Data Flow Overview

1. **User clicks “Start Miner”** → UI calls `POST /scrape/start`.
2. `scrape_start` sets `SCRAPER_STATE["auto_miner"] = True` and launches `run_scraper` in a background task.
3. `run_scraper` loads all `Source`s and enters an infinite loop (breaks when `auto_miner` becomes `False`).
4. For each source:
   - Updates `SCRAPER_STATE` → UI shows “Running – *source name*”.
   - Calls `process_met_object` or `process_generic_url` → fetches data, runs `enrich_with_ai`, stores an `Artifact`.
   - **If `NODE_MODE` is true**:
     ```json
     {
       "url": "<source.base_url>",
       "content": "<generated description>",
       "node_id": "<NODE_ID>"
     }
     ```
     is POSTed to `/master/ingest`.
5. **Master `/master/ingest`**:
   - Looks up an existing `Artifact` by `url`.
   - If found → loads `bubbles` (creates `[]` if missing), appends the new `{node_id, content}` entry, and writes back.
   - If not found → creates a new `Artifact` with the supplied `content` and an initial `bubbles` list.
6. After all sources are processed, `run_scraper` sets state to **Cooling down…**, sleeps 10 seconds, then repeats.
7. **User clicks “Stop Miner”** → UI calls `POST /scrape/stop`, which flips `SCRAPER_STATE["auto_miner"]` to `False`. The next loop iteration exits and state resets to **Idle**.

---

## Node vs. Master Roles

| Environment Variable | Role | Behaviour |
|----------------------|------|-----------|
| `NODE_MODE=false` (default) | **Master** | Serves API, stores data, provides UI. No outbound POSTs to `/master/ingest`. |
| `NODE_MODE=true` | **Node** | Runs the scraper continuously, **after each artifact** sends a POST to the master. Uses `NODE_ID` to identify itself and `MASTER_URL` to know where to send data. |

**Starting a node locally for testing**:
```bash
NODE_MODE=true \
NODE_ID=$(uuidgen) \
MASTER_URL=http://localhost:8000 \
# Run the same Docker image that hosts the API
docker compose run --rm api
```
The same container image is used; the environment variables decide the role.

---

## Database Schema Changes

```python
class Artifact(Base):
    __tablename__ = "artifacts"
    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=False)
    title = Column(String(400), nullable=False)
    description = Column(Text, nullable=True)
    metadata_json = Column(JSONB, nullable=True)   # raw metadata from the source
    image_url = Column(String(1000), nullable=True)
    # NEW: list of node contributions
    bubbles = Column(JSONB, nullable=True)        # [{"node_id": "...", "content": "..."}, ...]
    source = relationship("Source", back_populates="artifacts")
```
- `bubbles` stores a JSON array; each element records which node added what content.
- If you are using SQLite, `JSONB` falls back to `Text` and you must manually serialize/deserialize JSON strings.

---

## API Endpoints (relevant to the distributed flow)

| Method | Path | Purpose |
|--------|------|---------|
| `GET /status` | Returns the current `SCRAPER_STATE` (Idle, Running, Cooling down…). |
| `POST /scrape/start` | Starts the auto‑miner; sets `auto_miner` flag. |
| `POST /scrape/stop` | Clears the `auto_miner` flag, causing the loop to exit. |
| `GET /artifacts?limit=50` | Returns the newest 50 artifacts (ordered by `id DESC`). |
| `GET /stats` | **New** – returns `{ "artifact_count": <total rows> }`. Used by the UI for the correct total count. |
| `POST /master/ingest` | **Node‑only** – receives `{url, content, node_id}` and either creates a new artifact or appends a bubble to an existing one. |

---

## Running the System

1. **Create a cloud PostgreSQL database** (Supabase, Railway, etc.) and set `DATABASE_URL` in `.env` or `docker-compose.yml`.
2. **Start the master** (development):
   ```bash
   docker compose up -d db api
   # API will be reachable at http://localhost:8000
   ```
3. **Start a node** (on the same machine or another host):
   ```bash
   NODE_MODE=true \
   NODE_ID=$(uuidgen) \
   MASTER_URL=http://<master-host>:8000 \
   docker compose run --rm api
   ```
   The node will begin scraping automatically (auto‑miner mode) and report its results to the master.
4. **Interact via the UI** (`http://localhost:8000` serves `databasecollector.html`). Use the **Start Miner** / **Stop Miner** buttons to control the master’s own scraper.
5. **Check the master index** – open the UI or query `/stats` and `/artifacts` directly.

---

## How the UI Shows the Correct Artifact Count

- The UI now fetches `/stats` to obtain `artifact_count`, which is a `SELECT COUNT(*) FROM artifacts` query. This number reflects **all** rows, not just the 50‑item page limit.
- The previous approach (counting the length of the `/artifacts` response) was capped at 50, causing the displayed total to appear stuck. The new endpoint resolves that.

---

## Future Extensions

- **Authentication for nodes** – generate an API key per node and require it in the `Authorization` header of `/master/ingest`.
- **Genetic Neural Net** – replace the placeholder AI call with a custom evolutionary model that improves over time (see the `backend/app/neural_net.py` scaffold).
- **Migration tooling** – add Alembic scripts to handle the `bubbles` column addition automatically.
- **Metrics & Monitoring** – expose Prometheus metrics for scraper latency, node contributions, etc.

---

*Happy mining!*

import os
import json
import random
import asyncio
from typing import Optional, List

import aiohttp
from bs4 import BeautifulSoup
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
import os
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.database import AsyncSessionLocal, engine, Base  # keep your existing database.py
from app.models import Source, Artifact
from app.schemas import SourceCreate, SourceOut

app = FastAPI()

# Determine if this instance runs as a node (headless) or as the master server
NODE_MODE = os.getenv("NODE_MODE", "false").lower() == "true"


SCRAPER_STATE = {
    "status": "Idle",
    "current_source": None,
    "auto_miner": False
}

def update_state(status: str, source: str | None = None):
    SCRAPER_STATE["status"] = status
    SCRAPER_STATE["current_source"] = source

# ---- CORS (dev-friendly; tighten for prod) ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://histocoin.example.com",  # production UI (if served from same domain)
        "https://simonwartout.github.io",  # GitHub Pages user site
        "https://simonwartout.github.io/HistoCoinProjectOfficial",  # repo pages
        "http://localhost:8000",  # local dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Shared HTTP session ----
@app.on_event("startup")
async def _startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    connector = aiohttp.TCPConnector(limit=8, ttl_dns_cache=300)
    timeout = aiohttp.ClientTimeout(total=300, connect=10, sock_connect=10, sock_read=300)
    app.state.http = aiohttp.ClientSession(connector=connector, timeout=timeout)

@app.on_event("shutdown")
async def _shutdown():
    if getattr(app.state, "http", None):
        await app.state.http.close()

@app.get("/status")
async def status():
    return SCRAPER_STATE

# Endpoint for master to ingest artifacts from nodes
+@app.post("/master/ingest")
+async def ingest_artifact(request: Request):
+    """Receive artifact data from a node and store or update the master index.
+    Expected JSON: {"url": str, "content": str, "node_id": str}
+    """
+    data = await request.json()
+    url = data.get("url")
+    content = data.get("content")
+    node_id = data.get("node_id")
+    if not url or not content or not node_id:
+        raise HTTPException(status_code=400, detail="Missing fields")
+    # Use the existing Artifact table as the master index
+    async with AsyncSessionLocal() as db:
+        # Check if artifact already exists
+        res = await db.execute(select(Artifact).where(Artifact.url == url))
+        existing = res.scalars().first()
+        if existing:
+            # Append a bubble (simple JSON list stored in a text column)
+            if not existing.bubbles:
+                existing.bubbles = "[]"
+            import json
+            bubbles = json.loads(existing.bubbles)
+            bubbles.append({"node_id": node_id, "content": content})
+            existing.bubbles = json.dumps(bubbles)
+            db.add(existing)
+        else:
+            # Create new artifact entry
+            new_art = Artifact(url=url, content=content, bubbles=json.dumps([{"node_id": node_id, "content": content}]))
+            db.add(new_art)
+        await db.commit()
+    return {"status": "ok"}


@app.get("/stats")
async def stats():
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(Artifact))
        return {"artifact_count": count}

@app.get("/artifacts")
async def list_artifacts(limit: int = 50) -> List[dict]:
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Artifact).order_by(Artifact.id.desc()).limit(limit))
        rows = res.scalars().all()
        return [
            {
                "id": a.id,
                "title": a.title,
                "description": a.description,
                "image_url": a.image_url,
            }
            for a in rows
        ]

# ---------- Sources API ----------
async def _normalize_url(raw: str) -> str:
    from urllib.parse import urlsplit, urlunsplit
    p = urlsplit(raw)
    if not p.scheme:
        raw = "https://" + raw
        p = urlsplit(raw)
    netloc = p.netloc.lower()
    path = p.path or "/"
    return urlunsplit((p.scheme, netloc, path.rstrip("/") or "/", p.query, ""))

async def _check_reachable(session: aiohttp.ClientSession, url: str) -> tuple[bool, str]:
    try:
        async with session.head(url, allow_redirects=True) as r:
            if 200 <= r.status < 400:
                return True, f"HEAD {r.status}"
    except Exception:
        pass
    try:
        async with session.get(url, allow_redirects=True) as r:
            if 200 <= r.status < 400:
                return True, f"GET {r.status}"
            return False, f"GET {r.status}"
    except Exception as e:
        return False, f"error: {type(e).__name__}: {e}"

@app.post("/sources", response_model=SourceOut, status_code=201)
async def create_source(payload: SourceCreate):
    base_url = payload.base_url  # normalized by schema
    http: aiohttp.ClientSession = app.state.http

    ok, note = await _check_reachable(http, base_url)
    if not ok:
        # warn but still allow insert so you can add protected URLs
        print(f"⚠️ Source reachability warning for {base_url}: {note}")

    async with AsyncSessionLocal() as db:
        src = Source(name=payload.name.strip(), base_url=base_url)
        db.add(src)
        try:
            await db.commit()
            await db.refresh(src)
            return src
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "A source with this base_url already exists")
        except Exception as e:
            await db.rollback()
            raise HTTPException(500, f"DB error: {type(e).__name__}: {e}")

@app.get("/sources", response_model=list[SourceOut])
async def list_sources():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Source).order_by(Source.id.desc()))
        return res.scalars().all()

@app.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: int):
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Source).where(Source.id == source_id))
        source = res.scalar_one_or_none()
        if not source:
            raise HTTPException(404, "Source not found")
        await db.delete(source)
        await db.commit()

# ---------- Scraper ----------
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

async def fetch_text(session: aiohttp.ClientSession, url: str):
    try:
        async with session.get(url) as r:
            if r.status == 200:
                return await r.text()
            print(f"⚠️ fetch_text non-200 {r.status} for {url}")
    except Exception as e:
        print(f"❌ fetch_text error for {url}: {type(e).__name__}: {e}")
    return None

async def fetch_json(session: aiohttp.ClientSession, url: str):
    try:
        async with session.get(url) as r:
            if r.status == 200:
                return await r.json()
            print(f"⚠️ fetch_json non-200 {r.status} for {url}")
    except Exception as e:
        print(f"❌ fetch_json error for {url}: {type(e).__name__}: {e}")
    return None

def generate_fallback_summary(metadata: dict) -> str:
    culture = metadata.get('culture', 'Unknown Culture')
    period = metadata.get('period', 'Unknown Era')
    medium = metadata.get('medium', 'mixed media')
    title = metadata.get('title', 'Artifact')
    return (
        f"A historical {title} originating from the {culture} during the {period}. "
        f"This artifact is crafted primarily from {medium}."
    )

async def enrich_with_ai(metadata: dict, context_text: str | None = None):
    if context_text:
        prompt = f"""
        Analyze this website text and extract a historical artifact. 
        Return ONLY valid JSON with keys: title, description, culture, period, medium.
        If no clear artifact is found, return empty JSON {{}}.

        TEXT:
        {context_text[:2000]}
        """
    else:
        prompt = f"""
        Summarize this historical artifact in 2 sentences based strictly on its metadata. 
        Focus ONLY on materials, function, dimensions, and specific cultural origins. 
        Do NOT use phrases like "testament to", "art style of its time", "showcases the skill", or "beautifully crafted". 
        Be clinical, archaeological, and precise.

        Metadata: {json.dumps(metadata)}
        """

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json" if context_text else None
    }

    urls = [
        f"{OLLAMA_HOST}/api/generate",
        "http://host.docker.internal:11434/api/generate",
        "http://localhost:11434/api/generate",
        "http://172.17.0.1:11434/api/generate",
        "http://127.0.0.1:11434/api/generate",
    ]
    session: aiohttp.ClientSession = app.state.http
    for url in urls:
        try:
            async with session.post(url, json=payload) as r:
                if r.status == 200:
                    result = await r.json()
                    text = result.get("response", "") or ""
                    if context_text:
                        try:
                            return json.loads(text) if text else {}
                        except Exception as je:
                            print(f"⚠️ JSON parse failed from AI at {url}: {je}")
                            return {}
                    return text or generate_fallback_summary(metadata)
                print(f"⚠️ Ollama non-200 {r.status} from {url}")
        except Exception as e:
            print(f"❌ Ollama POST failed for {url}: {type(e).__name__}: {e}")
            continue
    print("⚠️ AI Service Unreachable: Using local template description instead.")
    return {} if context_text else generate_fallback_summary(metadata)

async def process_met_object(http: aiohttp.ClientSession, object_id: int, source_id: int):
    url = f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}"
    data = await fetch_json(http, url)
    if not data or not data.get("isPublicDomain"):
        return

    title = data.get("title", "Unknown Artifact")
    image_url = data.get("primaryImage")
    if not image_url:
        return

    async with AsyncSessionLocal() as db:
        try:
            res = await db.execute(select(Artifact).where(
                Artifact.source_id == source_id,
                Artifact.title == title
            ))
            if res.scalar_one_or_none():
                print(f"Skipping duplicate: {title}")
                return

            description = await enrich_with_ai({
                "title": title,
                "period": data.get("period"),
                "culture": data.get("culture"),
                "medium": data.get("medium"),
                "dimensions": data.get("dimensions")
            })

            artifact = Artifact(
                source_id=source_id,
                title=title,
                description=description,
                metadata_json=data,
                image_url=image_url
            )
            db.add(artifact)
            await db.commit()
            print(f"✅ Saved artifact: {title}")
        except Exception as e:
            await db.rollback()
            print(f"❌ Error saving artifact {title}: {type(e).__name__}: {e}")

async def process_generic_url(http: aiohttp.ClientSession, source: Source):
    print(f"Generic Scraping: {source.base_url}")
    html = await fetch_text(http, source.base_url)
    if not html:
        return

    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.extract()
    text = soup.get_text(separator=' ', strip=True)

    extracted = await enrich_with_ai({}, context_text=text)
    
    # Fallback if AI fails
    if not extracted or not extracted.get("title"):
        print(f"⚠️ AI failed to extract artifact from {source.base_url}, trying fallback...")
        title_tag = soup.find("title")
        fallback_title = title_tag.get_text().strip() if title_tag else "Unknown Artifact"
        extracted = {
            "title": fallback_title,
            "description": "Auto-extracted from webpage (AI unavailable).",
            "culture": "Unknown",
            "period": "Unknown",
            "medium": "Unknown"
        }

    image_url = None
    og_image = soup.find("meta", property="og:image")
    if og_image and og_image.get("content"):
        image_url = og_image["content"]
    if not image_url:
        from urllib.parse import urljoin
        for img in soup.find_all('img'):
            src = img.get('src')
            if src and 'icon' not in (src or "").lower():
                image_url = urljoin(source.base_url, src) if not src.startswith('http') else src
                break

    async with AsyncSessionLocal() as db:
        try:
            res = await db.execute(select(Artifact).where(
                Artifact.source_id == source.id,
                Artifact.title == extracted["title"]
            ))
            if res.scalar_one_or_none():
                print(f"Skipping duplicate: {extracted['title']}")
                return

            artifact = Artifact(
                source_id=source.id,
                title=extracted.get("title"),
                description=extracted.get("description", "No description"),
                metadata_json=extracted,
                image_url=image_url
            )
            db.add(artifact)
            await db.commit()
            print(f"✅ Saved generic artifact: {extracted.get('title')}")
        except Exception as e:
            await db.rollback()
            print(f"❌ Error saving generic artifact: {type(e).__name__}: {e}")

async def run_scraper(status_callback=None, target_source_id: Optional[int] = None):
    print("Starting scraper...")
    update_state("Starting", "Initializing")
    if status_callback:
        status_callback({"status": "Starting", "current_source": "Initializing"})

    async with AsyncSessionLocal() as db:
        if target_source_id:
            res = await db.execute(select(Source).where(Source.id == target_source_id))
        else:
            res = await db.execute(select(Source))
        sources = res.scalars().all()

    try:
        http: aiohttp.ClientSession = app.state.http
        while True:
            # If manual run (target_source_id set), run once and break
            # If auto run, check flag
            if not target_source_id and not SCRAPER_STATE.get("auto_miner"):
                break

            for source in sources:
                if not target_source_id and not SCRAPER_STATE.get("auto_miner"):
                    break # Stop mid-loop if requested

                update_state("Running", source.name)
                if status_callback:
                    status_callback({"status": "Running", "current_source": source.name})
                
                processed_content = None # Variable to hold content for master ingest
                try:
                    base = (source.base_url or "").lower()
                    if "metmuseum" in base:
                        search_url = "https://collectionapi.metmuseum.org/public/collection/v1/search?q=ancient&hasImages=true"
                        data = await fetch_json(http, search_url)
                        if data and data.get("objectIDs"):
                            ids = data["objectIDs"]
                            pick = random.sample(ids, min(3, len(ids)))
                            for oid in pick:
                                # process_met_object handles saving to local DB
                                await process_met_object(http, oid, source.id)
                            processed_content = {"met_object_ids": pick, "source_url": source.base_url} # Example content
                    else:
                        await process_generic_url(http, source)
                except Exception as e:
                    print(f"❌ Source loop error for {source.name}: {type(e).__name__}: {e}")
            
            if target_source_id:
                break # Manual run finishes after one pass
            
            # Cooldown for auto-miner
            update_state("Cooling down...", None)
            await asyncio.sleep(10) # 10s delay between cycles
    finally:
        update_state("Idle", None)
        if status_callback:
            status_callback({"status": "Idle", "current_source": None})
        print("Scraper finished.")

@app.post("/scrape/start")
async def scrape_start(background: BackgroundTasks, source_id: Optional[int] = None):
    if SCRAPER_STATE["status"] != "Idle":
         return {"ok": False, "message": "Scraper already running"}
    
    SCRAPER_STATE["auto_miner"] = True if not source_id else False
    background.add_task(run_scraper, target_source_id=source_id)
    return {"ok": True, "started": True, "source_id": source_id}

@app.post("/scrape/stop")
async def scrape_stop():
    SCRAPER_STATE["auto_miner"] = False
    return {"ok": True, "message": "Stopping scraper..."}

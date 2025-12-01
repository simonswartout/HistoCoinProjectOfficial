# scraper.py

import os
import json
import random
import asyncio
import aiohttp
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from bs4 import BeautifulSoup  # Required for generic scraping

# Prefer app.* but allow running from repo root
try:
    from app.database import AsyncSessionLocal
    from app.models import Source, Artifact
except ImportError:
    from database import AsyncSessionLocal
    from models import Source, Artifact

# ----------------------------
# Configuration
# ----------------------------
# DOCKER NOTE:
# - If Ollama runs on the host (Linux), ensure the container is started with:
#   --add-host=host.docker.internal:host-gateway
#   and set OLLAMA_HOST=http://host.docker.internal:11434
# - If Ollama runs as a sibling container, set OLLAMA_HOST=http://ollama:11434
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# Network hygiene: reuse a session, limit sockets, and set explicit timeouts.
HTTP_CONNECTOR_LIMIT = int(os.getenv("HTTP_CONNECTOR_LIMIT", "8"))
HTTP_TIMEOUT = aiohttp.ClientTimeout(
    total=60,       # overall cap
    connect=3,      # DNS + TCP connect
    sock_connect=3, # TCP handshake
    sock_read=55    # time to receive body
)

# Concurrency cap for external I/O (Met API + AI calls + DB writes)
SCRAPE_CONCURRENCY = int(os.getenv("SCRAPE_CONCURRENCY", "4"))

# ----------------------------
# Helpers
# ----------------------------

async def fetch_text(session: aiohttp.ClientSession, url: str):
    """Fetch raw HTML text for generic scraping."""
    try:
        async with session.get(url) as response:
            if response.status == 200:
                return await response.text()
            print(f"⚠️ fetch_text non-200 {response.status} for {url}")
    except Exception as e:
        print(f"❌ fetch_text error for {url}: {type(e).__name__}: {e}")
    return None

async def fetch_json(session: aiohttp.ClientSession, url: str):
    """Fetch JSON for API scraping."""
    try:
        async with session.get(url) as response:
            if response.status == 200:
                return await response.json()
            print(f"⚠️ fetch_json non-200 {response.status} for {url}")
    except Exception as e:
        print(f"❌ fetch_json error for {url}: {type(e).__name__}: {e}")
    return None

def generate_fallback_summary(metadata: dict) -> str:
    """Local non-AI summary—keeps app functional when AI is unavailable."""
    culture = metadata.get('culture', 'Unknown Culture')
    period = metadata.get('period', 'Unknown Era')
    medium = metadata.get('medium', 'mixed media')
    title = metadata.get('title', 'Artifact')
    return (
        f"A historical {title} originating from the {culture} during the {period}. "
        f"This artifact is crafted primarily from {medium}."
    )

# ----------------------------
# AI enrichment
# ----------------------------

async def enrich_with_ai(
    metadata: dict,
    context_text: str | None = None,
    session: aiohttp.ClientSession | None = None
):
    """
    Sends metadata or page text to Ollama to generate a summary or extract JSON.
    Uses a shared aiohttp session if provided; otherwise creates a constrained one.
    Includes robust fallbacks and logging.
    """
    if context_text:
        # GENERIC SCRAPING MODE (force JSON return)
        prompt = f"""
        Analyze this website text and extract a historical artifact.
        Return ONLY valid JSON with keys: title, description, culture, period, medium.
        If no clear artifact is found, return empty JSON {{}}.

        TEXT:
        {context_text[:2000]}
        """
    else:
        # ENRICHMENT MODE (precise, no fluff)
        prompt = f"""
        Summarize this historical artifact in 2 sentences based strictly on its metadata.
        Focus ONLY on materials, function, dimensions, and specific cultural origins.
        Do NOT use phrases like "testament to", "art style of its time",
        "showcases the skill", or "beautifully crafted".
        Be clinical, archaeological, and precise.

        Metadata: {json.dumps(metadata)}
        """

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json" if context_text else None
    }

    urls_to_try = [
        f"{OLLAMA_HOST}/api/generate",                 # Provided host
        "http://host.docker.internal:11434/api/generate",
        "http://localhost:11434/api/generate",
        "http://172.17.0.1:11434/api/generate",
        "http://127.0.0.1:11434/api/generate",
    ]

    owns_session = False
    if session is None:
        connector = aiohttp.TCPConnector(limit=4, ttl_dns_cache=300)
        session = aiohttp.ClientSession(connector=connector, timeout=HTTP_TIMEOUT)
        owns_session = True

    try:
        for url in urls_to_try:
            try:
                async with session.post(url, json=payload) as response:
                    if response.status == 200:
                        result = await response.json()
                        response_text = result.get("response", "")
                        if context_text:
                            try:
                                return json.loads(response_text) if response_text else {}
                            except Exception as je:
                                print(f"⚠️ JSON parse failed from AI at {url}: {je}")
                                return {}
                        return response_text or generate_fallback_summary(metadata)
                    print(f"⚠️ Ollama non-200 {response.status} from {url}")
            except Exception as e:
                print(f"❌ Ollama POST failed for {url}: {type(e).__name__}: {e}")
                continue
    finally:
        if owns_session:
            await session.close()

    print("⚠️ AI Service Unreachable: Using local template description instead.")
    if context_text:
        return {}
    return generate_fallback_summary(metadata)

# ----------------------------
# Per-source processors
# ----------------------------

async def process_met_object(
    http_session: aiohttp.ClientSession,
    object_id: int,
    source_id: int
):
    """Process a single Met object ID (only CC0 with primary image)."""
    url = f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}"
    data = await fetch_json(http_session, url)
    if not data:
        return

    if not data.get("isPublicDomain"):
        return

    title = data.get("title", "Unknown Artifact")
    image_url = data.get("primaryImage")
    if not image_url:
        return

    async with AsyncSessionLocal() as db_session:
        try:
            # Deduplication by (source_id, title)
            stmt = select(Artifact).where(
                Artifact.source_id == source_id,
                Artifact.title == title
            )
            result = await db_session.execute(stmt)
            if result.scalar_one_or_none():
                print(f"Skipping duplicate: {title}")
                return

            print(f"Processing: {title} (Met #{object_id})")

            description = await enrich_with_ai(
                {
                    "title": title,
                    "period": data.get("period"),
                    "culture": data.get("culture"),
                    "medium": data.get("medium"),
                    "dimensions": data.get("dimensions")
                },
                session=http_session
            )

            artifact = Artifact(
                source_id=source_id,
                title=title,
                description=description,
                metadata_json=data,
                image_url=image_url
            )
            db_session.add(artifact)

            await db_session.commit()
            print(f"✅ Saved artifact: {title}")

        except Exception as e:
            await db_session.rollback()
            print(f"❌ Error saving artifact {title}: {type(e).__name__}: {e}")

async def process_generic_url(
    http_session: aiohttp.ClientSession,
    source: Source
):
    """
    Fallback scraper for non-API sources.
    Fetch HTML -> Clean -> Ask AI to extract artifact data (JSON) -> Save.
    """
    print(f"Generic Scraping: {source.base_url}")
    html = await fetch_text(http_session, source.base_url)
    if not html:
        return

    # Clean obvious non-content blocks
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.extract()
    text = soup.get_text(separator=' ', strip=True)

    extracted = await enrich_with_ai({}, context_text=text, session=http_session)
    if not extracted or not extracted.get("title"):
        print(f"No artifact found by AI on {source.base_url}")
        return

    # Try to find an image (og:image first)
    image_url = None
    og_image = soup.find("meta", property="og:image")
    if og_image and og_image.get("content"):
        image_url = og_image["content"]

    if not image_url:
        # Fallback: first non-icon image
        from urllib.parse import urljoin
        for img in soup.find_all('img'):
            src = img.get('src')
            if src and 'icon' not in src.lower():
                image_url = urljoin(source.base_url, src) if not src.startswith('http') else src
                break

    async with AsyncSessionLocal() as db_session:
        try:
            stmt = select(Artifact).where(
                Artifact.source_id == source.id,
                Artifact.title == extracted["title"]
            )
            result = await db_session.execute(stmt)
            if result.scalar_one_or_none():
                print(f"Skipping duplicate: {extracted['title']}")
                return

            artifact = Artifact(
                source_id=source.id,
                title=extracted.get("title"),
                description=extracted.get("description", "No description"),
                metadata_json=extracted,
                image_url=image_url
            )
            db_session.add(artifact)
            await db_session.commit()
            print(f"✅ Saved generic artifact: {extracted.get('title')}")

        except Exception as e:
            await db_session.rollback()
            print(f"❌ Error saving generic artifact: {type(e).__name__}: {e}")

# ----------------------------
# Orchestrator
# ----------------------------

async def run_scraper(status_callback=None, target_source_id=None):
    """
    Scrape all configured sources.
    - Creates one shared ClientSession with connector/timeouts.
    - Limits concurrent work via a semaphore.
    - Never raises out of this function (so background task won't crash the process).
    """
    print("Starting scraper...")
    if status_callback:
        status_callback({"status": "Starting", "current_source": "Initializing"})

    # Fetch sources from DB
    async with AsyncSessionLocal() as db_session:
        try:
            if target_source_id:
                stmt = select(Source).where(Source.id == target_source_id)
            else:
                stmt = select(Source)
            result = await db_session.execute(stmt)
            sources = result.scalars().all()
        except Exception as e:
            print(f"❌ Failed to load sources: {type(e).__name__}: {e}")
            sources = []

    connector = aiohttp.TCPConnector(limit=HTTP_CONNECTOR_LIMIT, ttl_dns_cache=300)
    async with aiohttp.ClientSession(connector=connector, timeout=HTTP_TIMEOUT) as http_session:
        sem = asyncio.Semaphore(SCRAPE_CONCURRENCY)

        async def _guarded(coro):
            try:
                async with sem:
                    return await coro
            except Exception as e:
                print(f"❌ scrape task failed: {type(e).__name__}: {e}")
                return None

        for source in sources:
            if status_callback:
                status_callback({"status": "Running", "current_source": source.name})

            try:
                base = (source.base_url or "").lower()
                if "metmuseum" in base:
                    search_url = "https://collectionapi.metmuseum.org/public/collection/v1/search?q=ancient&hasImages=true"
                    search_data = await fetch_json(http_session, search_url)
                    if search_data and "objectIDs" in search_data and search_data["objectIDs"]:
                        all_ids = search_data["objectIDs"]
                        object_ids = random.sample(all_ids, min(3, len(all_ids)))

                        tasks = [
                            _guarded(process_met_object(http_session, oid, source.id))
                            for oid in object_ids
                        ]
                        # Don’t let a single failure crash the whole run
                        await asyncio.gather(*tasks, return_exceptions=True)
                else:
                    await _guarded(process_generic_url(http_session, source))

            except Exception as e:
                print(f"❌ Source loop error for {source.name}: {type(e).__name__}: {e}")

    if status_callback:
        status_callback({"status": "Idle", "current_source": None})
    print("Scraper finished.")

# Optional: local test entry point
if __name__ == "__main__":
    asyncio.run(run_scraper())

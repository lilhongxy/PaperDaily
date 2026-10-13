import asyncio
import re
import time
from datetime import datetime, timedelta, timezone

import feedparser
import httpx

API = "https://export.arxiv.org/api/query"
PAGE = 100
HEADERS = {"User-Agent": "DailyPaper/0.2 (local paper reader)"}
MIN_INTERVAL = 3.1  # arXiv asks for >= 3s between API requests

_lock = asyncio.Lock()
_last = 0.0


def _parse_entry(e) -> dict:
    raw_id = e.id.rsplit("/abs/", 1)[-1]
    pid = re.sub(r"v\d+$", "", raw_id)
    pdf = next((l.href for l in e.get("links", []) if l.get("type") == "application/pdf"), None)
    return {
        "id": pid,
        "title": " ".join(e.title.split()),
        "authors": [a.name for a in e.get("authors", [])],
        "abstract": " ".join(e.summary.split()),
        "categories": [t.term for t in e.get("tags", [])],
        "published": e.get("published", ""),
        "pdf_url": pdf or f"https://arxiv.org/pdf/{pid}",
        "abs_url": f"https://arxiv.org/abs/{pid}",
    }


async def _get(params: dict) -> list[dict]:
    """All arXiv calls go through one lock so concurrent jobs respect the rate limit."""
    global _last
    async with _lock:
        async with httpx.AsyncClient(timeout=60, headers=HEADERS, follow_redirects=True) as client:
            for attempt in range(3):
                wait = MIN_INTERVAL - (time.monotonic() - _last)
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    r = await client.get(API, params=params)
                    _last = time.monotonic()
                    if r.status_code in (429, 503):
                        await asyncio.sleep(5 * (attempt + 1))
                        continue
                    r.raise_for_status()
                    feed = feedparser.parse(r.text)
                    return [_parse_entry(e) for e in feed.entries if "/abs/" in e.get("id", "")]
                except httpx.HTTPError:
                    _last = time.monotonic()
                    if attempt == 2:
                        raise
                    await asyncio.sleep(3 * (attempt + 1))
    return []


def _dedupe(papers: list[dict]) -> list[dict]:
    seen, out = set(), []
    for p in papers:
        if p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out


def date_range(days: int | None = None, from_year: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    if days:
        start = now - timedelta(days=days)
    elif from_year:
        start = datetime(from_year, 1, 1, tzinfo=timezone.utc)
    else:
        return ""
    return f"submittedDate:[{start.strftime('%Y%m%d%H%M')} TO {now.strftime('%Y%m%d%H%M')}]"


def build_query(categories: list[str], keywords: list[str], days: int) -> str:
    q = []
    if categories:
        q.append("(" + " OR ".join(f"cat:{c}" for c in categories) + ")")
    if keywords:
        q.append("(" + " OR ".join(f'all:"{k}"' if " " in k else f"all:{k}" for k in keywords) + ")")
    q.append(date_range(days=days))
    return " AND ".join(q)


async def query(q: str, limit: int, sort: str = "submittedDate") -> list[dict]:
    out: list[dict] = []
    for start in range(0, limit, PAGE):
        batch = await _get({
            "search_query": q, "start": start, "max_results": min(PAGE, limit - start),
            "sortBy": sort, "sortOrder": "descending",
        })
        out.extend(batch)
        if len(batch) < min(PAGE, limit - start):
            break
    return _dedupe(out)


async def search(categories: list[str], keywords: list[str], days: int, limit: int) -> list[dict]:
    return await query(build_query(categories, keywords, days), limit)


def normalize_id(s: str) -> str:
    s = s.strip()
    m = re.search(r"arxiv\.org/(?:abs|pdf|html)/([^\s?#]+)", s)
    if m:
        s = m.group(1)
    s = re.sub(r"\.pdf$", "", s)
    return re.sub(r"v\d+$", "", s)


ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5})(?:v\d+)?")


async def fetch_by_ids(ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        out += await _get({"id_list": ",".join(chunk), "max_results": len(chunk)})
    return _dedupe(out)


async def fetch_by_id(arxiv_id: str) -> dict | None:
    res = await fetch_by_ids([arxiv_id])
    return res[0] if res else None


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", t.lower()).strip()


async def find_by_titles(titles: list[str]) -> dict[str, dict]:
    """Look up papers by (approximate) title, several titles per request. Returns {title: paper}."""
    import difflib

    found: dict[str, dict] = {}
    for i in range(0, len(titles), 6):
        chunk = titles[i:i + 6]
        parts = []
        for t in chunk:
            words = [w for w in _norm_title(t).split() if len(w) > 2][:8]
            if words:
                parts.append("(" + " AND ".join(f"ti:{w}" for w in words) + ")")
        if not parts:
            continue
        res = await _get({"search_query": " OR ".join(parts), "max_results": 30, "sortBy": "relevance"})
        for t in chunk:
            best, best_r = None, 0.0
            for p in res:
                r = difflib.SequenceMatcher(None, _norm_title(t), _norm_title(p["title"])).ratio()
                if r > best_r:
                    best, best_r = p, r
            if best and best_r >= 0.82:
                found[t] = best
    return found

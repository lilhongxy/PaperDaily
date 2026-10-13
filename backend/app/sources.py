"""External discovery sources: alphaXiv trending, Hacker News, Semantic Scholar recommendations."""

import asyncio
import re
from datetime import datetime, timezone

import httpx

UA = {"User-Agent": "Mozilla/5.0 DailyPaper/0.2"}
ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5})(?:v\d+)?")


async def alphaxiv_trending(interval_days: int = 7, sort: str = "Hot", limit: int = 100) -> list[dict]:
    """alphaXiv's community feed. Its heat tracks what people discuss on X closely."""
    interval = {3: "3 Days", 7: "7 Days", 30: "30 Days", 90: "90 Days"}.get(interval_days, "7 Days")
    out = []
    async with httpx.AsyncClient(timeout=30, headers=UA) as c:
        for page in range(0, (limit + 49) // 50):
            r = await c.get("https://api.alphaxiv.org/papers/v3/feed", params={
                "sort": sort, "interval": interval, "pageNum": str(page), "pageSize": "50"})
            r.raise_for_status()
            papers = r.json().get("papers", [])
            for p in papers:
                pid = p.get("universal_paper_id") or ""
                if not ARXIV_ID_RE.fullmatch(pid):
                    continue
                m = p.get("metrics") or {}
                out.append({
                    "id": pid,
                    "title": p.get("title", "").strip(),
                    "authors": p.get("authors") or [],
                    "abstract": " ".join((p.get("abstract") or "").split()),
                    "categories": [t for t in p.get("topics", []) if re.match(r"^[a-z\-]+\.[A-Z]{2}$", t)],
                    "published": p.get("publication_date") or "",
                    "pdf_url": f"https://arxiv.org/pdf/{pid}",
                    "abs_url": f"https://arxiv.org/abs/{pid}",
                    "source": "alphaxiv",
                    "buzz": {
                        "views": (m.get("visits_count") or {}).get("last_7_days") or 0,
                        "votes": m.get("public_total_votes") or 0,
                        "stars": p.get("github_stars") or 0,
                        "topics": [t for t in p.get("topics", []) if "-" in t or t.islower()][:6],
                        "blurb": p.get("feed_description") or "",
                        "thumb": p.get("image_url"),
                    },
                })
            if len(papers) < 50:
                break
    return out[:limit]


async def hn_arxiv(days: int = 7, min_points: int = 15) -> list[dict]:
    """Hacker News stories linking to arXiv in the window."""
    since = int(datetime.now(timezone.utc).timestamp()) - days * 86400
    async with httpx.AsyncClient(timeout=30, headers=UA) as c:
        r = await c.get("https://hn.algolia.com/api/v1/search", params={
            "query": "arxiv.org", "restrictSearchableAttributes": "url", "tags": "story",
            "numericFilters": f"points>{min_points},created_at_i>{since}", "hitsPerPage": 60})
        r.raise_for_status()
        hits = r.json().get("hits", [])
    out = []
    for h in hits:
        m = ARXIV_ID_RE.search(h.get("url") or "")
        if not m or "arxiv.org" not in (h.get("url") or ""):
            continue
        out.append({"id": m.group(1), "hn": {
            "points": h.get("points") or 0, "comments": h.get("num_comments") or 0,
            "title": h.get("title"), "url": f"https://news.ycombinator.com/item?id={h.get('objectID')}"}})
    return out


async def s2_recommendations(arxiv_id: str, limit: int = 20) -> list[dict]:
    """Semantic Scholar paper-to-paper recommendations (works without an API key)."""
    async with httpx.AsyncClient(timeout=30, headers=UA) as c:
        for attempt in range(3):
            r = await c.get(f"https://api.semanticscholar.org/recommendations/v1/papers/forpaper/arXiv:{arxiv_id}",
                            params={"limit": limit, "fields": "title,year,externalIds,abstract,authors"})
            if r.status_code == 429:
                await asyncio.sleep(2 + attempt * 3)
                continue
            if r.status_code == 404:
                return []
            r.raise_for_status()
            break
        else:
            return []
    out = []
    for p in r.json().get("recommendedPapers", []):
        aid = (p.get("externalIds") or {}).get("ArXiv")
        if aid:
            out.append({"id": aid, "title": p.get("title", ""), "year": p.get("year")})
    return out

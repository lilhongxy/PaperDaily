"""Related papers for the reader: S2 recommendations + AI-generated arXiv queries, ranked by AI."""

import asyncio
import json
import time

from .. import arxiv, llm, sources
from ..db import db, library_ids, upsert_paper

RELATED_SYSTEM = """你是一位熟悉文献的研究者。根据给定论文，生成 3-5 个 arXiv API 检索式，用于查找与它最相关的工作（前置工作、同类方法、后续改进、竞争方案）。
语法示例：ti:"diffusion model"、abs:"retrieval augmented" AND cat:cs.LG
同时列出你确信存在的 3-8 篇最相关的经典/重要论文的英文原标题。
严格只输出 JSON：{"queries": ["..."], "known": ["..."]}"""

RANK_SYSTEM = """给定一篇"当前论文"和若干候选论文，选出与当前论文最相关、最值得用户延伸阅读的论文（最多 {n} 篇）。
对每篇给出 relation（中文 2-6 字，例如"前置工作""同类方法""后续改进""竞争方案""理论分析""应用"）和 why（一句中文，不超过 40 字，说明与当前论文的关系）。
严格只输出 JSON 数组：[{{"id": "...", "relation": "...", "why": "..."}}]"""


async def find_related(paper: dict, model: str, refresh: bool = False, n: int = 15) -> list[dict]:
    if not refresh:
        with db() as conn:
            row = conn.execute("SELECT items FROM related_cache WHERE paper_id = ?", (paper["id"],)).fetchone()
        if row:
            return _decorate(json.loads(row["items"]))

    plan_task = llm.complete(
        model, RELATED_SYSTEM,
        [{"role": "user", "content": f"标题：{paper['title']}\n摘要：{paper['abstract']}"}], max_tokens=3000)
    s2_task = sources.s2_recommendations(paper["id"], 25)
    plan_text, s2 = await asyncio.gather(plan_task, s2_task, return_exceptions=True)

    pool: dict[str, dict] = {}
    if not isinstance(s2, Exception) and s2:
        for p in await arxiv.fetch_by_ids([x["id"] for x in s2]):
            pool[p["id"]] = p
    if not isinstance(plan_text, Exception):
        try:
            plan = llm.extract_json(plan_text)
        except Exception:  # noqa: BLE001
            plan = {}
        if plan.get("known"):
            pool.update({p["id"]: p for p in (await arxiv.find_by_titles(plan["known"])).values()})
        for q in plan.get("queries", [])[:5]:
            try:
                for p in await arxiv.query(q, 15, sort="relevance"):
                    pool.setdefault(p["id"], p)
            except Exception:  # noqa: BLE001
                continue
    elif not pool:
        raise plan_text
    pool.pop(paper["id"], None)
    if not pool:
        return []

    cands = list(pool.values())
    text = await llm.complete(
        model, RANK_SYSTEM.format(n=n),
        [{"role": "user", "content": f"当前论文：\n标题：{paper['title']}\n摘要：{paper['abstract'][:1500]}\n\n候选论文：\n\n" +
          "\n\n".join(f"id: {p['id']}（{p['published'][:4]}）\n标题: {p['title']}\n摘要: {p['abstract'][:400]}" for p in cands)}],
        max_tokens=8000)
    items = []
    for it in llm.extract_json(text):
        p = pool.get(str(it.get("id")))
        if p:
            upsert_paper(p, status="pool", source="related")
            items.append({"id": p["id"], "relation": it.get("relation", ""), "why": it.get("why", "")})
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO related_cache(paper_id, items, created_at) VALUES(?,?,?)",
                     (paper["id"], json.dumps(items, ensure_ascii=False), time.time()))
    return _decorate(items)


def _decorate(items: list[dict]) -> list[dict]:
    ids = [i["id"] for i in items]
    if not ids:
        return []
    with db() as conn:
        rows = {r["id"]: r for r in conn.execute(
            f"SELECT id, title, authors, published, abstract, status, reaction FROM papers WHERE id IN ({','.join('?' * len(ids))})",
            ids).fetchall()}
    lib = library_ids()
    out = []
    for it in items:
        r = rows.get(it["id"])
        if r:
            out.append({**it, "title": r["title"], "authors": json.loads(r["authors"])[:4], "year": r["published"][:4],
                        "abstract": r["abstract"], "status": r["status"], "in_library": r["id"] in lib})
    return out

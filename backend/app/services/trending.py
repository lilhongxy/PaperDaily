"""Community trending: alphaXiv heat + Hacker News → AI filter by interest → topic briefing."""

import asyncio
import json
import math
import time

from .. import arxiv, llm, sources
from ..db import db, upsert_paper
from .common import Job, digest_papers, interest_block, score_papers

job = Job("trending")

TOPIC_SYSTEM = """你是一位敏锐的 AI 研究趋势观察者。根据给出的本期社区热门论文（附热度数据），结合用户研究兴趣，归纳 3-5 个"正在升温的研究话题"。
要求：
- 每个话题要具体（例如"扩散模型的少步采样"而不是"模型架构"），优先与用户兴趣相关的话题，但也可以包含一个领域内的现象级热点
- summary：2-3 句中文，说明这个话题在讨论什么、为什么最近热、有什么争议或新进展
- paper_ids：从给出的论文中挑出属于该话题的 id（1-5 个）
- question：一个值得用户深挖的开放研究问题，可以作为灵感
- emoji：一个贴切的 emoji
严格只输出 JSON 数组：
[{"emoji": "🔁", "title": "...", "summary": "...", "paper_ids": ["..."], "question": "..."}]"""


def _heat(p: dict) -> float:
    b, h = p.get("buzz") or {}, p.get("hn") or {}
    return round(math.log1p(b.get("views", 0)) * 2 + math.log1p(b.get("votes", 0)) * 3
                 + math.log1p(b.get("stars", 0)) + math.log1p(h.get("points", 0)) * 2.5, 2)


async def run_trending(days: int, count: int, model: str):
    job.start()
    try:
        job.set("fetch", "正在获取 alphaXiv 热榜与 Hacker News 讨论…", 0.05)
        ax_hot, ax_likes, hn = await asyncio.gather(
            sources.alphaxiv_trending(days, "Hot", 100),
            sources.alphaxiv_trending(days, "Likes", 50),
            sources.hn_arxiv(days),
            return_exceptions=True,
        )
        pool: dict[str, dict] = {}
        for res in (ax_hot, ax_likes):
            if isinstance(res, Exception):
                continue
            for p in res:
                pool.setdefault(p["id"], p)
        hn_list = [] if isinstance(hn, Exception) else hn
        hn_by_id = {h["id"]: h["hn"] for h in hn_list}
        missing = [i for i in hn_by_id if i not in pool]
        if missing:
            job.set("fetch", f"正在从 arXiv 补全 {len(missing)} 篇 HN 讨论中的论文…", 0.12)
            for p in await arxiv.fetch_by_ids(missing):
                pool[p["id"]] = {**p, "source": "hn"}
        for pid, h in hn_by_id.items():
            if pid in pool:
                pool[pid]["hn"] = h
        if not pool:
            errs = [str(r) for r in (ax_hot, ax_likes, hn) if isinstance(r, Exception)]
            raise llm.LLMError("没有获取到热门论文" + (f"：{errs[0]}" if errs else ""))

        cands = list(pool.values())
        for p in cands:
            p["heat"] = _heat(p)

        def buzz_line(p):
            b, h = p.get("buzz") or {}, p.get("hn") or {}
            bits = []
            if b:
                bits.append(f"alphaXiv 7天浏览 {b.get('views', 0)}，点赞 {b.get('votes', 0)}")
                if b.get("stars"):
                    bits.append(f"GitHub {b['stars']}★")
            if h:
                bits.append(f"HN {h.get('points', 0)} 分 / {h.get('comments', 0)} 评论")
            return "热度：" + "，".join(bits) if bits else ""

        def prog(done, total):
            job.set("score", f"AI 正在按你的兴趣筛选热门论文（{done}/{total} 批，共 {len(cands)} 篇）",
                    0.2 + 0.45 * done / total)

        prog(0, (len(cands) + 24) // 25)
        scores = await score_papers(model, cands, prog, extra=buzz_line)

        # Blend relevance with heat so a viral paper slightly off-topic can still surface.
        max_heat = max(p["heat"] for p in cands) or 1
        for p in cands:
            p["score"] = scores.get(p["id"], 0)
            p["rank"] = p["score"] + 3 * p["heat"] / max_heat
        ranked = sorted(cands, key=lambda p: p["rank"], reverse=True)[:count]

        job.set("digest", f"正在为 {len(ranked)} 篇热门论文生成中文速览…", 0.7)
        meta = await digest_papers(model, ranked, extra=buzz_line)

        job.set("topics", "AI 正在归纳本期升温话题…", 0.85)
        topic_text = await llm.complete(
            model,
            [{"type": "text", "text": TOPIC_SYSTEM}, {"type": "text", "text": interest_block(False)}],
            [{"role": "user", "content": "\n\n".join(
                f"id: {p['id']}\n标题: {p['title']}\n{buzz_line(p)}\n摘要: {p['abstract'][:600]}"
                for p in sorted(cands, key=lambda p: p["rank"], reverse=True)[:45])}],
            max_tokens=8000,
        )
        try:
            topics = llm.extract_json(topic_text)
        except Exception:  # noqa: BLE001 - topics are optional
            topics = []

        topic_ids = {i for t in topics for i in t.get("paper_ids", [])}
        keep = {p["id"] for p in ranked} | topic_ids
        for p in cands:
            if p["id"] not in keep:
                continue
            m = meta.get(p["id"], {})
            upsert_paper(p, status="pool", score=p.get("score"), tldr=m.get("tldr"), reason=m.get("reason"),
                         tags=m.get("tags") or [], source="trending")

        items = [{"id": p["id"], "score": p.get("score"), "heat": p["heat"], "buzz": p.get("buzz"), "hn": p.get("hn")}
                 for p in ranked]
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO trends(created_at, params, items, topics) VALUES(?,?,?,?)",
                (time.time(), json.dumps({"days": days, "count": count, "model": model, "candidates": len(cands)}),
                 json.dumps(items, ensure_ascii=False), json.dumps(topics, ensure_ascii=False)))
            job.result_id = cur.lastrowid
        job.set("done", f"完成：从 {len(cands)} 篇社区热门中精选 {len(ranked)} 篇，归纳 {len(topics)} 个话题", 1.0)
    except Exception as e:  # noqa: BLE001
        job.fail(e)
    finally:
        job.running = False

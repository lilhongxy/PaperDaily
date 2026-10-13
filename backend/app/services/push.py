"""Manual arXiv push: fetch recent papers → AI score → digest top N into the inbox."""

import json
import time

from .. import arxiv, llm
from ..db import db, get_settings, upsert_paper
from .common import Job, digest_papers, score_papers

job = Job("push")


async def run_push(count: int, days: int, model: str):
    s = get_settings()
    job.start()
    try:
        job.set("fetch", f"正在从 arXiv 获取最近 {days} 天的论文…", 0.05)
        candidates = await arxiv.search(s["categories"], s["keywords"], days, s["max_candidates"])
        with db() as conn:
            known = {r["id"] for r in conn.execute("SELECT id FROM papers WHERE status != 'pool'").fetchall()}
        candidates = [p for p in candidates if p["id"] not in known]
        if not candidates:
            raise llm.LLMError("没有获取到新论文：可以扩大时间范围、增加分类，或检查关键词")

        def prog(done, total):
            job.set("score", f"AI 正在评估相关度（{done}/{total} 批，共 {len(candidates)} 篇）", 0.1 + 0.6 * done / total)

        prog(0, (len(candidates) + 24) // 25)
        scores = await score_papers(model, candidates, prog)
        ranked = sorted(candidates, key=lambda p: scores.get(p["id"], -1), reverse=True)[:count]

        job.set("digest", f"正在为前 {len(ranked)} 篇生成中文速览…", 0.75)
        meta = await digest_papers(model, ranked)

        job.set("save", "保存中…", 0.95)
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO digests(created_at, params, paper_ids, candidates) VALUES(?, ?, ?, ?)",
                (time.time(), json.dumps({"count": count, "days": days, "model": model,
                                          "categories": s["categories"], "keywords": s["keywords"]}),
                 json.dumps([p["id"] for p in ranked]), len(candidates)))
            digest_id = cur.lastrowid
        for p in ranked:
            m = meta.get(p["id"], {})
            upsert_paper(p, status="inbox", score=scores.get(p["id"]), tldr=m.get("tldr"), reason=m.get("reason"),
                         tags=m.get("tags") or [], digest_id=digest_id, source="push")
            with db() as conn:  # a pool paper already existed: move it into this digest's inbox
                conn.execute("UPDATE papers SET status = 'inbox', digest_id = ? WHERE id = ? AND status = 'pool'",
                             (digest_id, p["id"]))
        job.result_id = digest_id
        job.set("done", f"完成：从 {len(candidates)} 篇候选中推送 {len(ranked)} 篇", 1.0)
    except Exception as e:  # noqa: BLE001 - reported to UI
        job.fail(e)
    finally:
        job.running = False

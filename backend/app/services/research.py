"""Research-line survey: AI proposes seminal works + search queries → verify on arXiv → curate timeline."""

import json
import time

from .. import arxiv, llm
from ..db import db, get_settings, upsert_paper
from .common import interest_block

PLAN_SYSTEM = """你是一位对机器学习/LLM 文献非常熟悉的研究者，帮助用户调研一条研究路线。
根据用户的调研主题，输出：
- title：给这个调研专题起一个简洁的中文标题
- known：你确信存在且最相关的代表性论文（尽量 15-25 篇，覆盖奠基工作、关键进展、近期工作；必须是真实存在的 arXiv 论文，给出准确的英文原标题和年份，不确定的不要写）
- queries：4-8 个 arXiv API 检索式，用于补充检索最新工作。语法示例：
  ti:"diffusion model"、abs:"retrieval augmented" AND cat:cs.LG、(ti:low AND ti:rank)
  短语用双引号，多个检索式覆盖不同的叫法/子方向
严格只输出 JSON：
{"title": "...", "known": [{"title": "...", "year": 2023}], "queries": ["..."]}"""

CURATE_SYSTEM = """你是一位资深研究者，正在为用户整理一条研究路线的文献地图。给定候选论文（已在 arXiv 核实），请：
1. 选出与调研主题真正相关的论文（不超过 {max} 篇），剔除无关的
2. 为每篇标注 role：
   - foundation：奠基/开创性工作
   - milestone：关键进展/重要改进
   - recent：近期值得关注的新工作
   - survey：综述
3. note：一句中文说明这篇在这条路线中的位置与贡献（不超过 50 字）
4. relevance：0-10 的相关度
5. 写一段 overview（Markdown，中文，400-800 字）：梳理这条路线的发展脉络（按时间与思想演进）、主要分支与流派、当前的开放问题与可能的研究机会。引用论文时用 [论文id] 格式。
严格只输出 JSON：
{{"overview": "...", "papers": [{{"id": "...", "role": "foundation", "note": "...", "relevance": 9}}]}}"""


async def _set(tid: int, **kw):
    kw["updated_at"] = time.time()
    for k in ("papers", "params"):
        if k in kw:
            kw[k] = json.dumps(kw[k], ensure_ascii=False)
    with db() as conn:
        conn.execute(f"UPDATE topics SET {', '.join(f'{k} = ?' for k in kw)} WHERE id = ?", (*kw.values(), tid))


def create_topic(query: str, from_year: int | None, model: str) -> int:
    now = time.time()
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO topics(query, status, params, created_at, updated_at) VALUES(?, 'running', ?, ?, ?)",
            (query, json.dumps({"from_year": from_year, "model": model, "stage": "plan",
                                "message": "AI 正在规划调研路线…"}), now, now))
        return cur.lastrowid


async def run_research(tid: int, query: str, from_year: int | None, model: str):
    params = {"from_year": from_year, "model": model}

    async def stage(name, message):
        await _set(tid, params={**params, "stage": name, "message": message})

    try:
        plan_text = await llm.complete(
            model, PLAN_SYSTEM,
            [{"role": "user", "content": f"调研主题：{query}" + (f"\n（重点关注 {from_year} 年以后的工作，但奠基性工作不受此限）" if from_year else "")}],
            max_tokens=8000)
        plan = llm.extract_json(plan_text)
        await _set(tid, title=plan.get("title") or query)

        known = [k["title"] for k in plan.get("known", []) if k.get("title")]
        await stage("verify", f"正在 arXiv 上核实 {len(known)} 篇代表性论文…")
        verified = await arxiv.find_by_titles(known)

        pool: dict[str, dict] = {p["id"]: p for p in verified.values()}
        queries = plan.get("queries", [])[:8]
        date = arxiv.date_range(from_year=from_year)
        for i, q in enumerate(queries):
            await stage("search", f"正在检索 arXiv（{i + 1}/{len(queries)}）：{q}")
            full = f"({q}) AND {date}" if date else q
            try:
                for p in await arxiv.query(full, 25, sort="relevance"):
                    pool.setdefault(p["id"], p)
            except Exception:  # noqa: BLE001 - one bad query shouldn't kill the survey
                continue
        if not pool:
            raise llm.LLMError("没有检索到相关论文，换个说法试试？")

        cands = list(pool.values())
        verified_ids = {p["id"] for p in verified.values()}
        max_n = get_settings()["research_max"]
        await stage("curate", f"AI 正在从 {len(cands)} 篇候选中整理文献地图…")
        lines = "\n\n".join(
            f"id: {p['id']}（{p['published'][:4]}）{' [代表作]' if p['id'] in verified_ids else ''}\n"
            f"标题: {p['title']}\n摘要: {p['abstract'][:500]}" for p in cands)
        cur_text = await llm.complete(
            model,
            [{"type": "text", "text": CURATE_SYSTEM.format(max=max_n)}, {"type": "text", "text": interest_block(False)}],
            [{"role": "user", "content": f"调研主题：{query}\n\n候选论文：\n\n{lines}"}],
            max_tokens=32000)
        curated = llm.extract_json(cur_text)

        picked = []
        for item in curated.get("papers", []):
            p = pool.get(str(item.get("id")))
            if not p:
                continue
            upsert_paper(p, status="pool", source="research")
            picked.append({"id": p["id"], "role": item.get("role", "recent"), "note": item.get("note", ""),
                           "relevance": item.get("relevance"), "year": p["published"][:4]})
        picked.sort(key=lambda x: x["year"])
        await _set(tid, status="done", overview=curated.get("overview", ""), papers=picked,
                   params={**params, "stage": "done", "candidates": len(cands),
                           "message": f"完成：{len(cands)} 篇候选 → {len(picked)} 篇"})
    except Exception as e:  # noqa: BLE001
        await _set(tid, status="error", error=str(e) or e.__class__.__name__, params={**params, "stage": "error"})

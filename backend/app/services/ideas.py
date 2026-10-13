"""Idea notebook AI: help develop a research idea with linked papers as context."""

import json
import time

from .. import llm
from ..db import db
from .common import interest_block

MODES = {
    "chat": "",
    "related": "请分析：这个想法与哪些已有工作相关？是否已经有人做过类似的事？列出你知道的相关方向和代表性论文（标注不确定的），并指出这个想法与它们的差异点。",
    "critique": "请以严格审稿人的视角挑战这个想法：指出最薄弱的假设、可能的失败原因、潜在的反例，以及需要先验证的关键前提。最后给出你认为最值得保留的核心。",
    "experiment": "请为这个想法设计一个最小可行的验证实验（MVP）：要验证的核心假设、模型/数据规模、对照组与基线、评估指标、预期结果与判据、所需算力估计。然后给出一个逐步扩展的实验路线。",
    "expand": "请帮助发散这个想法：给出 3-5 个延伸方向或变体（每个说明动机与可行性），并指出最有潜力的一个。",
}

SYSTEM = """你是用户的科研合作者，熟悉 LLM 与机器学习前沿。你的任务是帮助用户把一个研究想法打磨成可执行的研究方向。
- 用中文交流，专业术语可保留英文
- 直率、具体，不要空泛的鼓励；有不同意见要明说
- 提到具体论文时尽量给出标题与年份；不确定的要明确标注
- 数学公式使用 LaTeX，回答使用 Markdown"""


def _context(idea_id: int) -> tuple[dict, list, list]:
    with db() as conn:
        idea = dict(conn.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,)).fetchone())
        papers = conn.execute(
            "SELECT p.id, p.title, p.abstract, p.tldr, n.content AS note FROM idea_papers ip "
            "JOIN papers p ON p.id = ip.paper_id LEFT JOIN notes n ON n.paper_id = p.id WHERE ip.idea_id = ?",
            (idea_id,)).fetchall()
        history = conn.execute("SELECT role, content FROM idea_chats WHERE idea_id = ? ORDER BY id",
                               (idea_id,)).fetchall()
    return idea, papers, history


async def stream_idea_ai(idea_id: int, model: str, mode: str, message: str | None):
    idea, papers, history = _context(idea_id)
    ctx = [interest_block(False), f"## 用户的想法：{idea['title'] or '（无标题）'}\n\n{idea['content'] or '（尚未展开）'}"]
    if papers:
        ctx.append("## 关联论文\n\n" + "\n\n".join(
            f"- {p['title']}（arXiv {p['id']}）\n  {p['tldr'] or p['abstract'][:400]}" +
            (f"\n  用户笔记：{p['note'][:800]}" if p["note"] else "") for p in papers))
    system = [{"type": "text", "text": SYSTEM}, {"type": "text", "text": "\n\n".join(ctx)}]

    prompt = MODES.get(mode, "")
    content = (prompt + ("\n\n" + message if message else "")).strip() or "请谈谈你对这个想法的看法。"
    messages = [{"role": r["role"], "content": r["content"]} for r in history[-16:]]
    messages.append({"role": "user", "content": content})
    parts = []
    async for t in llm.stream_text(model, system, messages):
        parts.append(t)
        yield t
    now = time.time()
    with db() as conn:
        conn.execute("INSERT INTO idea_chats(idea_id, role, content, mode, model, created_at) VALUES(?,?,?,?,?,?)",
                     (idea_id, "user", content, mode, model, now))
        conn.execute("INSERT INTO idea_chats(idea_id, role, content, mode, model, created_at) VALUES(?,?,?,?,?,?)",
                     (idea_id, "assistant", "".join(parts), mode, model, now))
        conn.execute("UPDATE ideas SET updated_at = ? WHERE id = ?", (now, idea_id))


def idea_dict(row) -> dict:
    d = dict(row)
    d["tags"] = json.loads(d["tags"] or "[]")
    d["pinned"] = bool(d["pinned"])
    return d

"""Shared helpers for background AI jobs and prompts."""

import asyncio
import time

from .. import llm
from ..db import DISLIKED_REACTIONS, LIBRARY_STATUSES, LIKED_REACTIONS, db, get_settings

_bg: set[asyncio.Task] = set()


def spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _bg.add(task)
    task.add_done_callback(_bg.discard)


class Job:
    """Progress state for a single-instance background job, polled by the UI."""

    def __init__(self, name: str):
        self.name = name
        self.reset()

    def reset(self):
        self.running = False
        self.stage = "idle"
        self.message = ""
        self.progress = 0.0
        self.error: str | None = None
        self.result_id: int | None = None
        self.started_at: float | None = None

    def start(self):
        self.reset()
        self.running, self.started_at = True, time.time()

    def set(self, stage: str, message: str, progress: float):
        self.stage, self.message, self.progress = stage, message, progress

    def fail(self, e: Exception):
        self.error = str(e) or e.__class__.__name__
        self.set("error", self.error, self.progress)

    def state(self) -> dict:
        return {k: getattr(self, k) for k in
                ("running", "stage", "message", "progress", "error", "result_id", "started_at")}


def preference_context() -> str:
    """Recent reactions steer ranking: 🔥🤩💡 / library = liked, 🗑️🙅 / ignored = disliked."""
    lib = ",".join("?" * len(LIBRARY_STATUSES))
    liked_r = ",".join("?" * len(LIKED_REACTIONS))
    dis_r = ",".join("?" * len(DISLIKED_REACTIONS))
    with db() as conn:
        liked = conn.execute(
            f"SELECT title, reaction FROM papers WHERE reaction IN ({liked_r}) "
            f"OR (reaction IS NULL AND status IN ({lib})) ORDER BY reaction IS NULL, updated_at DESC LIMIT 20",
            (*LIKED_REACTIONS, *LIBRARY_STATUSES)).fetchall()
        disliked = conn.execute(
            f"SELECT title FROM papers WHERE reaction IN ({dis_r}) OR status = 'ignored' "
            "ORDER BY updated_at DESC LIMIT 15", DISLIKED_REACTIONS).fetchall()
    mark = {"must": "🔥必读", "love": "🤩很赞", "insight": "💡有启发"}
    parts = []
    if liked:
        parts.append("用户近期感兴趣的论文：\n" + "\n".join(
            f"- {r['title']}" + (f"（{mark[r['reaction']]}）" if r["reaction"] in mark else "") for r in liked))
    if disliked:
        parts.append("用户近期认为没价值/不感兴趣的论文（类似主题应降分）：\n" + "\n".join(f"- {r['title']}" for r in disliked))
    return "\n\n".join(parts)


def interest_block(with_prefs: bool = True) -> str:
    s = get_settings()
    interest = s["interest"].strip() or "（用户未填写，请按论文普遍重要性与新颖性判断）"
    block = f"用户研究兴趣：\n{interest}"
    if s["keywords"]:
        block += f"\n关注关键词：{', '.join(s['keywords'])}"
    if with_prefs:
        pref = preference_context()
        if pref:
            block += "\n\n" + pref
    return block


def paper_lines(papers: list[dict], abstract_chars: int = 1200, extra=None) -> str:
    out = []
    for p in papers:
        s = f"id: {p['id']}\n标题: {p['title']}\n摘要: {p['abstract'][:abstract_chars]}"
        if extra:
            e = extra(p)
            if e:
                s += f"\n{e}"
        out.append(s)
    return "\n\n".join(out)


SCORE_SYSTEM = """你是一位资深科研助手，负责根据用户的研究兴趣为论文打分。
评分标准（0-10 分）：
- 9-10：与用户兴趣高度契合，很可能必读
- 6-8：相关，值得一看
- 3-5：边缘相关
- 0-2：不相关
只依据给出的信息判断。严格只输出 JSON 数组，不要任何其他文字：
[{"id": "论文id", "score": 数字}]"""

DIGEST_SYSTEM = """你是一位资深科研助手，为用户撰写中文论文速览。对每篇论文输出：
- tldr：一句话中文概括核心贡献（不超过 60 字）
- reason：结合用户研究兴趣，说明为什么推荐（不超过 50 字）
- tags：2-4 个中文或通用英文术语标签
严格只输出 JSON 数组，不要任何其他文字：
[{"id": "论文id", "tldr": "...", "reason": "...", "tags": ["..."]}]"""


async def score_papers(model: str, papers: list[dict], on_progress=None, batch_size: int = 25,
                       extra=None, system: str = SCORE_SYSTEM) -> dict[str, float]:
    interest = interest_block()
    batches = [papers[i:i + batch_size] for i in range(0, len(papers), batch_size)]
    scores: dict[str, float] = {}
    done = 0
    sem = asyncio.Semaphore(4)

    async def worker(b):
        nonlocal done
        async with sem:
            try:
                text = await llm.complete(
                    model,
                    # Interest block is identical across batches -> cacheable prefix.
                    [{"type": "text", "text": system},
                     {"type": "text", "text": interest, "cache_control": {"type": "ephemeral"}}],
                    [{"role": "user", "content": "请为以下论文打分：\n\n" + paper_lines(b, 800, extra)}],
                    max_tokens=4000,
                )
                for item in llm.extract_json(text):
                    try:
                        scores[str(item["id"])] = float(item["score"])
                    except (KeyError, TypeError, ValueError):
                        continue
            finally:
                done += 1
                if on_progress:
                    on_progress(done, len(batches))

    results = await asyncio.gather(*(worker(b) for b in batches), return_exceptions=True)
    if not scores:
        err = next((r for r in results if isinstance(r, Exception)), None)
        raise err or llm.LLMError("评分失败")
    return scores


async def digest_papers(model: str, papers: list[dict], extra=None) -> dict[str, dict]:
    if not papers:
        return {}
    out: dict[str, dict] = {}
    for i in range(0, len(papers), 15):
        chunk = papers[i:i + 15]
        text = await llm.complete(
            model,
            [{"type": "text", "text": DIGEST_SYSTEM}, {"type": "text", "text": interest_block(False)}],
            [{"role": "user", "content": paper_lines(chunk, 1200, extra)}],
            max_tokens=16000,
        )
        out.update({str(m.get("id")): m for m in llm.extract_json(text)})
    return out

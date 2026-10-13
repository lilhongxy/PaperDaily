"""Research assistant: a tool-using agent over the whole app (library, arXiv, trending, ideas, notes, research)."""

import asyncio
import json
import time
from datetime import datetime

from .. import arxiv, llm
from ..db import DISLIKED_REACTIONS, LIBRARY_STATUSES, LIKED_REACTIONS, db, get_settings, library_ids, log_event, \
    paper_row, upsert_paper
from . import reader, related, research
from .common import interest_block, spawn

MAX_STEPS = 12
REACTIONS = ("must", "love", "insight", "doubt", "meh", "trash", "nope")
STATUSES = ("later", "reading", "read", "archived", "ignored")

SYSTEM = """你是 DailyPaper 的 AI 研究助理，用户的科研合伙人。DailyPaper 是用户本地的论文阅读与科研灵感工具，包含：
- 文库（用户收藏的论文，带阅读状态与表情反馈：🔥必读 🤩很赞 💡有启发 🤔存疑 😐一般 🗑️没价值 🙅不感兴趣）
- 笔记（每篇论文一份 Markdown 笔记）
- 灵感本（用户的研究想法，状态：seed 萌芽 / growing 发展中 / formed 成型 / doing 在做 / shelved 搁置）
- 调研专题（某条研究路线的文献地图）
- 社区热榜（alphaXiv + Hacker News 热门论文与升温话题）

你可以通过工具查询和操作这些内容，也可以检索 arXiv、阅读论文全文。工作方式：
- 用中文交流，专业术语可保留英文；直接、具体，有观点
- 需要信息时主动调用工具，可以连续调用多个；能并行的查询一次发出
- 只在用户明确要求或明显同意时才执行写操作（加入文库、打表情、建灵感、写笔记、发起调研）；做完后简短说明做了什么
- 讨论论文内容时，先用 read_paper 获取全文再回答，不要凭标题臆测
- 提到论文时用 Markdown 链接 [标题](/read/arXiv编号)；提到灵感用 [标题](/ideas/id)；提到调研专题用 [标题](/research/id)。这些链接在应用内可以直接点开
- 数学公式使用 LaTeX，回答使用 Markdown；推荐论文时说明理由
- arXiv 检索语法示例：ti:"diffusion model"、abs:"retrieval augmented" AND cat:cs.LG、au:Hinton；短语用双引号"""


def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


_ids = {"type": "array", "items": {"type": "string"}, "description": "arXiv 编号列表，如 2301.13196"}

TOOLS = [
    {"name": "search_library", "description": "搜索用户本地的论文（文库、收件箱、看过的热榜/调研论文），可按关键词、阅读状态、表情、标签过滤。关键词会匹配标题、摘要、作者、标签和用户笔记。",
     "input_schema": _obj({
         "query": {"type": "string", "description": "关键词，可为空"},
         "scope": {"type": "string", "enum": ["library", "inbox", "all"], "description": "library=文库（默认），inbox=待筛选收件箱，all=包括所有见过的论文"},
         "status": {"type": "string", "enum": list(STATUSES)},
         "reaction": {"type": "string", "enum": list(REACTIONS)},
         "tag": {"type": "string"},
         "limit": {"type": "integer", "description": "默认 20，最多 50"},
     }, [])},
    {"name": "search_arxiv", "description": "用 arXiv API 检索论文（实时）。适合找某个方向的论文、最新工作。",
     "input_schema": _obj({
         "query": {"type": "string", "description": "arXiv 检索式，如 ti:\"diffusion model\" OR abs:\"score matching\""},
         "sort": {"type": "string", "enum": ["relevance", "date"], "description": "默认 relevance"},
         "from_year": {"type": "integer", "description": "只要该年份之后的论文"},
         "max_results": {"type": "integer", "description": "默认 15，最多 40"},
     }, ["query"])},
    {"name": "find_papers_by_title", "description": "按英文标题在 arXiv 上精确查找论文（例如你知道的经典论文），返回 arXiv 编号与摘要。",
     "input_schema": _obj({"titles": {"type": "array", "items": {"type": "string"}}}, ["titles"])},
    {"name": "get_paper", "description": "获取一篇论文的详细信息：摘要、AI 速览、用户的阅读状态/表情/笔记/高亮、已有的 AI 精读。不在本地的论文会自动从 arXiv 获取。",
     "input_schema": _obj({"paper_id": {"type": "string"}}, ["paper_id"])},
    {"name": "read_paper", "description": "下载并读取论文 PDF 全文（带页码标记）。讨论论文细节、回答具体问题前使用。",
     "input_schema": _obj({"paper_id": {"type": "string"},
                           "max_chars": {"type": "integer", "description": "默认 80000"}}, ["paper_id"])},
    {"name": "find_related_papers", "description": "为一篇论文查找相关工作（Semantic Scholar 推荐 + AI 检索），较慢（约 30-60 秒）。",
     "input_schema": _obj({"paper_id": {"type": "string"}}, ["paper_id"])},
    {"name": "get_trending", "description": "查看最近一次社区热榜：升温话题与热门论文（含热度）。",
     "input_schema": _obj({}, [])},
    {"name": "add_to_library", "description": "把论文加入文库（或修改阅读状态）。",
     "input_schema": _obj({"paper_ids": _ids, "status": {"type": "string", "enum": list(STATUSES), "description": "默认 later（稍后读）"}},
                          ["paper_ids"])},
    {"name": "set_reaction", "description": "给论文设置表情反馈（会影响后续推荐）。reaction 为 null 表示清除。",
     "input_schema": _obj({"paper_id": {"type": "string"},
                           "reaction": {"type": ["string", "null"], "enum": [*REACTIONS, None]}}, ["paper_id", "reaction"])},
    {"name": "append_paper_note", "description": "向某篇论文的笔记末尾追加 Markdown 内容。",
     "input_schema": _obj({"paper_id": {"type": "string"}, "content": {"type": "string"}}, ["paper_id", "content"])},
    {"name": "list_ideas", "description": "列出/搜索用户灵感本中的想法。",
     "input_schema": _obj({"query": {"type": "string"},
                           "status": {"type": "string", "enum": ["seed", "growing", "formed", "doing", "shelved"]}}, [])},
    {"name": "get_idea", "description": "获取一条想法的全文、关联论文和与 AI 的讨论摘要。",
     "input_schema": _obj({"idea_id": {"type": "integer"}}, ["idea_id"])},
    {"name": "create_idea", "description": "在灵感本中新建一条想法，可关联论文。",
     "input_schema": _obj({
         "title": {"type": "string"}, "content": {"type": "string", "description": "Markdown 正文"},
         "status": {"type": "string", "enum": ["seed", "growing", "formed", "doing", "shelved"]},
         "tags": {"type": "array", "items": {"type": "string"}}, "paper_ids": _ids,
     }, ["title", "content"])},
    {"name": "update_idea", "description": "更新已有想法：追加正文、修改状态、关联更多论文、加标签。",
     "input_schema": _obj({
         "idea_id": {"type": "integer"},
         "append_content": {"type": "string", "description": "追加到正文末尾的 Markdown"},
         "status": {"type": "string", "enum": ["seed", "growing", "formed", "doing", "shelved"]},
         "add_paper_ids": _ids, "add_tags": {"type": "array", "items": {"type": "string"}},
     }, ["idea_id"])},
    {"name": "list_research_topics", "description": "列出已有的调研专题。",
     "input_schema": _obj({}, [])},
    {"name": "get_research_topic", "description": "获取调研专题的路线综述与文献列表。",
     "input_schema": _obj({"topic_id": {"type": "integer"}}, ["topic_id"])},
    {"name": "start_research", "description": "发起一个新的研究路线调研（后台运行 1-3 分钟，生成文献地图与综述）。",
     "input_schema": _obj({"query": {"type": "string", "description": "调研主题描述"},
                           "from_year": {"type": "integer"}}, ["query"])},
]

TOOL_LABEL = {t["name"]: t["name"] for t in TOOLS}


# ---------------------------------------------------------------- helpers

def _brief(p: dict, lib: set[str], abstract: int = 300) -> dict:
    return {"id": p["id"], "title": p["title"], "authors": (p.get("authors") or [])[:4],
            "year": (p.get("published") or "")[:4], "tldr": p.get("tldr"),
            "abstract": (p.get("abstract") or "")[:abstract], "status": p.get("status"),
            "reaction": p.get("reaction"), "in_library": p["id"] in lib}


def _ensure_local(papers: list[dict]) -> None:
    for p in papers:
        upsert_paper(p, status="pool", source="assistant")


def _rows(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    with db() as conn:
        rows = conn.execute(f"SELECT * FROM papers WHERE id IN ({','.join('?' * len(ids))})", ids).fetchall()
    return {r["id"]: paper_row(r) for r in rows}


async def _local_or_fetch(pid: str) -> dict:
    pid = arxiv.normalize_id(pid)
    p = reader.get_paper(pid)
    if p:
        return p
    got = await arxiv.fetch_by_id(pid)
    if not got:
        raise ValueError(f"arXiv 上找不到 {pid}")
    _ensure_local([got])
    return reader.get_paper(pid)


def _idea_row(r) -> dict:
    return {"id": r["id"], "title": r["title"], "status": r["status"], "tags": json.loads(r["tags"] or "[]"),
            "updated": datetime.fromtimestamp(r["updated_at"]).strftime("%Y-%m-%d")}


# ---------------------------------------------------------------- tools
# Each returns (result_for_model, ui_payload_for_frontend).

async def t_search_library(query: str = "", scope: str = "library", status: str | None = None,
                           reaction: str | None = None, tag: str | None = None, limit: int = 20):
    where, args = [], []
    if status:
        where.append("status = ?")
        args.append(status)
    elif scope == "library":
        where.append(f"status IN ({','.join('?' * len(LIBRARY_STATUSES))})")
        args += LIBRARY_STATUSES
    elif scope == "inbox":
        where.append("status = 'inbox'")
    if reaction:
        where.append("reaction = ?")
        args.append(reaction)
    if tag:
        where.append("EXISTS (SELECT 1 FROM json_each(papers.tags) WHERE value = ?)")
        args.append(tag)
    terms = [t for t in (query or "").split() if t]
    for t in terms:
        like = f"%{t}%"
        where.append("(title LIKE ? OR abstract LIKE ? OR tldr LIKE ? OR authors LIKE ? OR tags LIKE ? "
                     "OR id IN (SELECT paper_id FROM notes WHERE content LIKE ?))")
        args += [like] * 6
    sql = "SELECT * FROM papers" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY updated_at DESC LIMIT ?"
    with db() as conn:
        rows = [paper_row(r) for r in conn.execute(sql, (*args, min(limit or 20, 50))).fetchall()]
    lib = library_ids()
    items = [_brief(p, lib) for p in rows]
    return {"count": len(items), "papers": items}, {"kind": "papers", "papers": items}


async def t_search_arxiv(query: str, sort: str = "relevance", from_year: int | None = None, max_results: int = 15):
    q = query
    if from_year:
        q = f"({query}) AND {arxiv.date_range(from_year=from_year)}"
    papers = await arxiv.query(q, min(max_results or 15, 40), sort="submittedDate" if sort == "date" else "relevance")
    _ensure_local(papers)
    lib = library_ids()
    local = _rows([p["id"] for p in papers])
    items = [_brief({**p, **{k: v for k, v in (local.get(p["id"]) or {}).items() if k in ("status", "reaction", "tldr")}}, lib)
             for p in papers]
    return {"count": len(items), "papers": items}, {"kind": "papers", "papers": items}


async def t_find_papers_by_title(titles: list[str]):
    found = await arxiv.find_by_titles(titles[:20])
    _ensure_local(list(found.values()))
    lib = library_ids()
    items = [_brief(p, lib) for p in found.values()]
    missing = [t for t in titles if t not in found]
    return {"found": items, "not_found": missing}, {"kind": "papers", "papers": items}


async def t_get_paper(paper_id: str):
    p = await _local_or_fetch(paper_id)
    with db() as conn:
        note = conn.execute("SELECT content FROM notes WHERE paper_id = ?", (p["id"],)).fetchone()
        hls = conn.execute("SELECT text, page, comment FROM highlights WHERE paper_id = ? ORDER BY page, id",
                           (p["id"],)).fetchall()
        ideas = conn.execute("SELECT i.id, i.title FROM ideas i JOIN idea_papers ip ON ip.idea_id = i.id "
                             "WHERE ip.paper_id = ?", (p["id"],)).fetchall()
    lib = library_ids()
    res = {**_brief(p, lib, 3000), "authors": p["authors"], "categories": p["categories"], "tags": p["tags"],
           "reason": p.get("reason"), "note": note["content"] if note else "",
           "highlights": [dict(h) for h in hls], "linked_ideas": [dict(i) for i in ideas],
           "ai_analysis": (p.get("analysis") or "")[:6000]}
    return res, {"kind": "papers", "papers": [_brief(p, lib)]}


async def t_read_paper(paper_id: str, max_chars: int = 80000):
    p = await _local_or_fetch(paper_id)
    text = await reader.ensure_text(p)
    max_chars = max(5000, min(max_chars or 80000, 150000))
    out = text[:max_chars]
    if len(text) > max_chars:
        out += f"\n\n[全文共 {len(text)} 字符，已截断]"
    log_event("open", p["id"])
    return {"id": p["id"], "title": p["title"], "fulltext": out}, \
        {"kind": "note", "text": f"已读取全文（{len(text) // 1000}k 字符）", "paper": {"id": p["id"], "title": p["title"]}}


async def t_find_related_papers(paper_id: str, _model: str = ""):
    p = await _local_or_fetch(paper_id)
    items = await related.find_related(p, _model or get_settings()["reader_model"])
    papers = [{"id": r["id"], "title": r["title"], "authors": r["authors"], "year": r["year"],
               "tldr": f"【{r['relation']}】{r['why']}", "abstract": r["abstract"][:300], "status": r["status"],
               "reaction": None, "in_library": r["in_library"]} for r in items]
    return {"for": p["title"], "related": papers}, {"kind": "papers", "papers": papers}


async def t_get_trending():
    with db() as conn:
        r = conn.execute("SELECT * FROM trends ORDER BY id DESC LIMIT 1").fetchone()
    if not r:
        return {"error": "还没有热榜，请用户在「今日 → 社区热榜」点击刷新"}, None
    items, topics = json.loads(r["items"]), json.loads(r["topics"])
    info = _rows([i["id"] for i in items])
    lib = library_ids()
    papers = [{**_brief(info[i["id"]], lib, 200), "heat": i["heat"]} for i in items if i["id"] in info]
    when = datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d %H:%M")
    return {"updated": when, "topics": topics, "papers": papers}, {"kind": "papers", "papers": papers[:10]}


async def t_add_to_library(paper_ids: list[str], status: str = "later"):
    done = []
    for pid in paper_ids[:50]:
        p = await _local_or_fetch(pid)
        with db() as conn:
            conn.execute("UPDATE papers SET status = ?, updated_at = ? WHERE id = ?", (status or "later", time.time(), p["id"]))
        done.append(p)
    lib = library_ids()
    items = [_brief({**p, "status": status}, lib) for p in done]
    return {"ok": True, "updated": [p["id"] for p in done], "status": status}, {"kind": "papers", "papers": items}


async def t_set_reaction(paper_id: str, reaction: str | None):
    p = await _local_or_fetch(paper_id)
    with db() as conn:
        conn.execute("UPDATE papers SET reaction = ?, updated_at = ? WHERE id = ?", (reaction, time.time(), p["id"]))
    log_event("react", p["id"])
    return {"ok": True}, {"kind": "papers", "papers": [_brief({**p, "reaction": reaction}, library_ids())]}


async def t_append_paper_note(paper_id: str, content: str):
    p = await _local_or_fetch(paper_id)
    now = time.time()
    with db() as conn:
        cur = conn.execute("SELECT content FROM notes WHERE paper_id = ?", (p["id"],)).fetchone()
        old = cur["content"] if cur else ""
        new = (old.rstrip() + "\n\n" if old.strip() else "") + content
        conn.execute("INSERT INTO notes(paper_id, content, updated_at) VALUES(?,?,?) ON CONFLICT(paper_id) "
                     "DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at", (p["id"], new, now))
    return {"ok": True}, {"kind": "note", "text": "已写入笔记", "paper": {"id": p["id"], "title": p["title"]}}


async def t_list_ideas(query: str = "", status: str | None = None):
    sql, args = "SELECT * FROM ideas", []
    where = []
    if query:
        where.append("(title LIKE ? OR content LIKE ? OR tags LIKE ?)")
        args += [f"%{query}%"] * 3
    if status:
        where.append("status = ?")
        args.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    with db() as conn:
        rows = conn.execute(sql + " ORDER BY pinned DESC, updated_at DESC LIMIT 40", args).fetchall()
    items = [{**_idea_row(r), "preview": r["content"][:200]} for r in rows]
    return {"count": len(items), "ideas": items}, {"kind": "ideas", "ideas": [_idea_row(r) for r in rows]}


async def t_get_idea(idea_id: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,)).fetchone()
        if not r:
            raise ValueError(f"想法 {idea_id} 不存在")
        papers = conn.execute("SELECT p.id, p.title FROM idea_papers ip JOIN papers p ON p.id = ip.paper_id "
                              "WHERE ip.idea_id = ?", (idea_id,)).fetchall()
        chats = conn.execute("SELECT role, content, mode FROM idea_chats WHERE idea_id = ? ORDER BY id DESC LIMIT 6",
                             (idea_id,)).fetchall()
    return ({**_idea_row(r), "content": r["content"], "papers": [dict(p) for p in papers],
             "recent_ai_discussion": [{"role": c["role"], "mode": c["mode"], "content": c["content"][:1500]} for c in reversed(chats)]},
            {"kind": "ideas", "ideas": [_idea_row(r)]})


async def t_create_idea(title: str, content: str, status: str = "seed", tags: list[str] | None = None,
                        paper_ids: list[str] | None = None):
    now = time.time()
    pids = []
    for pid in paper_ids or []:
        pids.append((await _local_or_fetch(pid))["id"])
    with db() as conn:
        cur = conn.execute("INSERT INTO ideas(title, content, status, tags, created_at, updated_at) VALUES(?,?,?,?,?,?)",
                           (title, content, status or "seed", json.dumps(tags or [], ensure_ascii=False), now, now))
        iid = cur.lastrowid
        conn.executemany("INSERT OR IGNORE INTO idea_papers(idea_id, paper_id) VALUES(?, ?)", [(iid, p) for p in pids])
        r = conn.execute("SELECT * FROM ideas WHERE id = ?", (iid,)).fetchone()
    log_event("idea", str(iid))
    return {"ok": True, "idea_id": iid, "link": f"/ideas/{iid}"}, {"kind": "ideas", "ideas": [_idea_row(r)], "created": True}


async def t_update_idea(idea_id: int, append_content: str | None = None, status: str | None = None,
                        add_paper_ids: list[str] | None = None, add_tags: list[str] | None = None):
    with db() as conn:
        r = conn.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,)).fetchone()
    if not r:
        raise ValueError(f"想法 {idea_id} 不存在")
    content = r["content"]
    if append_content:
        content = (content.rstrip() + "\n\n" if content.strip() else "") + append_content
    tags = json.loads(r["tags"] or "[]")
    for t in add_tags or []:
        if t not in tags:
            tags.append(t)
    pids = [(await _local_or_fetch(p))["id"] for p in add_paper_ids or []]
    with db() as conn:
        conn.execute("UPDATE ideas SET content = ?, status = ?, tags = ?, updated_at = ? WHERE id = ?",
                     (content, status or r["status"], json.dumps(tags, ensure_ascii=False), time.time(), idea_id))
        conn.executemany("INSERT OR IGNORE INTO idea_papers(idea_id, paper_id) VALUES(?, ?)", [(idea_id, p) for p in pids])
        r = conn.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,)).fetchone()
    return {"ok": True}, {"kind": "ideas", "ideas": [_idea_row(r)]}


async def t_list_research_topics():
    with db() as conn:
        rows = conn.execute("SELECT id, query, title, status, papers, created_at FROM topics ORDER BY id DESC").fetchall()
    items = [{"id": r["id"], "title": r["title"] or r["query"], "query": r["query"], "status": r["status"],
              "papers": len(json.loads(r["papers"]))} for r in rows]
    return {"topics": items}, {"kind": "topics", "topics": items}


async def t_get_research_topic(topic_id: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
    if not r:
        raise ValueError(f"调研专题 {topic_id} 不存在")
    papers = json.loads(r["papers"])
    info = _rows([p["id"] for p in papers])
    plist = [{"id": p["id"], "title": info[p["id"]]["title"] if p["id"] in info else "", "year": p.get("year"),
              "role": p.get("role"), "note": p.get("note")} for p in papers]
    t = {"id": r["id"], "title": r["title"] or r["query"], "status": r["status"], "papers": len(papers)}
    return {**t, "overview": r["overview"], "paper_list": plist, "error": r["error"]}, {"kind": "topics", "topics": [t]}


async def t_start_research(query: str, from_year: int | None = None, _model: str = ""):
    model = _model or get_settings()["reader_model"]
    tid = research.create_topic(query, from_year, model)
    spawn(research.run_research(tid, query, from_year, model))
    log_event("research", str(tid))
    t = {"id": tid, "title": query, "status": "running", "papers": 0}
    return {"ok": True, "topic_id": tid, "link": f"/research/{tid}", "note": "调研已在后台开始，约 1-3 分钟完成"}, \
        {"kind": "topics", "topics": [t]}


HANDLERS = {
    "search_library": t_search_library, "search_arxiv": t_search_arxiv, "find_papers_by_title": t_find_papers_by_title,
    "get_paper": t_get_paper, "read_paper": t_read_paper, "find_related_papers": t_find_related_papers,
    "get_trending": t_get_trending, "add_to_library": t_add_to_library, "set_reaction": t_set_reaction,
    "append_paper_note": t_append_paper_note, "list_ideas": t_list_ideas, "get_idea": t_get_idea,
    "create_idea": t_create_idea, "update_idea": t_update_idea, "list_research_topics": t_list_research_topics,
    "get_research_topic": t_get_research_topic, "start_research": t_start_research,
}
NEEDS_MODEL = {"find_related_papers", "start_research"}


async def run_tool(name: str, args: dict, model: str) -> tuple[str, dict | None, bool]:
    fn = HANDLERS.get(name)
    if not fn:
        return f"未知工具 {name}", None, False
    if not isinstance(args, dict):
        return "工具参数格式错误", None, False
    try:
        kwargs = {k: v for k, v in args.items() if v is not None or k == "reaction"}
        if name in NEEDS_MODEL:
            kwargs["_model"] = model
        res, ui = await fn(**kwargs)
        return json.dumps(res, ensure_ascii=False), ui, True
    except TypeError as e:
        return f"参数错误：{e}", None, False
    except Exception as e:  # noqa: BLE001 - surfaced to the model as is_error
        return f"执行失败：{e}", None, False


# ---------------------------------------------------------------- threads

def _system() -> list:
    stable = SYSTEM + "\n\n" + interest_block(False)
    lib_n = len(library_ids())
    with db() as conn:
        liked = conn.execute(f"SELECT COUNT(*) FROM papers WHERE reaction IN ({','.join('?' * len(LIKED_REACTIONS))})",
                             LIKED_REACTIONS).fetchone()[0]
        disliked = conn.execute(f"SELECT COUNT(*) FROM papers WHERE reaction IN ({','.join('?' * len(DISLIKED_REACTIONS))})",
                                DISLIKED_REACTIONS).fetchone()[0]
        ideas = conn.execute("SELECT COUNT(*) FROM ideas").fetchone()[0]
    volatile = (f"今天是 {datetime.now().strftime('%Y-%m-%d %A')}。用户文库 {lib_n} 篇，"
                f"正面表情 {liked} 篇，负面表情 {disliked} 篇，灵感 {ideas} 条。")
    # Stable prefix (tools + role + interest) is cached; the per-day stats come after the breakpoint.
    return [{"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": volatile}]


def _context_text(ctx: dict | None) -> str | None:
    if not ctx or not ctx.get("kind") or not ctx.get("id"):
        return None
    kind, cid = ctx["kind"], ctx["id"]
    with db() as conn:
        if kind == "paper":
            r = conn.execute("SELECT id, title FROM papers WHERE id = ?", (cid,)).fetchone()
            return f"[页面上下文] 用户当前正在阅读论文 {r['id']}《{r['title']}》" if r else None
        if kind == "idea":
            r = conn.execute("SELECT id, title FROM ideas WHERE id = ?", (cid,)).fetchone()
            return f"[页面上下文] 用户当前正在查看灵感 #{r['id']}「{r['title']}」" if r else None
        if kind == "topic":
            r = conn.execute("SELECT id, title, query FROM topics WHERE id = ?", (cid,)).fetchone()
            return f"[页面上下文] 用户当前正在查看调研专题 #{r['id']}「{r['title'] or r['query']}」" if r else None
    return None


def _api_messages(thread_id: int) -> list[dict]:
    """Rebuild the API transcript (append-only, exactly as sent). Consecutive user turns are merged
    so an interrupted turn never leaves the history in an invalid shape."""
    with db() as conn:
        rows = conn.execute("SELECT role, content FROM assistant_messages WHERE thread_id = ? ORDER BY id",
                            (thread_id,)).fetchall()
    msgs: list[dict] = []
    for r in rows:
        content = json.loads(r["content"])
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        if msgs and msgs[-1]["role"] == r["role"]:
            msgs[-1]["content"] += content
        else:
            msgs.append({"role": r["role"], "content": content})
    return msgs


def _save(thread_id: int, role: str, content, display: str | None = None, ui: dict | None = None):
    with db() as conn:
        conn.execute("INSERT INTO assistant_messages(thread_id, role, content, display, ui, created_at) VALUES(?,?,?,?,?,?)",
                     (thread_id, role, json.dumps(content, ensure_ascii=False), display,
                      json.dumps(ui, ensure_ascii=False) if ui else None, time.time()))
        conn.execute("UPDATE assistant_threads SET updated_at = ? WHERE id = ?", (time.time(), thread_id))


def create_thread(title: str) -> int:
    now = time.time()
    with db() as conn:
        return conn.execute("INSERT INTO assistant_threads(title, created_at, updated_at) VALUES(?,?,?)",
                            (title[:60], now, now)).lastrowid


def thread_display(thread_id: int) -> list[dict]:
    """Flatten stored API messages into UI items: user / text / tool."""
    with db() as conn:
        rows = conn.execute("SELECT role, content, display, ui FROM assistant_messages WHERE thread_id = ? ORDER BY id",
                            (thread_id,)).fetchall()
    items: list[dict] = []
    tools: dict[str, dict] = {}
    for r in rows:
        content = json.loads(r["content"])
        if r["role"] == "user":
            if r["display"] is not None:
                items.append({"type": "user", "text": r["display"]})
            ui = json.loads(r["ui"]) if r["ui"] else {}
            for tid, res in ui.items():
                if tid in tools:
                    tools[tid].update(res)
            continue
        for b in content if isinstance(content, list) else []:
            if b.get("type") == "text" and b.get("text"):
                items.append({"type": "text", "text": b["text"]})
            elif b.get("type") == "tool_use":
                t = {"type": "tool", "id": b["id"], "name": b["name"], "input": b.get("input") or {}, "ok": None, "ui": None}
                tools[b["id"]] = t
                items.append(t)
    return items


async def chat(thread_id: int | None, message: str, model: str, ctx: dict | None):
    """Agent loop. Yields SSE-ready dict events."""
    if thread_id is None:
        thread_id = create_thread(message.strip().split("\n")[0] or "新对话")
    yield {"type": "thread", "id": thread_id}

    blocks = []
    ctx_text = _context_text(ctx)
    if ctx_text:
        blocks.append({"type": "text", "text": ctx_text})
    blocks.append({"type": "text", "text": message})
    _save(thread_id, "user", blocks, display=message)

    cli = llm.client()
    for _ in range(MAX_STEPS):
        messages = _api_messages(thread_id)
        try:
            async with cli.messages.stream(model=model, max_tokens=32000, system=_system(), tools=TOOLS,
                                           messages=messages) as stream:
                async for ev in stream:
                    if ev.type == "text":
                        yield {"type": "text", "t": ev.text}
                    elif ev.type == "content_block_start" and ev.content_block.type == "tool_use":
                        yield {"type": "tool_pending", "name": ev.content_block.name}
                final = await stream.get_final_message()
        except Exception as e:  # noqa: BLE001
            raise llm._friendly(e) from e

        content = [b.model_dump(exclude_none=True) for b in final.content]
        if final.stop_reason == "refusal":
            raise llm.LLMError("模型拒绝了该请求（refusal），可尝试换个说法或切换模型")
        tool_uses = [b for b in content if b.get("type") == "tool_use"]
        if final.stop_reason != "tool_use" or not tool_uses:
            _save(thread_id, "assistant", content)
            if final.stop_reason == "max_tokens":
                yield {"type": "text", "t": "\n\n> ⚠️ 输出达到长度上限被截断"}
            break

        for b in tool_uses:
            yield {"type": "tool_start", "id": b["id"], "name": b["name"], "input": b.get("input") or {}}

        async def run(b):
            out, ui, ok = await run_tool(b["name"], b.get("input") or {}, model)
            return b, out, ui, ok

        results, ui_map = [], {}
        for b, out, ui, ok in await asyncio.gather(*(run(b) for b in tool_uses)):
            res = {"type": "tool_result", "tool_use_id": b["id"], "content": out}
            if not ok:
                res["is_error"] = True
            results.append(res)
            ui_map[b["id"]] = {"ok": ok, "ui": ui, "error": None if ok else out}
            yield {"type": "tool_result", "id": b["id"], "ok": ok, "ui": ui, "error": None if ok else out}
        # Persist the assistant turn and its tool results together, so an abort never leaves a dangling tool_use.
        _save(thread_id, "assistant", content)
        _save(thread_id, "user", results, ui=ui_map)
    else:
        yield {"type": "text", "t": "\n\n> ⚠️ 工具调用步数过多，已停止"}

import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import llm
from .config import DEFAULT_MODELS, ROOT, llm_credentials
from .db import LIBRARY_STATUSES, db, get_settings, init_db, library_ids, log_event, paper_row, save_settings
from .services import assistant
from .services import ideas as ideas_svc
from .services import push, reader, related, research, trending
from .services.common import spawn

app = FastAPI(title="DailyPaper")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
init_db()

REACTIONS = ("must", "love", "insight", "doubt", "meh", "trash", "nope")


def _must_paper(pid: str) -> dict:
    p = reader.get_paper(pid)
    if not p:
        raise HTTPException(404, "论文不存在")
    return p


def _sse(gen):
    """Wrap a text generator as Server-Sent Events: {"t": chunk} ... {"done": true} | {"error": msg}."""
    async def body():
        try:
            async for chunk in gen:
                yield f"data: {json.dumps({'t': chunk}, ensure_ascii=False)}\n\n"
            yield "data: {\"done\": true}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(e) or e.__class__.__name__}, ensure_ascii=False)}\n\n"
    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _papers_by_ids(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    with db() as conn:
        rows = conn.execute(f"SELECT {LIST_COLS} FROM papers WHERE id IN ({','.join('?' * len(ids))})", ids).fetchall()
    return {r["id"]: _list_row(r) for r in rows}


# ---------------------------------------------------------------- settings & models

@app.get("/api/settings")
def read_settings():
    cred = llm_credentials()
    return {**get_settings(), "api_configured": bool(cred["auth_token"] or cred["api_key"]),
            "base_url": cred["base_url"] or "官方 api.anthropic.com"}


@app.put("/api/settings")
def write_settings(values: dict):
    return save_settings(values)


@app.get("/api/models")
def models():
    s = get_settings()
    return list(dict.fromkeys([*DEFAULT_MODELS, *s["custom_models"], s["push_model"], s["reader_model"]]))


@app.get("/api/models/remote")
async def remote_models():
    try:
        return await llm.list_remote_models()
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


class TestReq(BaseModel):
    model: str


@app.post("/api/models/test")
async def test_model(req: TestReq):
    t0 = time.time()
    try:
        text = await llm.complete(req.model, "回答尽量简短。", [{"role": "user", "content": "用一句中文打个招呼"}], 200)
    except llm.LLMError as e:
        raise HTTPException(502, str(e))
    return {"ok": True, "reply": text, "latency": round(time.time() - t0, 2)}


# ---------------------------------------------------------------- push (arXiv)

class PushReq(BaseModel):
    count: int | None = None
    days: int | None = None
    model: str | None = None


@app.post("/api/push")
async def start_push(req: PushReq):
    if push.job.running:
        raise HTTPException(409, "已有推送任务在运行")
    s = get_settings()
    count = max(1, min(req.count or s["push_count"], 100))
    days = max(1, min(req.days or s["push_days"], 30))
    spawn(push.run_push(count, days, req.model or s["push_model"]))
    await asyncio.sleep(0)
    return push.job.state()


@app.get("/api/push/status")
def push_status():
    return push.job.state()


@app.get("/api/digests")
def digests():
    with db() as conn:
        rows = conn.execute("SELECT * FROM digests ORDER BY id DESC LIMIT 100").fetchall()
    return [{**dict(r), "params": json.loads(r["params"]), "paper_ids": json.loads(r["paper_ids"])} for r in rows]


# ---------------------------------------------------------------- trending

class TrendReq(BaseModel):
    days: int | None = None
    count: int | None = None
    model: str | None = None


@app.post("/api/trending")
async def start_trending(req: TrendReq):
    if trending.job.running:
        raise HTTPException(409, "已有热榜任务在运行")
    s = get_settings()
    days = req.days or s["trend_days"]
    days = days if days in (3, 7, 30, 90) else 7
    count = max(5, min(req.count or s["trend_count"], 60))
    spawn(trending.run_trending(days, count, req.model or s["push_model"]))
    await asyncio.sleep(0)
    return trending.job.state()


@app.get("/api/trending/status")
def trending_status():
    return trending.job.state()


@app.get("/api/trends")
def trends():
    with db() as conn:
        rows = conn.execute("SELECT id, created_at, params FROM trends ORDER BY id DESC LIMIT 50").fetchall()
    return [{**dict(r), "params": json.loads(r["params"])} for r in rows]


@app.get("/api/trends/latest")
def trend_latest():
    with db() as conn:
        r = conn.execute("SELECT id FROM trends ORDER BY id DESC LIMIT 1").fetchone()
    return trend(r["id"]) if r else None


@app.get("/api/trends/{tid}")
def trend(tid: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM trends WHERE id = ?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404)
    items, topics = json.loads(r["items"]), json.loads(r["topics"])
    papers = _papers_by_ids(list({i["id"] for i in items} | {pid for t in topics for pid in t.get("paper_ids", [])}))
    return {
        "id": r["id"], "created_at": r["created_at"], "params": json.loads(r["params"]),
        "items": [{**papers[i["id"]], "heat": i["heat"], "buzz": i.get("buzz"), "hn": i.get("hn")}
                  for i in items if i["id"] in papers],
        "topics": [{**t, "papers": [papers[p] for p in t.get("paper_ids", []) if p in papers]} for t in topics],
    }


# ---------------------------------------------------------------- research topics

class TopicReq(BaseModel):
    query: str
    from_year: int | None = None
    model: str | None = None


def _topic(r, full=False) -> dict:
    d = {**dict(r), "params": json.loads(r["params"]), "papers": json.loads(r["papers"])}
    if full:
        info = _papers_by_ids([p["id"] for p in d["papers"]])
        lib = library_ids()
        d["papers"] = [{**info[p["id"]], **p, "in_library": p["id"] in lib} for p in d["papers"] if p["id"] in info]
    else:
        d["count"] = len(d.pop("papers"))
        d.pop("overview", None)
    return d


@app.post("/api/topics")
async def create_topic(req: TopicReq):
    if not req.query.strip():
        raise HTTPException(400, "请输入调研主题")
    model = req.model or get_settings()["reader_model"]
    tid = research.create_topic(req.query.strip(), req.from_year, model)
    spawn(research.run_research(tid, req.query.strip(), req.from_year, model))
    log_event("research", str(tid))
    return {"id": tid}


@app.get("/api/topics")
def topics():
    with db() as conn:
        rows = conn.execute("SELECT * FROM topics ORDER BY id DESC").fetchall()
    return [_topic(r) for r in rows]


@app.get("/api/topics/{tid}")
def topic(tid: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM topics WHERE id = ?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return _topic(r, full=True)


@app.delete("/api/topics/{tid}")
def delete_topic(tid: int):
    with db() as conn:
        conn.execute("DELETE FROM topics WHERE id = ?", (tid,))
    return {"ok": True}


# ---------------------------------------------------------------- papers

LIST_COLS = ("id, title, authors, abstract, categories, published, pdf_url, abs_url, status, reaction, score, "
             "reason, tldr, tags, digest_id, source, created_at, updated_at, analysis IS NOT NULL AS has_analysis")


def _list_row(r) -> dict:
    d = paper_row(r)
    d["has_analysis"] = bool(d["has_analysis"])
    return d


@app.get("/api/papers")
def list_papers(status: str | None = None, reaction: str | None = None, tag: str | None = None,
                q: str | None = None, digest_id: int | None = None, limit: int = Query(300, le=2000)):
    where, args = [], []
    if status:
        sts = status.split(",")
        where.append(f"status IN ({','.join('?' * len(sts))})")
        args += sts
    elif not digest_id:
        where.append("status != 'pool'")
    if reaction:
        rs = reaction.split(",")
        where.append(f"reaction IN ({','.join('?' * len(rs))})")
        args += rs
    if digest_id:
        where.append("digest_id = ?")
        args.append(digest_id)
    if tag:
        where.append("EXISTS (SELECT 1 FROM json_each(papers.tags) WHERE value = ?)")
        args.append(tag)
    if q:
        like = f"%{q}%"
        where.append("(title LIKE ? OR abstract LIKE ? OR tldr LIKE ? OR authors LIKE ? OR tags LIKE ? OR id LIKE ? "
                     "OR id IN (SELECT paper_id FROM notes WHERE content LIKE ?))")
        args += [like] * 7
    sql = f"SELECT {LIST_COLS} FROM papers"
    if where:
        sql += " WHERE " + " AND ".join(where)
    order = "score DESC, created_at DESC" if status == "inbox" else "updated_at DESC"
    sql += f" ORDER BY {order} LIMIT ?"
    with db() as conn:
        rows = conn.execute(sql, (*args, limit)).fetchall()
    return [_list_row(r) for r in rows]


@app.get("/api/papers/counts")
def counts():
    with db() as conn:
        rows = conn.execute("SELECT status, COUNT(*) c FROM papers GROUP BY status").fetchall()
        reacts = conn.execute(
            "SELECT reaction, COUNT(*) c FROM papers WHERE reaction IS NOT NULL GROUP BY reaction").fetchall()
        notes = conn.execute("SELECT COUNT(*) FROM notes WHERE TRIM(content) != ''").fetchone()[0]
    return {"status": {r["status"]: r["c"] for r in rows}, "reaction": {r["reaction"]: r["c"] for r in reacts},
            "notes": notes}


@app.get("/api/tags")
def tags():
    with db() as conn:
        rows = conn.execute(
            "SELECT value tag, COUNT(*) c FROM papers, json_each(papers.tags) "
            f"WHERE status IN ({','.join('?' * len(LIBRARY_STATUSES))}) GROUP BY value ORDER BY c DESC",
            LIBRARY_STATUSES).fetchall()
    return [dict(r) for r in rows]


class BulkReq(BaseModel):
    ids: list[str]
    status: str


@app.post("/api/papers/bulk-status")
def bulk_status(req: BulkReq):
    with db() as conn:
        conn.executemany("UPDATE papers SET status = ?, updated_at = ? WHERE id = ?",
                         [(req.status, time.time(), i) for i in req.ids])
    return {"ok": True, "n": len(req.ids)}


@app.get("/api/papers/{pid:path}/pdf")
async def paper_pdf(pid: str):
    p = _must_paper(pid)
    try:
        path = await reader.ensure_pdf(p)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"PDF 下载失败：{e}")
    return FileResponse(path, media_type="application/pdf")


@app.get("/api/papers/{pid:path}/related")
async def paper_related(pid: str, refresh: bool = False, model: str | None = None):
    p = _must_paper(pid)
    try:
        return await related.find_related(p, model or get_settings()["reader_model"], refresh)
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


@app.get("/api/papers/{pid:path}/ideas")
def paper_ideas(pid: str):
    with db() as conn:
        rows = conn.execute("SELECT i.* FROM ideas i JOIN idea_papers ip ON ip.idea_id = i.id "
                            "WHERE ip.paper_id = ? ORDER BY i.updated_at DESC", (pid,)).fetchall()
    return [ideas_svc.idea_dict(r) for r in rows]


class PaperPatch(BaseModel):
    status: str | None = None
    reaction: str | None = None
    tags: list[str] | None = None


@app.patch("/api/papers/{pid:path}")
def patch_paper(pid: str, patch: PaperPatch):
    _must_paper(pid)
    sets, args = [], []
    if patch.status is not None:
        sets.append("status = ?")
        args.append(patch.status)
    if "reaction" in patch.model_fields_set:
        if patch.reaction is not None and patch.reaction not in REACTIONS:
            raise HTTPException(400, "未知的表情")
        sets.append("reaction = ?")
        args.append(patch.reaction)
        log_event("react", pid)
    if patch.tags is not None:
        sets.append("tags = ?")
        args.append(json.dumps(patch.tags, ensure_ascii=False))
    if sets:
        with db() as conn:
            conn.execute(f"UPDATE papers SET {', '.join(sets)}, updated_at = ? WHERE id = ?",
                         (*args, time.time(), pid))
    if patch.status == "read":
        log_event("finish", pid)
    return _papers_by_ids([pid])[pid]


@app.delete("/api/papers/{pid:path}")
def delete_paper(pid: str):
    with db() as conn:
        for t, col in (("notes", "paper_id"), ("highlights", "paper_id"), ("chats", "paper_id"),
                       ("idea_papers", "paper_id"), ("related_cache", "paper_id"), ("papers", "id")):
            conn.execute(f"DELETE FROM {t} WHERE {col} = ?", (pid,))
    return {"ok": True}


class AddReq(BaseModel):
    arxiv: str


@app.post("/api/papers")
async def add_paper(req: AddReq):
    try:
        p = await reader.add_by_arxiv_id(req.arxiv)
    except llm.LLMError as e:
        raise HTTPException(404, str(e))
    return _papers_by_ids([p["id"]])[p["id"]]


@app.get("/api/papers/{pid:path}")
def get_paper(pid: str):
    p = _must_paper(pid)
    with db() as conn:
        note = conn.execute("SELECT content, updated_at FROM notes WHERE paper_id = ?", (pid,)).fetchone()
        hls = conn.execute("SELECT * FROM highlights WHERE paper_id = ? ORDER BY page, id", (pid,)).fetchall()
        chats = conn.execute("SELECT * FROM chats WHERE paper_id = ? ORDER BY id", (pid,)).fetchall()
    log_event("open", pid)
    return {**p, "note": dict(note) if note else {"content": "", "updated_at": None},
            "highlights": [dict(h) for h in hls], "chats": [dict(c) for c in chats]}


# ---------------------------------------------------------------- notes & highlights

class NoteReq(BaseModel):
    content: str


@app.put("/api/notes/{pid:path}")
def save_note(pid: str, req: NoteReq):
    _must_paper(pid)
    now = time.time()
    with db() as conn:
        conn.execute("INSERT INTO notes(paper_id, content, updated_at) VALUES(?,?,?) "
                     "ON CONFLICT(paper_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
                     (pid, req.content, now))
        conn.execute("UPDATE papers SET updated_at = ? WHERE id = ?", (now, pid))
    return {"ok": True, "updated_at": now}


@app.get("/api/notes")
def all_notes(q: str | None = None):
    sql = ("SELECT n.paper_id, n.content, n.updated_at, p.title, p.status, p.reaction, p.tags FROM notes n "
           "JOIN papers p ON p.id = n.paper_id WHERE TRIM(n.content) != ''")
    args = []
    if q:
        sql += " AND (n.content LIKE ? OR p.title LIKE ?)"
        args = [f"%{q}%"] * 2
    with db() as conn:
        rows = conn.execute(sql + " ORDER BY n.updated_at DESC", args).fetchall()
    return [{**dict(r), "tags": json.loads(r["tags"])} for r in rows]


class HighlightReq(BaseModel):
    paper_id: str
    text: str
    page: int | None = None
    comment: str = ""


@app.post("/api/highlights")
def add_highlight(req: HighlightReq):
    _must_paper(req.paper_id)
    with db() as conn:
        cur = conn.execute("INSERT INTO highlights(paper_id, text, page, comment, created_at) VALUES(?,?,?,?,?)",
                           (req.paper_id, req.text, req.page, req.comment, time.time()))
        row = conn.execute("SELECT * FROM highlights WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


class HighlightPatch(BaseModel):
    comment: str


@app.patch("/api/highlights/{hid}")
def patch_highlight(hid: int, req: HighlightPatch):
    with db() as conn:
        conn.execute("UPDATE highlights SET comment = ? WHERE id = ?", (req.comment, hid))
    return {"ok": True}


@app.delete("/api/highlights/{hid}")
def delete_highlight(hid: int):
    with db() as conn:
        conn.execute("DELETE FROM highlights WHERE id = ?", (hid,))
    return {"ok": True}


# ---------------------------------------------------------------- ideas

class IdeaReq(BaseModel):
    title: str = ""
    content: str = ""
    status: str = "seed"
    tags: list[str] = []
    paper_ids: list[str] = []


class IdeaPatch(BaseModel):
    title: str | None = None
    content: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    pinned: bool | None = None


def _idea_full(iid: int) -> dict:
    with db() as conn:
        r = conn.execute("SELECT * FROM ideas WHERE id = ?", (iid,)).fetchone()
        if not r:
            raise HTTPException(404, "想法不存在")
        pids = [x["paper_id"] for x in conn.execute("SELECT paper_id FROM idea_papers WHERE idea_id = ?", (iid,))]
        chats = conn.execute("SELECT * FROM idea_chats WHERE idea_id = ? ORDER BY id", (iid,)).fetchall()
    info = _papers_by_ids(pids)
    return {**ideas_svc.idea_dict(r), "papers": [info[p] for p in pids if p in info], "chats": [dict(c) for c in chats]}


@app.get("/api/ideas")
def list_ideas(q: str | None = None, status: str | None = None):
    sql = ("SELECT i.*, (SELECT COUNT(*) FROM idea_papers ip WHERE ip.idea_id = i.id) AS paper_count, "
           "(SELECT COUNT(*) FROM idea_chats c WHERE c.idea_id = i.id AND c.role = 'assistant') AS chat_count FROM ideas i")
    where, args = [], []
    if q:
        where.append("(i.title LIKE ? OR i.content LIKE ? OR i.tags LIKE ?)")
        args += [f"%{q}%"] * 3
    if status:
        where.append("i.status = ?")
        args.append(status)
    if where:
        sql += " WHERE " + " AND ".join(where)
    with db() as conn:
        rows = conn.execute(sql + " ORDER BY i.pinned DESC, i.updated_at DESC", args).fetchall()
    return [ideas_svc.idea_dict(r) for r in rows]


@app.post("/api/ideas")
def create_idea(req: IdeaReq):
    now = time.time()
    with db() as conn:
        cur = conn.execute("INSERT INTO ideas(title, content, status, tags, created_at, updated_at) VALUES(?,?,?,?,?,?)",
                           (req.title, req.content, req.status, json.dumps(req.tags, ensure_ascii=False), now, now))
        iid = cur.lastrowid
        conn.executemany("INSERT OR IGNORE INTO idea_papers(idea_id, paper_id) VALUES(?, ?)",
                         [(iid, p) for p in req.paper_ids])
    log_event("idea", str(iid))
    return _idea_full(iid)


@app.get("/api/ideas/{iid}")
def get_idea(iid: int):
    return _idea_full(iid)


@app.patch("/api/ideas/{iid}")
def patch_idea(iid: int, patch: IdeaPatch):
    vals = patch.model_dump(exclude_none=True)
    if "tags" in vals:
        vals["tags"] = json.dumps(vals["tags"], ensure_ascii=False)
    if "pinned" in vals:
        vals["pinned"] = int(vals["pinned"])
    if vals:
        vals["updated_at"] = time.time()
        with db() as conn:
            conn.execute(f"UPDATE ideas SET {', '.join(f'{k} = ?' for k in vals)} WHERE id = ?", (*vals.values(), iid))
    return _idea_full(iid)


@app.delete("/api/ideas/{iid}")
def delete_idea(iid: int):
    with db() as conn:
        for t, col in (("idea_papers", "idea_id"), ("idea_chats", "idea_id"), ("ideas", "id")):
            conn.execute(f"DELETE FROM {t} WHERE {col} = ?", (iid,))
    return {"ok": True}


class LinkReq(BaseModel):
    paper_id: str


@app.post("/api/ideas/{iid}/papers")
def link_paper(iid: int, req: LinkReq):
    _must_paper(req.paper_id)
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO idea_papers(idea_id, paper_id) VALUES(?, ?)", (iid, req.paper_id))
        conn.execute("UPDATE ideas SET updated_at = ? WHERE id = ?", (time.time(), iid))
    return _idea_full(iid)


@app.delete("/api/ideas/{iid}/papers/{pid:path}")
def unlink_paper(iid: int, pid: str):
    with db() as conn:
        conn.execute("DELETE FROM idea_papers WHERE idea_id = ? AND paper_id = ?", (iid, pid))
    return _idea_full(iid)


@app.delete("/api/ideas/{iid}/chats")
def clear_idea_chats(iid: int):
    with db() as conn:
        conn.execute("DELETE FROM idea_chats WHERE idea_id = ?", (iid,))
    return {"ok": True}


class IdeaAIReq(BaseModel):
    mode: str = "chat"
    message: str | None = None
    model: str | None = None


@app.post("/api/ai/idea/{iid}")
async def ai_idea(iid: int, req: IdeaAIReq):
    _idea_full(iid)
    return _sse(ideas_svc.stream_idea_ai(iid, req.model or get_settings()["reader_model"], req.mode, req.message))


# ---------------------------------------------------------------- assistant

class AssistantReq(BaseModel):
    message: str
    thread_id: int | None = None
    model: str | None = None
    context: dict | None = None


@app.post("/api/assistant/chat")
async def assistant_chat(req: AssistantReq):
    if not req.message.strip():
        raise HTTPException(400, "消息不能为空")
    gen = assistant.chat(req.thread_id, req.message.strip(), req.model or get_settings()["reader_model"], req.context)

    async def body():
        try:
            async for ev in gen:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            yield 'data: {"type": "done"}\n\n'
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'error': str(e) or e.__class__.__name__}, ensure_ascii=False)}\n\n"
    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/assistant/threads")
def assistant_threads():
    with db() as conn:
        rows = conn.execute("SELECT * FROM assistant_threads ORDER BY updated_at DESC LIMIT 200").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/assistant/threads/{tid}")
def assistant_thread(tid: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM assistant_threads WHERE id = ?", (tid,)).fetchone()
    if not r:
        raise HTTPException(404, "对话不存在")
    return {**dict(r), "items": assistant.thread_display(tid)}


@app.delete("/api/assistant/threads/{tid}")
def delete_assistant_thread(tid: int):
    with db() as conn:
        conn.execute("DELETE FROM assistant_messages WHERE thread_id = ?", (tid,))
        conn.execute("DELETE FROM assistant_threads WHERE id = ?", (tid,))
    return {"ok": True}


# ---------------------------------------------------------------- stats

@app.get("/api/stats")
def stats():
    now = datetime.now()
    week_ago = (now - timedelta(days=7)).timestamp()
    with db() as conn:
        days = [r["d"] for r in conn.execute(
            "SELECT DISTINCT date(ts, 'unixepoch', 'localtime') d FROM events "
            "WHERE kind IN ('open','finish','idea','react') ORDER BY d DESC LIMIT 400")]
        opened_week = conn.execute("SELECT COUNT(DISTINCT ref) FROM events WHERE kind = 'open' AND ts > ?",
                                   (week_ago,)).fetchone()[0]
        finished_week = conn.execute("SELECT COUNT(DISTINCT ref) FROM events WHERE kind = 'finish' AND ts > ?",
                                     (week_ago,)).fetchone()[0]
        ideas_total = conn.execute("SELECT COUNT(*) FROM ideas").fetchone()[0]
        ideas_week = conn.execute("SELECT COUNT(*) FROM ideas WHERE created_at > ?", (week_ago,)).fetchone()[0]
        library = conn.execute(
            f"SELECT COUNT(*) FROM papers WHERE status IN ({','.join('?' * len(LIBRARY_STATUSES))})",
            LIBRARY_STATUSES).fetchone()[0]
        inbox = conn.execute("SELECT COUNT(*) FROM papers WHERE status = 'inbox'").fetchone()[0]
        reacts = {r["reaction"]: r["c"] for r in conn.execute(
            "SELECT reaction, COUNT(*) c FROM papers WHERE reaction IS NOT NULL GROUP BY reaction")}
        heat = {r["d"]: r["c"] for r in conn.execute(
            "SELECT date(ts, 'unixepoch', 'localtime') d, COUNT(*) c FROM events "
            "WHERE ts > ? GROUP BY d", ((now - timedelta(days=84)).timestamp(),))}
    streak, d = 0, now.date()
    dayset = set(days)
    if d.isoformat() not in dayset:
        d -= timedelta(days=1)  # today not yet active: streak still counts through yesterday
    while d.isoformat() in dayset:
        streak += 1
        d -= timedelta(days=1)
    return {"streak": streak, "opened_week": opened_week, "finished_week": finished_week,
            "ideas_total": ideas_total, "ideas_week": ideas_week, "library": library, "inbox": inbox,
            "reactions": reacts, "heatmap": heat}


# ---------------------------------------------------------------- reader AI streams

class ModelReq(BaseModel):
    model: str | None = None


@app.post("/api/ai/analyze/{pid:path}")
async def ai_analyze(pid: str, req: ModelReq):
    p = _must_paper(pid)
    return _sse(reader.stream_analysis(p, req.model or get_settings()["reader_model"]))


class ChatReq(BaseModel):
    paper_id: str
    question: str
    quote: str | None = None
    model: str | None = None


@app.post("/api/ai/chat")
async def ai_chat(req: ChatReq):
    p = _must_paper(req.paper_id)
    return _sse(reader.stream_chat(p, req.model or get_settings()["reader_model"], req.question, req.quote))


@app.delete("/api/ai/chat/{pid:path}")
def clear_chat(pid: str):
    with db() as conn:
        conn.execute("DELETE FROM chats WHERE paper_id = ?", (pid,))
    return {"ok": True}


class ExplainReq(BaseModel):
    text: str
    mode: str = "explain"
    paper_id: str | None = None
    model: str | None = None


@app.post("/api/ai/explain")
async def ai_explain(req: ExplainReq):
    p = reader.get_paper(req.paper_id) if req.paper_id else None
    return _sse(reader.stream_explain(req.model or get_settings()["reader_model"], req.text, req.mode, p))


@app.post("/api/ai/note-draft/{pid:path}")
async def ai_note_draft(pid: str, req: ModelReq):
    p = _must_paper(pid)
    return _sse(reader.stream_note_draft(p, req.model or get_settings()["reader_model"]))


# ---------------------------------------------------------------- frontend (production build)

DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full:path}")
    def spa(full: str):
        f = DIST / full
        if full and f.is_file() and Path(f).resolve().is_relative_to(DIST.resolve()):
            return FileResponse(f)
        return FileResponse(DIST / "index.html")

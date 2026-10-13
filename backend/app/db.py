import json
import sqlite3
import time
from contextlib import contextmanager

from .config import DB_PATH, DEFAULT_SETTINGS

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    abstract TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT '[]',
    published TEXT,
    pdf_url TEXT,
    abs_url TEXT,
    -- pool: seen in trending/research/related but not in library
    status TEXT NOT NULL DEFAULT 'inbox',   -- inbox | pool | later | reading | read | archived | ignored
    starred INTEGER NOT NULL DEFAULT 0,     -- legacy, superseded by reaction
    reaction TEXT,                          -- must | love | insight | doubt | meh | trash | nope
    score REAL,
    reason TEXT,
    tldr TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    analysis TEXT,
    digest_id INTEGER,
    source TEXT,                            -- push | trending | research | related | manual
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    params TEXT NOT NULL,
    paper_ids TEXT NOT NULL,
    candidates INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes (
    paper_id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    text TEXT NOT NULL,
    page INTEGER,
    comment TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    params TEXT NOT NULL,
    items TEXT NOT NULL,        -- [{id, score, heat, buzz, hn}]
    topics TEXT NOT NULL        -- [{emoji, title, summary, paper_ids, question}]
);
CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'running',   -- running | done | error
    overview TEXT,
    papers TEXT NOT NULL DEFAULT '[]',        -- [{id, role, note, relevance}]
    params TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'seed',      -- seed | growing | formed | doing | shelved
    tags TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS idea_papers (
    idea_id INTEGER NOT NULL,
    paper_id TEXT NOT NULL,
    PRIMARY KEY (idea_id, paper_id)
);
CREATE TABLE IF NOT EXISTS idea_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    mode TEXT,
    model TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS related_cache (
    paper_id TEXT PRIMARY KEY,
    items TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT
);
CREATE TABLE IF NOT EXISTS assistant_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS assistant_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,        -- API content blocks, stored exactly as sent/received
    display TEXT,                 -- user-typed text (without injected context)
    ui TEXT,                      -- {tool_use_id: {ok, ui, error}} for tool_result turns
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_amsg_thread ON assistant_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_highlights_paper ON highlights(paper_id);
CREATE INDEX IF NOT EXISTS idx_chats_paper ON chats(paper_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
"""

# Columns added after v0.1; applied to existing databases on startup.
MIGRATIONS = {
    "papers": {"reaction": "TEXT", "source": "TEXT"},
}

JSON_FIELDS = ("authors", "categories", "tags")

LIKED_REACTIONS = ("must", "love", "insight")
DISLIKED_REACTIONS = ("trash", "nope")
LIBRARY_STATUSES = ("later", "reading", "read", "archived")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript(SCHEMA)
        for table, cols in MIGRATIONS.items():
            have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for col, typ in cols.items():
                if col not in have:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        # v0.1 stars become 🤩
        conn.execute("UPDATE papers SET reaction = 'love' WHERE starred = 1 AND reaction IS NULL")


def paper_row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for f in JSON_FIELDS:
        if f in d:
            d[f] = json.loads(d[f] or "[]")
    d.pop("starred", None)
    return d


def get_settings() -> dict:
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    s = dict(DEFAULT_SETTINGS)
    s.update({r["key"]: json.loads(r["value"]) for r in rows})
    return s


def save_settings(values: dict) -> dict:
    with db() as conn:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO settings(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (k, json.dumps(v, ensure_ascii=False)),
                )
    return get_settings()


PAPER_COLS = ["id", "title", "authors", "abstract", "categories", "published", "pdf_url", "abs_url"]
EXTRA_COLS = ["score", "reason", "tldr", "tags", "digest_id", "source"]


def upsert_paper(p: dict, status: str = "pool", overwrite: bool = False, **extra) -> None:
    """Insert a paper, or enrich an existing one.

    Existing rows: AI fields are filled when empty (or always, with overwrite=True), and a
    'pool' paper is promoted to `status` — papers already in the library or inbox keep theirs."""
    now = time.time()
    enc = lambda c, v: json.dumps(v or [], ensure_ascii=False) if c in JSON_FIELDS else v  # noqa: E731
    with db() as conn:
        cur = conn.execute("SELECT * FROM papers WHERE id = ?", (p["id"],)).fetchone()
        if cur is None:
            cols = PAPER_COLS + [c for c in EXTRA_COLS if c in extra] + ["status", "created_at", "updated_at"]
            vals = [enc(c, p.get(c)) for c in PAPER_COLS] + [enc(c, extra[c]) for c in EXTRA_COLS if c in extra]
            conn.execute(f"INSERT INTO papers({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                         (*vals, status, now, now))
            return
        sets, args = [], []
        for c in EXTRA_COLS:
            v = extra.get(c)
            if v is None or v == []:
                continue
            empty = cur[c] in (None, "", "[]")
            if overwrite or empty:
                sets.append(f"{c} = ?")
                args.append(enc(c, v))
        if cur["status"] == "pool" and status != "pool":
            sets.append("status = ?")
            args.append(status)
        if sets:
            conn.execute(f"UPDATE papers SET {', '.join(sets)} WHERE id = ?", (*args, p["id"]))


def log_event(kind: str, ref: str | None = None) -> None:
    with db() as conn:
        conn.execute("INSERT INTO events(ts, kind, ref) VALUES(?, ?, ?)", (time.time(), kind, ref))


def library_ids() -> set[str]:
    with db() as conn:
        rows = conn.execute(
            f"SELECT id FROM papers WHERE status IN ({','.join('?' * len(LIBRARY_STATUSES))})",
            LIBRARY_STATUSES).fetchall()
    return {r["id"] for r in rows}

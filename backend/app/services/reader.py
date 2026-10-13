"""Reader AI: full-text extraction, structured analysis, chat, explain/translate, note drafting."""

import time

import httpx
import pymupdf

from .. import arxiv, llm
from ..config import PDF_DIR, TEXT_DIR
from ..db import db, get_settings, paper_row, upsert_paper

# ---------------------------------------------------------------- full text

async def ensure_text(paper: dict) -> str:
    """Download the PDF once and cache extracted text with page markers."""
    pid = paper["id"]
    txt_path = TEXT_DIR / f"{pid.replace('/', '_')}.txt"
    if txt_path.exists():
        return txt_path.read_text()
    pdf_path = await ensure_pdf(paper)
    doc = pymupdf.open(pdf_path)
    text = "\n\n".join(f"[第 {i + 1} 页]\n{page.get_text()}" for i, page in enumerate(doc))
    doc.close()
    txt_path.write_text(text)
    return text


async def ensure_pdf(paper: dict):
    pdf_path = PDF_DIR / f"{paper['id'].replace('/', '_')}.pdf"
    if not pdf_path.exists():
        async with httpx.AsyncClient(timeout=120, follow_redirects=True,
                                     headers={"User-Agent": "DailyPaper/0.1"}) as c:
            r = await c.get(paper["pdf_url"] or f"https://arxiv.org/pdf/{paper['id']}")
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                raise llm.LLMError("下载的文件不是 PDF")
            pdf_path.write_bytes(r.content)
    return pdf_path


def get_paper(pid: str) -> dict | None:
    with db() as conn:
        return paper_row(conn.execute("SELECT * FROM papers WHERE id = ?", (pid,)).fetchone())


def _paper_system(paper: dict, fulltext: str, role: str) -> list:
    # Full text sits in a cached block so follow-up chat turns reuse it cheaply.
    header = (f"标题：{paper['title']}\n作者：{', '.join(paper['authors'])}\n"
              f"arXiv：{paper['id']}\n\n论文全文（由 PDF 提取，可能有排版噪声）：\n")
    return [
        {"type": "text", "text": role},
        {"type": "text", "text": header + fulltext, "cache_control": {"type": "ephemeral"}},
    ]


READER_ROLE = """你是一位耐心、严谨的科研导师，正在帮助用户精读一篇论文。
- 默认用中文回答，专业术语可保留英文
- 回答要基于论文内容；引用论文时注明页码（如"第 3 页"）；论文未提及的内容要明确说明是你的补充
- 数学公式使用 LaTeX（行内 $...$，独立 $$...$$）
- 使用 Markdown 组织回答，简洁有条理"""

ANALYSIS_PROMPT = """请对这篇论文做一份结构化中文精读笔记，使用以下 Markdown 结构：

## 一句话总结
## 研究问题与动机
## 核心方法
（关键思路、模型/算法设计，必要时给出关键公式）
## 实验与结果
（数据集、基线、主要结论与关键数字）
## 创新点
## 局限与可改进之处
## 对我的启发
（结合用户研究兴趣，可借鉴之处与可延伸的研究方向）"""


async def stream_analysis(paper: dict, model: str):
    fulltext = await ensure_text(paper)
    s = get_settings()
    prompt = ANALYSIS_PROMPT
    if s["interest"].strip():
        prompt += f"\n\n用户研究兴趣：{s['interest'].strip()}"
    parts = []
    async for t in llm.stream_text(model, _paper_system(paper, fulltext, READER_ROLE),
                                   [{"role": "user", "content": prompt}]):
        parts.append(t)
        yield t
    with db() as conn:
        conn.execute("UPDATE papers SET analysis = ?, updated_at = ? WHERE id = ?",
                     ("".join(parts), time.time(), paper["id"]))


async def stream_chat(paper: dict, model: str, question: str, quote: str | None):
    fulltext = await ensure_text(paper)
    with db() as conn:
        history = conn.execute(
            "SELECT role, content FROM chats WHERE paper_id = ? ORDER BY id", (paper["id"],)).fetchall()
    content = f"关于论文中的这段内容：\n> {quote}\n\n{question}" if quote else question
    messages = [{"role": r["role"], "content": r["content"]} for r in history[-20:]]
    messages.append({"role": "user", "content": content})
    parts = []
    async for t in llm.stream_text(model, _paper_system(paper, fulltext, READER_ROLE), messages):
        parts.append(t)
        yield t
    now = time.time()
    with db() as conn:
        conn.execute("INSERT INTO chats(paper_id, role, content, model, created_at) VALUES(?,?,?,?,?)",
                     (paper["id"], "user", content, model, now))
        conn.execute("INSERT INTO chats(paper_id, role, content, model, created_at) VALUES(?,?,?,?,?)",
                     (paper["id"], "assistant", "".join(parts), model, now))


async def stream_explain(model: str, text: str, mode: str, paper: dict | None):
    ctx = f"（出自论文《{paper['title']}》）" if paper else ""
    if mode == "translate":
        prompt = f"将下面这段论文内容{ctx}翻译成准确、通顺的中文学术语言，公式保留 LaTeX，只输出译文：\n\n{text}"
    else:
        prompt = (f"用中文解释下面这段论文内容{ctx}：先说清它在讲什么，再解释其中的关键概念/符号/公式，"
                  f"必要时举例。简洁有条理，公式用 LaTeX：\n\n{text}")
    async for t in llm.stream_text(model, "你是一位擅长讲解的科研助手。", [{"role": "user", "content": prompt}],
                                   max_tokens=8000):
        yield t


async def stream_note_draft(paper: dict, model: str):
    with db() as conn:
        hls = conn.execute("SELECT text, page, comment FROM highlights WHERE paper_id = ? ORDER BY page, id",
                           (paper["id"],)).fetchall()
        chats = conn.execute("SELECT role, content FROM chats WHERE paper_id = ? ORDER BY id",
                             (paper["id"],)).fetchall()
        note = conn.execute("SELECT content FROM notes WHERE paper_id = ?", (paper["id"],)).fetchone()
    material = [f"论文：{paper['title']}\n摘要：{paper['abstract']}"]
    if paper.get("analysis"):
        material.append("AI 精读：\n" + paper["analysis"])
    if hls:
        material.append("用户高亮：\n" + "\n".join(
            f"- (p{h['page']}) {h['text']}" + (f"  —— 批注：{h['comment']}" if h["comment"] else "") for h in hls))
    if chats:
        material.append("用户与 AI 的问答：\n" + "\n".join(f"[{c['role']}] {c['content'][:1500]}" for c in chats[-12:]))
    if note and note["content"].strip():
        material.append("用户已有笔记：\n" + note["content"])
    prompt = ("根据以下材料，为用户整理一份中文 Markdown 阅读笔记。要求：以用户的高亮、批注和提问为重点，"
              "体现用户关注点；保留已有笔记中的观点；结构清晰（核心贡献 / 方法要点 / 关键结果 / 我的思考 / 待解决问题）；"
              "不要编造论文中没有的信息。直接输出笔记正文。\n\n" + "\n\n---\n\n".join(material))
    async for t in llm.stream_text(model, READER_ROLE, [{"role": "user", "content": prompt}]):
        yield t


async def add_by_arxiv_id(raw: str) -> dict:
    pid = arxiv.normalize_id(raw)
    existing = get_paper(pid)
    if existing:
        if existing["status"] in ("pool", "inbox", "ignored"):
            with db() as conn:
                conn.execute("UPDATE papers SET status = 'later', updated_at = ? WHERE id = ?", (time.time(), pid))
            return get_paper(pid)
        return existing
    p = await arxiv.fetch_by_id(pid)
    if not p:
        raise llm.LLMError(f"arXiv 上未找到 {pid}")
    upsert_paper(p, status="later", source="manual")
    return get_paper(p["id"])

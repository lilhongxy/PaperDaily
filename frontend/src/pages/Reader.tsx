import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Sparkles, MessageSquare, NotebookPen, Highlighter, Loader2, Send, Trash2, RefreshCw, Wand2, Eye, Pencil, X, ExternalLink, Network, Lightbulb,
} from "lucide-react";
import { api, streamAI, STATUS_LABEL, type ChatMsg, type PaperDetail, type Status } from "../api";
import ReactionBar from "../components/Reactions";
import { RelatedPanel, PaperIdeasPanel } from "../components/ReaderPanels";
import { useApp } from "../store";
import Markdown from "../components/Markdown";
import PdfViewer, { type SelAction } from "../components/PdfViewer";

type Tab = "analysis" | "chat" | "note" | "highlights" | "related" | "ideas";

export default function ReaderPage() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { model, quickIdea, notify } = useApp();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [tab, setTab] = useState<Tab>((sp.get("tab") as Tab) || "analysis");
  const [jump, setJump] = useState<{ page: number; n: number } | null>(null);

  // analysis
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  // chat
  const [chats, setChats] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [chatting, setChatting] = useState(false);
  // note
  const [note, setNote] = useState("");
  const [noteMode, setNoteMode] = useState<"edit" | "preview">("edit");
  const [noteSaved, setNoteSaved] = useState<"saved" | "dirty" | "saving">("saved");
  const [drafting, setDrafting] = useState(false);
  // popup explain/translate
  const [pop, setPop] = useState<{ title: string; text: string; loading: boolean; source: string } | null>(null);
  const [err, setErr] = useState("");

  const abort = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<number>(undefined);
  const pdfUrl = api.pdfUrl(id);

  const load = async () => {
    const p = await api.paper(id);
    setPaper(p);
    setAnalysis(p.analysis || "");
    setChats(p.chats);
    setNote(p.note.content);
    if (p.status === "inbox" || p.status === "later" || p.status === "pool") {
      const u = await api.patchPaper(id, { status: "reading" });
      setPaper((x) => (x ? { ...x, status: u.status } : x));
    }
  };

  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, [id]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats]);

  const fail = (e: unknown) => {
    if ((e as Error).name !== "AbortError") setErr((e as Error).message);
  };

  const runAnalysis = async () => {
    setErr("");
    setAnalyzing(true);
    setAnalysis("");
    abort.current = new AbortController();
    try {
      await streamAI(`/api/ai/analyze/${encodeURIComponent(id)}`, { model }, (_, full) => setAnalysis(full), abort.current.signal);
    } catch (e) {
      fail(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async (q = question, qt = quote) => {
    if (!q.trim() || chatting) return;
    setErr("");
    setQuestion("");
    setQuote(null);
    const userMsg: ChatMsg = { role: "user", content: qt ? `关于论文中的这段内容：\n> ${qt}\n\n${q}` : q };
    setChats((c) => [...c, userMsg, { role: "assistant", content: "", model }]);
    setChatting(true);
    abort.current = new AbortController();
    try {
      await streamAI(
        "/api/ai/chat",
        { paper_id: id, question: q, quote: qt, model },
        (_, full) => setChats((c) => [...c.slice(0, -1), { role: "assistant", content: full, model }]),
        abort.current.signal,
      );
    } catch (e) {
      fail(e);
      setChats((c) => c.slice(0, -2));
    } finally {
      setChatting(false);
    }
  };

  const updateNote = (v: string) => {
    setNote(v);
    setNoteSaved("dirty");
    clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(async () => {
      setNoteSaved("saving");
      await api.saveNote(id, v);
      setNoteSaved("saved");
    }, 800);
  };

  const appendToNote = (text: string) => {
    const v = note.trimEnd() + (note.trim() ? "\n\n" : "") + text;
    updateNote(v);
  };

  const draftNote = async () => {
    if (note.trim() && !confirm("AI 将基于精读、高亮和对话生成笔记，并替换当前笔记内容（原笔记观点会被参考保留）。继续？")) return;
    setErr("");
    setDrafting(true);
    setNoteMode("preview");
    const old = note;
    abort.current = new AbortController();
    try {
      const full = await streamAI(`/api/ai/note-draft/${encodeURIComponent(id)}`, { model }, (_, f) => setNote(f), abort.current.signal);
      updateNote(full);
    } catch (e) {
      fail(e);
      setNote(old);
    } finally {
      setDrafting(false);
    }
  };

  const onSelection = async (action: SelAction, text: string, page: number | null) => {
    if (action === "highlight") {
      const h = await api.addHighlight({ paper_id: id, text, page });
      setPaper((p) => (p ? { ...p, highlights: [...p.highlights, h] } : p));
      return;
    }
    if (action === "idea") {
      quickIdea({ paperId: id, paperTitle: paper?.title, text });
      return;
    }
    if (action === "ask") {
      setQuote(text);
      setTab("chat");
      return;
    }
    setPop({ title: action === "explain" ? "解释" : "翻译", text: "", loading: true, source: text });
    try {
      await streamAI("/api/ai/explain", { text, mode: action, paper_id: id, model }, (_, full) =>
        setPop((p) => (p ? { ...p, text: full } : p)),
      );
    } catch (e) {
      setPop((p) => (p ? { ...p, text: `❌ ${(e as Error).message}` } : p));
    } finally {
      setPop((p) => (p ? { ...p, loading: false } : p));
    }
  };

  const setStatus = async (s: Status) => {
    const u = await api.patchPaper(id, { status: s });
    setPaper((p) => (p ? { ...p, status: u.status } : p));
  };
  const react = async (r: PaperDetail["reaction"]) => {
    const u = await api.patchPaper(id, { reaction: r });
    setPaper((p) => (p ? { ...p, reaction: u.reaction } : p));
  };
  const editTags = async () => {
    const v = prompt("编辑标签（逗号分隔）", paper?.tags.join(", "));
    if (v == null) return;
    const u = await api.patchPaper(id, { tags: v.split(/[,，]/).map((x) => x.trim()).filter(Boolean) });
    setPaper((p) => (p ? { ...p, tags: u.tags } : p));
  };

  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-stone-500">
        <Loader2 className="mr-2 animate-spin" size={16} /> 加载中…
      </div>
    );
  }

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode, badge?: number) => (
    <button
      onClick={() => setTab(t)}
      className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] ${tab === t ? "border-brand font-medium text-brand" : "border-transparent text-stone-500 hover:text-stone-800"}`}
    >
      {icon}
      {label}
      {!!badge && <span className="rounded-full bg-paper-2 px-1.5 text-[10px] text-stone-500">{badge}</span>}
    </button>
  );

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-[1.15] border-r border-line">
        <PdfViewer url={pdfUrl} highlights={paper.highlights} onSelection={onSelection} jumpTo={jump} />
      </div>

      <div className="flex min-w-[440px] flex-1 flex-col bg-white/80">
        {/* header */}
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-start gap-2">
            <button onClick={() => navigate(-1)} className="btn btn-ghost !p-1 mt-0.5" title="返回">
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="title-serif text-[16px] font-bold leading-snug text-ink">{paper.title}</h1>
              <p className="mt-0.5 truncate text-xs text-stone-500">
                {paper.authors.join(", ")} · {paper.id}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <ReactionBar value={paper.reaction} onChange={react} size="sm" />
            <select value={paper.status} onChange={(e) => setStatus(e.target.value as Status)} className="rounded-full border border-line bg-white px-2 py-0.5 text-xs">
              {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => s !== "pool").map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {paper.tags.map((t) => (
              <span key={t} className="chip">
                #{t}
              </span>
            ))}
            <button onClick={editTags} className="chip hover:bg-brand-soft">
              ✎ 标签
            </button>
            <a href={paper.abs_url} target="_blank" rel="noreferrer" className="ml-auto text-stone-400 hover:text-brand">
              <ExternalLink size={13} />
            </a>
          </div>
        </div>

        <div className="flex overflow-x-auto border-b border-line px-2">
          {tabBtn("analysis", "AI 精读", <Sparkles size={14} />)}
          {tabBtn("chat", "对话", <MessageSquare size={14} />, chats.filter((c) => c.role === "user").length)}
          {tabBtn("note", "笔记", <NotebookPen size={14} />)}
          {tabBtn("highlights", "高亮", <Highlighter size={14} />, paper.highlights.length)}
          {tabBtn("related", "相关", <Network size={14} />)}
          {tabBtn("ideas", "灵感", <Lightbulb size={14} />)}
        </div>

        {err && (
          <div className="flex items-start gap-2 bg-red-50 px-4 py-2 text-xs text-red-700">
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr("")}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* body */}
        <div className="relative min-h-0 flex-1">
          {tab === "analysis" && (
            <div className="h-full overflow-y-auto p-5">
              {!analysis && !analyzing && (
                <div className="space-y-4">
                  {paper.tldr && <p className="rounded-lg bg-brand-soft p-3 text-sm text-ink">💡 {paper.tldr}</p>}
                  <div>
                    <h3 className="mb-1 text-xs font-medium text-stone-400">摘要</h3>
                    <p className="text-sm leading-relaxed text-stone-700">{paper.abstract}</p>
                  </div>
                  <button onClick={runAnalysis} className="btn btn-fun w-full justify-center !rounded-xl !py-2.5">
                    <Sparkles size={15} /> AI 全文精读（{model}）
                  </button>
                  <p className="text-center text-xs text-stone-400">将下载 PDF 全文，生成结构化中文精读笔记</p>
                </div>
              )}
              {(analysis || analyzing) && (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    {analyzing ? (
                      <>
                        <span className="flex items-center gap-1.5 text-xs text-stone-500">
                          <Loader2 size={13} className="animate-spin" /> 正在精读…
                        </span>
                        <button onClick={() => abort.current?.abort()} className="btn btn-ghost ml-auto text-xs">
                          停止
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { appendToNote(analysis); setTab("note"); }} className="btn btn-outline text-xs">
                          <NotebookPen size={13} /> 加入笔记
                        </button>
                        <button onClick={runAnalysis} className="btn btn-ghost ml-auto text-xs">
                          <RefreshCw size={13} /> 重新生成
                        </button>
                      </>
                    )}
                  </div>
                  <Markdown>{analysis || " "}</Markdown>
                </>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="flex h-full flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {chats.length === 0 && (
                  <div className="space-y-2 pt-6 text-center text-sm text-stone-400">
                    <p>基于论文全文提问；也可以在 PDF 中选中文字后点「提问」。</p>
                    <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                      {["这篇论文最核心的创新是什么？", "方法部分的关键公式怎么理解？", "实验设置有什么潜在问题？", "和相关工作相比有什么优劣？"].map((q) => (
                        <button key={q} onClick={() => ask(q, null)} className="chip !py-1 hover:bg-brand-soft hover:text-brand">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chats.map((c, i) => (
                  <div key={i} className={c.role === "user" ? "flex justify-end" : ""}>
                    {c.role === "user" ? (
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2 text-sm text-white">{c.content}</div>
                    ) : (
                      <div className="group">
                        {c.content ? <Markdown>{c.content}</Markdown> : <Loader2 size={15} className="animate-spin text-stone-400" />}
                        {c.content && !(chatting && i === chats.length - 1) && (
                          <div className="mt-1 flex gap-2 text-[11px] text-stone-400 opacity-0 transition group-hover:opacity-100">
                            <span>{c.model}</span>
                            <button className="hover:text-brand" onClick={() => appendToNote(c.content)}>
                              + 加入笔记
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>
              <div className="border-t border-line p-3">
                {quote && (
                  <div className="mb-2 flex items-start gap-2 rounded-md border-l-4 border-amber-300 bg-amber-50 px-2 py-1 text-xs text-stone-600">
                    <span className="line-clamp-3 flex-1">{quote}</span>
                    <button onClick={() => setQuote(null)}>
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        ask();
                      }
                    }}
                    rows={2}
                    placeholder="提问… (Enter 发送，Shift+Enter 换行)"
                    className="input flex-1 resize-none"
                  />
                  <div className="flex flex-col gap-1">
                    {chatting ? (
                      <button onClick={() => abort.current?.abort()} className="btn btn-outline !px-2.5">
                        停止
                      </button>
                    ) : (
                      <button onClick={() => ask()} className="btn btn-primary !px-2.5">
                        <Send size={15} />
                      </button>
                    )}
                    {chats.length > 0 && !chatting && (
                      <button
                        onClick={async () => {
                          if (!confirm("清空本论文的对话记录？")) return;
                          await api.clearChat(id);
                          setChats([]);
                        }}
                        className="btn btn-ghost !px-2.5"
                        title="清空对话"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "note" && (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
                <button onClick={() => setNoteMode("edit")} className={`btn btn-ghost !px-2 !py-1 text-xs ${noteMode === "edit" ? "!bg-paper-2" : ""}`}>
                  <Pencil size={13} /> 编辑
                </button>
                <button onClick={() => setNoteMode("preview")} className={`btn btn-ghost !px-2 !py-1 text-xs ${noteMode === "preview" ? "!bg-paper-2" : ""}`}>
                  <Eye size={13} /> 预览
                </button>
                <button onClick={draftNote} disabled={drafting} className="btn btn-ghost !px-2 !py-1 text-xs text-indigo-600">
                  {drafting ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} AI 整理笔记
                </button>
                <span className="ml-auto text-[11px] text-stone-400">
                  {noteSaved === "saved" ? "已保存" : noteSaved === "saving" ? "保存中…" : "未保存"}
                </span>
              </div>
              {noteMode === "edit" && !drafting ? (
                <textarea
                  value={note}
                  onChange={(e) => updateNote(e.target.value)}
                  placeholder={"在这里写笔记，支持 Markdown 与 LaTeX 公式（$...$）。\n\n提示：可从 AI 精读、对话、高亮一键加入笔记，或点击「AI 整理笔记」自动生成初稿。"}
                  className="h-full w-full flex-1 resize-none p-4 font-mono text-[13px] leading-relaxed outline-none"
                />
              ) : (
                <div className="flex-1 overflow-y-auto p-5">
                  <Markdown>{note || "*（空）*"}</Markdown>
                </div>
              )}
            </div>
          )}

          {tab === "highlights" && (
            <div className="h-full overflow-y-auto p-4">
              {paper.highlights.length === 0 && <p className="pt-6 text-center text-sm text-stone-400">在 PDF 中选中文字，点击「高亮」即可保存。</p>}
              <div className="space-y-3">
                {paper.highlights.map((h) => (
                  <div key={h.id} className="group rounded-lg border border-line p-3">
                    <button
                      onClick={() => h.page && setJump({ page: h.page, n: Date.now() })}
                      className="block border-l-4 border-yellow-300 pl-2 text-left text-sm text-stone-700 hover:text-stone-900"
                    >
                      {h.text}
                    </button>
                    <input
                      defaultValue={h.comment}
                      placeholder="添加批注…"
                      onBlur={(e) => e.target.value !== h.comment && api.patchHighlight(h.id, e.target.value)}
                      className="mt-2 w-full rounded border-0 bg-paper-2 px-2 py-1 text-xs outline-none focus:bg-white focus:ring-1 focus:ring-brand/20"
                    />
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-stone-400">
                      {h.page && <span>第 {h.page} 页</span>}
                      <button className="hover:text-brand" onClick={() => appendToNote(`> ${h.text}${h.page ? ` (p${h.page})` : ""}${h.comment ? `\n\n${h.comment}` : ""}`)}>
                        + 加入笔记
                      </button>
                      <button className="hover:text-brand" onClick={() => { setQuote(h.text); setTab("chat"); }}>
                        提问
                      </button>
                      <button
                        className="ml-auto opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                        onClick={async () => {
                          await api.deleteHighlight(h.id);
                          setPaper((p) => (p ? { ...p, highlights: p.highlights.filter((x) => x.id !== h.id) } : p));
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "related" && <RelatedPanel paperId={id} />}
          {tab === "ideas" && <PaperIdeasPanel paperId={id} paperTitle={paper.title} />}

          {pop && (
            <div className="absolute inset-x-3 bottom-3 z-10 max-h-[60%] overflow-y-auto rounded-xl border border-line bg-white p-4 shadow-xl">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold">{pop.title}</span>
                {pop.loading && <Loader2 size={13} className="animate-spin text-stone-400" />}
                <div className="ml-auto flex gap-1">
                  {!pop.loading && (
                    <button
                      className="btn btn-ghost !px-2 !py-0.5 text-xs"
                      onClick={() => {
                        appendToNote(`> ${pop.source}\n\n${pop.text}`);
                        notify("📝 已加入笔记");
                      }}
                    >
                      + 加入笔记
                    </button>
                  )}
                  <button className="btn btn-ghost !p-1" onClick={() => setPop(null)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
              <p className="mb-2 line-clamp-3 border-l-4 border-line pl-2 text-xs text-stone-500">{pop.source}</p>
              <Markdown>{pop.text || " "}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

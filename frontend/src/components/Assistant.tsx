import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, Send, Square, Check, X, ChevronDown, Plus, Trash2, Maximize2, BookOpen } from "lucide-react";
import {
  api, assistantApi, streamEvents, IDEA_STATUS_MAP, REACTION_MAP, STATUS_LABEL, timeAgo,
  type AssistantEvent, type AssistantItem, type AssistantThread, type MiniPaper, type ToolUI,
} from "../api";
import { useApp } from "../store";
import Markdown from "./Markdown";

const TOOL_META: Record<string, { emoji: string; label: (i: Record<string, unknown>) => string }> = {
  search_library: { emoji: "📚", label: (i) => `搜索文库${i.query ? `「${i.query}」` : ""}` },
  search_arxiv: { emoji: "📡", label: (i) => `检索 arXiv：${i.query}` },
  find_papers_by_title: { emoji: "🔎", label: (i) => `按标题查找 ${(i.titles as string[])?.length ?? ""} 篇论文` },
  get_paper: { emoji: "📄", label: (i) => `查看论文 ${i.paper_id}` },
  read_paper: { emoji: "📖", label: (i) => `阅读全文 ${i.paper_id}` },
  find_related_papers: { emoji: "🕸️", label: (i) => `查找 ${i.paper_id} 的相关工作` },
  get_trending: { emoji: "🔥", label: () => "查看社区热榜" },
  add_to_library: { emoji: "📥", label: (i) => `加入文库 ${(i.paper_ids as string[])?.length ?? ""} 篇` },
  set_reaction: { emoji: "😀", label: (i) => `标记 ${i.paper_id} 为 ${i.reaction ? REACTION_MAP[i.reaction as keyof typeof REACTION_MAP]?.emoji ?? i.reaction : "无表情"}` },
  append_paper_note: { emoji: "📝", label: (i) => `写入 ${i.paper_id} 的笔记` },
  list_ideas: { emoji: "💭", label: () => "查看灵感本" },
  get_idea: { emoji: "💭", label: (i) => `查看灵感 #${i.idea_id}` },
  create_idea: { emoji: "✨", label: (i) => `新建灵感「${i.title}」` },
  update_idea: { emoji: "🌱", label: (i) => `更新灵感 #${i.idea_id}` },
  list_research_topics: { emoji: "🧭", label: () => "查看调研专题" },
  get_research_topic: { emoji: "🧭", label: (i) => `查看调研专题 #${i.topic_id}` },
  start_research: { emoji: "🚀", label: (i) => `发起调研：${i.query}` },
};

const SUGGESTIONS = [
  "我文库里有哪些和 RAG 相关的论文？帮我梳理一下",
  "这周社区热榜里，哪些和我的兴趣最相关？",
  "帮我找 2024 年以后关于扩散模型的重要论文",
  "看看我的灵感本，哪个想法最值得推进？",
  "LoRA 和全量微调有什么区别？",
  "帮我调研一下 LLM 推理加速的优化路线",
];

/** Infer what the user is looking at so the assistant can use it ("这篇论文"). */
export function usePageContext(): { kind: string; id: string; label: string } | null {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/(read|ideas|research)\/(.+)$/);
  if (!m) return null;
  const kind = { read: "paper", ideas: "idea", research: "topic" }[m[1]]!;
  const id = decodeURIComponent(m[2]);
  return { kind, id, label: { paper: "当前论文", idea: "当前灵感", topic: "当前调研" }[kind]! };
}

function PaperChips({ papers }: { papers: MiniPaper[] }) {
  const { notify } = useApp();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const shown = all ? papers : papers.slice(0, 5);
  return (
    <div className="mt-1.5 space-y-1">
      {shown.map((p) => {
        const inLib = p.in_library || added.has(p.id);
        return (
          <div key={p.id} className="group flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-line">
            <Link to={`/read/${encodeURIComponent(p.id)}`} className="min-w-0 flex-1 truncate hover:text-brand" title={p.tldr || p.title}>
              <span className="font-medium">{p.title}</span>
              <span className="ml-1.5 text-stone-400">{p.year || p.id}</span>
            </Link>
            {p.reaction && <span title={REACTION_MAP[p.reaction]?.label}>{REACTION_MAP[p.reaction]?.emoji}</span>}
            {inLib ? (
              <span className="shrink-0 text-[10px] text-emerald-600">{p.status && p.status !== "pool" ? STATUS_LABEL[p.status] : "已收录"}</span>
            ) : (
              <button
                onClick={async () => {
                  await api.patchPaper(p.id, { status: "later" });
                  setAdded((s) => new Set(s).add(p.id));
                  notify("📥 已加入文库");
                }}
                className="shrink-0 rounded px-1.5 text-[10px] text-brand opacity-0 ring-1 ring-brand/30 transition hover:bg-brand-soft group-hover:opacity-100"
              >
                + 文库
              </button>
            )}
          </div>
        );
      })}
      {papers.length > 5 && (
        <button onClick={() => setAll(!all)} className="pl-1 text-[11px] text-stone-400 hover:text-brand">
          {all ? "收起" : `展开全部 ${papers.length} 篇`}
        </button>
      )}
    </div>
  );
}

function ToolResultView({ ui }: { ui: ToolUI }) {
  if (ui.kind === "papers") return ui.papers.length ? <PaperChips papers={ui.papers} /> : null;
  if (ui.kind === "ideas")
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ui.ideas.map((i) => (
          <Link key={i.id} to={`/ideas/${i.id}`} className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100">
            {IDEA_STATUS_MAP[i.status]?.emoji} {i.title}
          </Link>
        ))}
      </div>
    );
  if (ui.kind === "topics")
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ui.topics.map((t) => (
          <Link key={t.id} to={`/research/${t.id}`} className="rounded-lg bg-violet-50 px-2.5 py-1 text-xs text-violet-900 ring-1 ring-violet-200 hover:bg-violet-100">
            🧭 {t.title} {t.status === "running" ? "（调研中…）" : `· ${t.papers} 篇`}
          </Link>
        ))}
      </div>
    );
  if (ui.kind === "note" && ui.paper)
    return (
      <Link to={`/read/${encodeURIComponent(ui.paper.id)}`} className="mt-1 inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-brand">
        <BookOpen size={11} /> {ui.paper.title}
      </Link>
    );
  return null;
}

function ToolItem({ it }: { it: Extract<AssistantItem, { type: "tool" }> }) {
  const meta = TOOL_META[it.name] ?? { emoji: "🔧", label: () => it.name };
  const [open, setOpen] = useState(true);
  const hasUI = it.ui && !(it.ui.kind === "papers" && !it.ui.papers.length);
  return (
    <div className="animate-rise">
      <button onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-1 text-xs text-stone-600 transition hover:bg-line">
        <span>{meta.emoji}</span>
        <span className="truncate">{meta.label(it.input)}</span>
        {it.ok === null ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-brand" />
        ) : it.ok ? (
          <Check size={11} className="shrink-0 text-emerald-600" />
        ) : (
          <X size={11} className="shrink-0 text-red-500" />
        )}
        {hasUI && <ChevronDown size={11} className={`shrink-0 transition ${open ? "" : "-rotate-90"}`} />}
      </button>
      {it.error && <p className="ml-2 mt-1 text-[11px] text-red-600">{it.error.slice(0, 200)}</p>}
      {open && hasUI && <ToolResultView ui={it.ui!} />}
    </div>
  );
}

/** The chat transcript + composer. Used both by the floating panel and the full page. */
export function AssistantChat({
  threadId,
  onThread,
  compact,
  initial,
}: {
  threadId: number | null;
  onThread: (id: number) => void;
  compact?: boolean;
  /** Message to send automatically on mount (e.g. from the home page box). */
  initial?: string;
}) {
  const { model } = useApp();
  const ctx = usePageContext();
  const [items, setItems] = useState<AssistantItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [useCtx, setUseCtx] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const localThread = useRef<number | null>(threadId);

  useEffect(() => {
    if (threadId && threadId === localThread.current && items.length) return; // we just created it
    localThread.current = threadId;
    setErr("");
    if (threadId) assistantApi.thread(threadId).then((t) => setItems(t.items));
    else setItems([]);
  }, [threadId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, pending]);
  const sentInitial = useRef(false);
  useEffect(() => {
    if (initial && !sentInitial.current) {
      sentInitial.current = true;
      send(initial);
    }
  }, [initial]);

  const send = async (text = input) => {
    if (!text.trim() || busy) return;
    setErr("");
    setInput("");
    setItems((xs) => [...xs, { type: "user", text }]);
    setBusy(true);
    abort.current = new AbortController();
    const push = (fn: (xs: AssistantItem[]) => AssistantItem[]) => setItems(fn);
    try {
      await streamEvents<AssistantEvent>(
        "/api/assistant/chat",
        { message: text, thread_id: localThread.current, model, context: useCtx && ctx ? { kind: ctx.kind, id: ctx.id } : null },
        (e) => {
          if (e.type === "thread") {
            if (localThread.current !== e.id) {
              localThread.current = e.id;
              onThread(e.id);
            }
          } else if (e.type === "text") {
            setPending(null);
            push((xs) => {
              const last = xs[xs.length - 1];
              return last?.type === "text" ? [...xs.slice(0, -1), { ...last, text: last.text + e.t }] : [...xs, { type: "text", text: e.t }];
            });
          } else if (e.type === "tool_pending") setPending(e.name);
          else if (e.type === "tool_start") {
            setPending(null);
            push((xs) => [...xs, { type: "tool", id: e.id, name: e.name, input: e.input, ok: null, ui: null }]);
          } else if (e.type === "tool_result")
            push((xs) => xs.map((x) => (x.type === "tool" && x.id === e.id ? { ...x, ok: e.ok, ui: e.ui, error: e.error } : x)));
          else if (e.type === "error") setErr(e.error);
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      setBusy(false);
      setPending(null);
      setItems((xs) => xs.map((x) => (x.type === "tool" && x.ok === null ? { ...x, ok: false, error: "已中断" } : x)));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto ${compact ? "px-4 py-4" : "px-8 py-6"}`}>
        {items.length === 0 && (
          <div className={compact ? "pt-4" : "mx-auto max-w-2xl pt-10"}>
            <div className="text-center">
              <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand via-[#8b5cf6] to-ember text-2xl shadow-lg shadow-brand/30">✨</div>
              <h2 className="title-serif text-lg font-bold">你好，我是你的研究助理</h2>
              <p className="mt-1 text-xs text-stone-500">我能翻你的文库、灵感和笔记，检索 arXiv，读论文全文，帮你加文库、记灵感、发起调研</p>
            </div>
            <div className={`mt-5 grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
              {(ctx?.kind === "paper"
                ? ["用三句话讲讲这篇论文的核心贡献", "这篇论文的方法有什么潜在问题？", "帮我找这篇论文的前置工作和后续改进", "基于这篇论文帮我记一个研究灵感"]
                : SUGGESTIONS
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-left text-xs text-stone-600 transition hover:-translate-y-0.5 hover:border-brand hover:text-brand hover:shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) =>
          it.type === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2 text-sm text-white shadow-sm">{it.text}</div>
            </div>
          ) : it.type === "tool" ? (
            <ToolItem key={it.id} it={it} />
          ) : (
            <Markdown key={i}>{it.text}</Markdown>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-stone-400">
            <Loader2 size={12} className="animate-spin text-brand" />
            {pending ? `准备${TOOL_META[pending]?.label({}) ?? pending}…` : "思考中…"}
          </div>
        )}
        {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">😵 {err}</div>}
        <div ref={end} />
      </div>

      <div className={`border-t border-line bg-white/70 ${compact ? "p-3" : "px-8 py-4"}`}>
        {ctx && (
          <button
            onClick={() => setUseCtx(!useCtx)}
            className={`mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition ${useCtx ? "bg-brand-soft text-brand" : "bg-paper-2 text-stone-400 line-through"}`}
            title="让助理知道你正在看什么"
          >
            📍 {ctx.label}：{ctx.id}
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={ta}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={compact ? 2 : 3}
            placeholder="问我任何事：找论文、讨论想法、整理文库、记灵感…（Enter 发送）"
            className="input flex-1 resize-none !rounded-xl"
            autoFocus
          />
          {busy ? (
            <button onClick={() => abort.current?.abort()} className="btn btn-outline !rounded-xl !px-3 !py-2.5" title="停止">
              <Square size={14} />
            </button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim()} className="btn btn-fun !rounded-xl !px-3 !py-2.5">
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThreadList({ current, onPick, onNew }: { current: number | null; onPick: (id: number) => void; onNew: () => void }) {
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const load = () => assistantApi.threads().then(setThreads);
  useEffect(() => {
    load();
  }, [current]);
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button onClick={onNew} className="btn btn-fun w-full justify-center !rounded-xl">
          <Plus size={15} /> 新对话
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {threads.map((t) => (
          <div
            key={t.id}
            className={`group flex cursor-pointer items-center gap-1 rounded-xl px-3 py-2 ${t.id === current ? "bg-ink text-white" : "hover:bg-paper-2"}`}
            onClick={() => onPick(t.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{t.title || "新对话"}</div>
              <div className="text-[10px] opacity-50">{timeAgo(t.updated_at)}</div>
            </div>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm("删除这个对话？")) return;
                await assistantApi.deleteThread(t.id);
                if (t.id === current) onNew();
                load();
              }}
              className="shrink-0 opacity-0 transition hover:text-red-500 group-hover:opacity-60"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {threads.length === 0 && <p className="px-3 text-xs text-stone-400">还没有对话</p>}
      </div>
    </div>
  );
}

/** Floating ✨ button + slide-over panel, available on every page (⌘K). */
export function AssistantLauncher() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(() => {
    const v = sessionStorage.getItem("assistant-thread");
    return v ? +v : null;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (threadId) sessionStorage.setItem("assistant-thread", String(threadId));
    else sessionStorage.removeItem("assistant-thread");
  }, [threadId]);

  // Draggable launcher button; position persisted across reloads.
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("assistant-launcher-pos") || "null");
    } catch {
      return null;
    }
  });
  const clamp = (x: number, y: number) => {
    const el = btnRef.current;
    const w = el?.offsetWidth ?? 140, h = el?.offsetHeight ?? 44;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  };
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp(d.ox + dx, d.oy + dy));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (d.moved) {
      setPos((p) => {
        if (p) localStorage.setItem("assistant-launcher-pos", JSON.stringify(p));
        return p;
      });
      // Swallow the click that follows a drag, then reset.
      setTimeout(() => (dragRef.current = null), 0);
    } else dragRef.current = null;
  };

  if (loc.pathname.startsWith("/assistant")) return null;

  return (
    <>
      {!open && (
        <button
          ref={btnRef}
          onClick={() => {
            if (dragRef.current?.moved) return;
            setOpen(true);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", touchAction: "none" } : { touchAction: "none" }}
          className={`group fixed bottom-6 right-6 z-30 flex cursor-grab select-none items-center gap-2 rounded-full bg-gradient-to-r from-brand via-[#8b5cf6] to-ember py-3 pl-3.5 pr-4 text-sm font-medium text-white shadow-xl shadow-brand/30 hover:scale-105 active:cursor-grabbing ${dragging ? "" : "transition"}`}
          title="AI 助理 (⌘K)，可拖动"
        >
          <span className="text-lg transition group-hover:rotate-12">✨</span>
          问问 AI
          <kbd className="rounded bg-white/20 px-1 text-[10px]">⌘K</kbd>
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 right-4 top-16 z-30 flex w-[460px] animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl">
          <div className="flex items-center gap-2 border-b border-line bg-white/80 px-4 py-2.5">
            <span className="text-lg">✨</span>
            <span className="text-sm font-semibold">AI 研究助理</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button onClick={() => setThreadId(null)} className="btn btn-ghost !p-1.5" title="新对话">
                <Plus size={15} />
              </button>
              <Link to={threadId ? `/assistant/${threadId}` : "/assistant"} onClick={() => setOpen(false)} className="btn btn-ghost !p-1.5" title="全屏打开">
                <Maximize2 size={14} />
              </Link>
              <button onClick={() => setOpen(false)} className="btn btn-ghost !p-1.5" title="关闭 (Esc)">
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <AssistantChat threadId={threadId} onThread={setThreadId} compact />
          </div>
        </div>
      )}
    </>
  );
}

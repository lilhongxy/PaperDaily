import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Search, Pin, Trash2, Loader2, Send, X, Plus, Eye, Pencil, Link2, Sparkles } from "lucide-react";
import { api, streamAI, IDEA_STATUS, IDEA_STATUS_MAP, timeAgo, type ChatMsg, type Idea, type IdeaStatus, type Paper } from "../api";
import { useApp } from "../store";
import Markdown from "../components/Markdown";
import { Empty } from "../components/Feedback";

const AI_MODES: { key: string; emoji: string; label: string; hint: string }[] = [
  { key: "related", emoji: "🔎", label: "有人做过吗", hint: "查找相关工作与差异点" },
  { key: "critique", emoji: "⚔️", label: "挑战我", hint: "以审稿人视角找漏洞" },
  { key: "experiment", emoji: "🧪", label: "设计实验", hint: "最小可行验证方案" },
  { key: "expand", emoji: "🌿", label: "发散一下", hint: "延伸方向与变体" },
];

export default function IdeasPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { quickIdea, quickIdeaState } = useApp();
  const [list, setList] = useState<Idea[]>([]);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<IdeaStatus | "">("");

  const load = () => api.ideas({ q: q || undefined, status: statusF || undefined }).then(setList);
  useEffect(() => {
    load();
  }, [statusF]);
  useEffect(() => {
    if (!quickIdeaState.open) load();
  }, [quickIdeaState.open]);

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-white/60">
        <div className="space-y-2 border-b border-line p-3">
          <button onClick={() => quickIdea()} className="btn btn-fun w-full justify-center !rounded-xl">
            💭 记下新想法
          </button>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
          >
            <Search size={14} className="absolute left-2.5 top-2.5 text-stone-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索想法…" className="input !pl-8 !py-1.5" />
          </form>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setStatusF("")} className={`rounded-full px-2 py-0.5 text-[11px] ${!statusF ? "bg-ink text-white" : "bg-paper-2 text-stone-600"}`}>
              全部
            </button>
            {IDEA_STATUS.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusF(s.key)}
                className={`rounded-full px-2 py-0.5 text-[11px] ${statusF === s.key ? "bg-ink text-white" : "bg-paper-2 text-stone-600"}`}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {list.map((i) => (
            <button
              key={i.id}
              onClick={() => nav(`/ideas/${i.id}`)}
              className={`mb-1 block w-full rounded-xl px-3 py-2.5 text-left transition ${String(i.id) === id ? "bg-ink text-white" : "hover:bg-paper-2"}`}
            >
              <div className="flex items-start gap-1.5">
                <span>{IDEA_STATUS_MAP[i.status]?.emoji}</span>
                <span className="line-clamp-2 flex-1 text-[13px] font-medium">{i.title || "未命名想法"}</span>
                {i.pinned && <Pin size={12} className="mt-0.5 shrink-0 text-ember" />}
              </div>
              <div className="mt-1 line-clamp-2 pl-6 text-[11px] opacity-60">{i.content.replace(/[#>*`$_]/g, "").slice(0, 90)}</div>
              <div className="mt-1 flex gap-2 pl-6 text-[10px] opacity-50">
                <span>{timeAgo(i.updated_at)}</span>
                {!!i.paper_count && <span>📄 {i.paper_count}</span>}
                {!!i.chat_count && <span>🤖 {i.chat_count}</span>}
              </div>
            </button>
          ))}
          {list.length === 0 && <p className="p-4 text-center text-xs text-stone-400">还没有想法</p>}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {id ? (
          <IdeaDetail key={id} id={+id} onChanged={load} onDeleted={() => { load(); nav("/ideas"); }} />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <Empty emoji="💭" title="灵感本" hint="随时记下读论文时冒出的想法。AI 会帮你查重、挑刺、设计实验，把萌芽的想法养成可执行的研究方向。在任何页面按 ⌘I 都能快速记录。">
              <button onClick={() => quickIdea()} className="btn btn-primary">
                <Plus size={14} /> 记下第一个想法
              </button>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}

function IdeaDetail({ id, onChanged, onDeleted }: { id: number; onChanged: () => void; onDeleted: () => void }) {
  const { model } = useApp();
  const [idea, setIdea] = useState<Idea | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [saved, setSaved] = useState(true);
  const [chats, setChats] = useState<ChatMsg[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [linkQ, setLinkQ] = useState("");
  const [linkRes, setLinkRes] = useState<Paper[]>([]);
  const [tagInput, setTagInput] = useState("");
  const timer = useRef<number>(undefined);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.idea(id).then((i) => {
      setIdea(i);
      setTitle(i.title);
      setContent(i.content);
      setChats(i.chats || []);
      if (!i.content.trim()) setMode("edit");
    });
    return () => abort.current?.abort();
  }, [id]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats.length]);

  const save = (patch: Partial<Idea>, debounce = true) => {
    setSaved(false);
    clearTimeout(timer.current);
    const run = async () => {
      const i = await api.patchIdea(id, patch);
      setIdea((old) => ({ ...i, chats: old?.chats }));
      setSaved(true);
      onChanged();
    };
    if (debounce) timer.current = window.setTimeout(run, 700);
    else run();
  };

  const ask = async (m: string, text = msg) => {
    if (busy || (m === "chat" && !text.trim())) return;
    setErr("");
    setMsg("");
    const label = AI_MODES.find((x) => x.key === m);
    const shown = m === "chat" ? text : `${label?.emoji} ${label?.label}${text ? `：${text}` : ""}`;
    setChats((c) => [...c, { role: "user", content: shown, mode: m }, { role: "assistant", content: "", model }]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      await streamAI(`/api/ai/idea/${id}`, { mode: m, message: text || null, model }, (_, full) =>
        setChats((c) => [...c.slice(0, -1), { role: "assistant", content: full, model }]), abort.current.signal);
      onChanged();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      setChats((c) => c.slice(0, -2));
    } finally {
      setBusy(false);
    }
  };

  const searchLink = async (v: string) => {
    setLinkQ(v);
    setLinkRes(v.trim().length >= 2 ? (await api.papers({ q: v, limit: 8 })).filter((p) => !idea?.papers?.some((x) => x.id === p.id)) : []);
  };

  if (!idea) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-stone-400" /></div>;

  return (
    <div className="flex h-full">
      {/* left: the idea itself */}
      <div className="flex min-w-0 flex-[1.1] flex-col border-r border-line">
        <div className="border-b border-line px-6 pb-3 pt-5">
          <div className="flex items-start gap-2">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                save({ title: e.target.value });
              }}
              placeholder="想法标题"
              className="title-serif min-w-0 flex-1 bg-transparent text-xl font-bold outline-none placeholder:text-stone-300"
            />
            <button onClick={() => save({ pinned: !idea.pinned }, false)} className={`btn btn-ghost !p-1.5 ${idea.pinned ? "!text-ember" : "text-stone-400"}`} title="置顶">
              <Pin size={15} />
            </button>
            <button
              onClick={async () => {
                if (!confirm("删除这个想法？")) return;
                await api.deleteIdea(id);
                onDeleted();
              }}
              className="btn btn-ghost !p-1.5 text-stone-400 hover:!text-red-600"
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {IDEA_STATUS.map((s) => (
              <button
                key={s.key}
                onClick={() => save({ status: s.key }, false)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${idea.status === s.key ? "bg-ink text-white" : "bg-paper-2 text-stone-500 hover:bg-line"}`}
              >
                {s.emoji} {s.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-stone-400">{saved ? `已保存 · ${timeAgo(idea.updated_at)}` : "保存中…"}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {idea.tags.map((t) => (
              <span key={t} className="chip">
                #{t}
                <button className="ml-1 opacity-50 hover:opacity-100" onClick={() => save({ tags: idea.tags.filter((x) => x !== t) }, false)}>
                  <X size={10} />
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (tagInput.trim()) save({ tags: [...idea.tags, tagInput.trim()] }, false);
                setTagInput("");
              }}
            >
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="+ 标签" className="w-20 bg-transparent text-xs outline-none placeholder:text-stone-400" />
            </form>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-line px-4 py-1.5">
          <button onClick={() => setMode("edit")} className={`btn btn-ghost !px-2 !py-1 text-xs ${mode === "edit" ? "!bg-paper-2" : ""}`}>
            <Pencil size={12} /> 编辑
          </button>
          <button onClick={() => setMode("preview")} className={`btn btn-ghost !px-2 !py-1 text-xs ${mode === "preview" ? "!bg-paper-2" : ""}`}>
            <Eye size={12} /> 预览
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                save({ content: e.target.value });
              }}
              placeholder={"把想法展开写写：\n\n## 动机\n## 核心假设\n## 可能的做法\n## 待验证的问题\n\n支持 Markdown 与 LaTeX"}
              className="h-full w-full resize-none bg-transparent p-6 font-mono text-[13px] leading-relaxed outline-none"
            />
          ) : (
            <div className="p-6" onDoubleClick={() => setMode("edit")}>
              {content.trim() ? <Markdown>{content}</Markdown> : <p className="text-sm text-stone-400">（空，双击开始编辑）</p>}
            </div>
          )}
        </div>

        <div className="border-t border-line bg-white/50 px-5 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-500">
            <Link2 size={12} /> 关联论文 {idea.papers?.length ? `(${idea.papers.length})` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {idea.papers?.map((p) => (
              <span key={p.id} className="group inline-flex max-w-[260px] items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs ring-1 ring-line">
                <Link to={`/read/${encodeURIComponent(p.id)}`} className="truncate hover:text-brand">
                  📄 {p.title}
                </Link>
                <button onClick={async () => setIdea({ ...(await api.unlinkPaper(id, p.id)), chats: idea.chats })} className="opacity-0 group-hover:opacity-60 hover:!opacity-100">
                  <X size={11} />
                </button>
              </span>
            ))}
            <div className="relative">
              <input value={linkQ} onChange={(e) => searchLink(e.target.value)} placeholder="+ 搜索文库关联论文" className="input !w-48 !py-1 text-xs" />
              {linkRes.length > 0 && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-96 rounded-xl border border-line bg-white p-1 shadow-lg">
                  {linkRes.map((p) => (
                    <button
                      key={p.id}
                      onClick={async () => {
                        setIdea({ ...(await api.linkPaper(id, p.id)), chats: idea.chats });
                        setLinkQ("");
                        setLinkRes([]);
                      }}
                      className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-paper-2"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* right: AI collaborator */}
      <div className="flex min-w-[380px] flex-1 flex-col bg-white/70">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Sparkles size={15} className="text-brand" />
          <span className="text-sm font-semibold">AI 合作者</span>
          <span className="text-[11px] text-stone-400">会参考想法内容、关联论文与你的笔记</span>
          {chats.length > 0 && !busy && (
            <button
              onClick={async () => {
                if (!confirm("清空与 AI 的讨论？")) return;
                await api.clearIdeaChats(id);
                setChats([]);
              }}
              className="btn btn-ghost ml-auto !p-1 text-stone-400"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-line p-3">
          {AI_MODES.map((m) => (
            <button
              key={m.key}
              disabled={busy}
              onClick={() => ask(m.key, "")}
              className="group rounded-xl border border-line bg-white px-3 py-2 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-sm disabled:opacity-50"
            >
              <div className="text-sm font-medium">
                <span className="mr-1 inline-block transition group-hover:scale-125">{m.emoji}</span>
                {m.label}
              </div>
              <div className="text-[11px] text-stone-400">{m.hint}</div>
            </button>
          ))}
        </div>
        {err && <div className="bg-red-50 px-4 py-2 text-xs text-red-700">{err}</div>}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {chats.length === 0 && <p className="pt-8 text-center text-xs text-stone-400">点上面的按钮，或者直接和 AI 聊聊这个想法 👇</p>}
          {chats.map((c, i) =>
            c.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand px-3.5 py-2 text-sm text-white">
                  {modeLabel(c)}
                </div>
              </div>
            ) : (
              <div key={i} className="group">
                {c.content ? <Markdown>{c.content}</Markdown> : <Loader2 size={15} className="animate-spin text-stone-400" />}
                {c.content && !(busy && i === chats.length - 1) && (
                  <button
                    onClick={() => {
                      const v = content.trimEnd() + "\n\n---\n\n" + c.content;
                      setContent(v);
                      save({ content: v }, false);
                    }}
                    className="mt-1 text-[11px] text-stone-400 opacity-0 transition hover:text-brand group-hover:opacity-100"
                  >
                    + 追加到想法正文
                  </button>
                )}
              </div>
            ),
          )}
          <div ref={end} />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask("chat");
                }
              }}
              rows={2}
              placeholder="和 AI 讨论这个想法…"
              className="input flex-1 resize-none"
            />
            {busy ? (
              <button onClick={() => abort.current?.abort()} className="btn btn-outline">
                停止
              </button>
            ) : (
              <button onClick={() => ask("chat")} className="btn btn-primary !px-2.5">
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function modeLabel(c: ChatMsg) {
  const m = c.mode && c.mode !== "chat" ? AI_MODES.find((x) => x.key === c.mode) : null;
  if (m) return c.content.startsWith(m.emoji) ? c.content : `${m.emoji} ${m.label}`;
  return c.content.length > 400 ? c.content.slice(0, 400) + "…" : c.content;
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, Link2 } from "lucide-react";
import { api, IDEA_STATUS, type IdeaStatus } from "../api";
import { useApp } from "../store";

/** Global "capture an idea" composer (⌘I / the 💭 button in the top bar). */
export default function QuickIdea() {
  const { quickIdeaState: st, closeQuickIdea, notify } = useApp();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<IdeaStatus>("seed");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (st.open) {
      setTitle("");
      setContent(st.text ? `> ${st.text}\n\n` : "");
      setStatus("seed");
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [st.open]);

  if (!st.open) return null;

  const save = async (open = false) => {
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    const firstLine = content.replace(/^>.*$/gm, "").trim().split("\n")[0]?.slice(0, 40);
    const idea = await api.createIdea({
      title: title.trim() || firstLine || "未命名想法",
      content,
      status,
      paper_ids: st.paperId ? [st.paperId] : [],
    });
    setSaving(false);
    closeQuickIdea();
    notify("💭 想法已记下");
    if (open) nav(`/ideas/${idea.id}`);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/20 pt-[12vh] backdrop-blur-[2px]" onMouseDown={closeQuickIdea}>
      <div className="card w-[560px] animate-rise p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xl">💭</span>
          <h3 className="title-serif text-lg font-semibold">记下一个想法</h3>
          <button onClick={closeQuickIdea} className="btn btn-ghost ml-auto !p-1">
            <X size={16} />
          </button>
        </div>
        {st.paperId && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs text-brand">
            <Link2 size={12} /> 关联论文：<span className="truncate">{st.paperTitle}</span>
          </div>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话概括（可选）" className="input mb-2 !text-[15px] font-medium" />
        <textarea
          ref={ref}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") closeQuickIdea();
          }}
          rows={6}
          placeholder={"想到了什么？哪怕只是一个模糊的直觉…\n\n比如：如果在检索阶段就让模型参与重排，RAG 的多跳问答会不会更准？"}
          className="input resize-none font-mono !text-[13px] leading-relaxed"
        />
        <div className="mt-3 flex items-center gap-1.5">
          {IDEA_STATUS.slice(0, 4).map((s) => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${status === s.key ? "bg-ink text-white" : "bg-paper-2 text-stone-600 hover:bg-line"}`}
            >
              {s.emoji} {s.label}
            </button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button onClick={() => save(true)} disabled={saving} className="btn btn-outline text-xs">
              <Sparkles size={13} /> 保存并展开
            </button>
            <button onClick={() => save()} disabled={saving} className="btn btn-primary text-xs">
              保存 <kbd className="rounded bg-white/20 px-1 text-[10px]">⌘↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

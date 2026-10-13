import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api, STATUS_LABEL, type Reaction, type Status } from "../api";
import Markdown from "../components/Markdown";
import { Empty } from "../components/Feedback";
import { ReactionBadge } from "../components/Reactions";

type NoteItem = { paper_id: string; content: string; updated_at: number; title: string; status: Status; reaction: Reaction | null; tags: string[] };

export default function NotesPage() {
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [sel, setSel] = useState<NoteItem | null>(null);

  const load = async (query = q) => {
    const n = await api.notes(query || undefined);
    setNotes(n);
    setSel((s) => n.find((x) => x.paper_id === s?.paper_id) ?? n[0] ?? null);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-white/60">
        <form
          className="relative border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <Search size={15} className="absolute left-5.5 top-5.5 text-stone-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索笔记…" className="input !pl-8" />
        </form>
        <div className="flex-1 overflow-y-auto">
          {notes.map((n) => (
            <button
              key={n.paper_id}
              onClick={() => setSel(n)}
              className={`block w-full border-b border-line px-4 py-3 text-left ${sel?.paper_id === n.paper_id ? "bg-brand-soft" : "hover:bg-paper-2"}`}
            >
              <div className="line-clamp-2 text-sm font-medium text-stone-800">{n.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-stone-500">{n.content.replace(/[#>*`$_-]/g, "").slice(0, 120)}</div>
              <div className="mt-1 text-[11px] text-stone-400">
                {new Date(n.updated_at * 1000).toLocaleString("zh-CN")} · {STATUS_LABEL[n.status]}
              </div>
            </button>
          ))}
          {notes.length === 0 && <div className="p-4"><Empty emoji="📝" title="还没有笔记" hint="打开一篇论文，在阅读器的「笔记」里记录吧" /></div>}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {sel && (
          <div className="mx-auto max-w-3xl p-8">
            <div className="mb-4 flex items-start gap-3">
              <h1 className="title-serif flex-1 text-xl font-bold text-ink">{sel.title}</h1>
              <Link to={`/read/${encodeURIComponent(sel.paper_id)}?tab=note`} className="btn btn-outline shrink-0 text-xs">
                打开阅读 / 编辑
              </Link>
            </div>
            <div className="mb-4 flex flex-wrap gap-1">
              <ReactionBadge value={sel.reaction} />
              {sel.tags.map((t) => (
                <span key={t} className="chip">
                  #{t}
                </span>
              ))}
            </div>
            <div className="card p-7">
              <Markdown>{sel.content}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

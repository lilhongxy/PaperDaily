import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, Loader2 } from "lucide-react";
import { api, REACTIONS, STATUS_LABEL, type Paper, type Reaction, type Status } from "../api";
import PaperCard from "../components/PaperCard";
import { Empty } from "../components/Feedback";
import { useApp } from "../store";

const STATUS_FILTERS: { key: string; label: string; emoji: string }[] = [
  { key: "later,reading,read,archived", label: "全部", emoji: "📚" },
  { key: "later", label: STATUS_LABEL.later, emoji: "🕐" },
  { key: "reading", label: STATUS_LABEL.reading, emoji: "📖" },
  { key: "read", label: STATUS_LABEL.read, emoji: "✅" },
  { key: "archived", label: STATUS_LABEL.archived, emoji: "🗄️" },
  { key: "ignored", label: STATUS_LABEL.ignored, emoji: "🙈" },
];

export default function LibraryPage() {
  const { notify } = useApp();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("f") || STATUS_FILTERS[0].key;
  const reaction = (sp.get("r") || "") as Reaction | "";
  const tag = sp.get("tag") || "";
  const query = sp.get("q") || "";
  const [q, setQ] = useState(query);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof api.counts>> | null>(null);
  const [tags, setTags] = useState<{ tag: string; c: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [addId, setAddId] = useState("");
  const [addErr, setAddErr] = useState("");

  const load = async () => {
    setPapers(
      await api.papers({
        status: reaction ? undefined : filter,
        reaction: reaction || undefined,
        tag: tag || undefined,
        q: query || undefined,
      }),
    );
    setCounts(await api.counts());
    setTags(await api.tags());
  };

  useEffect(() => {
    load();
  }, [filter, reaction, tag, query]);

  const setParams = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
    setSp(n);
  };

  const add = async () => {
    if (!addId.trim()) return;
    setAdding(true);
    setAddErr("");
    try {
      const p = await api.addPaper(addId.trim());
      setAddId("");
      notify(`📥 已加入：${p.title.slice(0, 30)}…`);
      setParams({ f: "later", r: "" });
      load();
    } catch (e) {
      setAddErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const onChange = (p: Paper) => {
    const keep = reaction ? p.reaction === reaction : filter.split(",").includes(p.status) || !!query;
    setPapers((ps) => (keep ? ps.map((x) => (x.id === p.id ? p : x)) : ps.filter((x) => x.id !== p.id)));
    api.counts().then(setCounts);
  };

  const statusCount = (key: string) => key.split(",").reduce((s, k) => s + (counts?.status[k as Status] || 0), 0);
  const side = (active: boolean) => `flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-sm transition ${active ? "bg-ink text-white" : "hover:bg-paper-2"}`;

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-line bg-white/60 p-3">
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setParams({ f: f.key, r: "" })} className={side(filter === f.key && !reaction)}>
            <span>
              {f.emoji} {f.label}
            </span>
            <span className="text-xs opacity-50">{statusCount(f.key)}</span>
          </button>
        ))}
        <div className="mb-1 mt-4 px-3 text-[11px] font-medium text-stone-400">按表情</div>
        {REACTIONS.map((r) => (
          <button key={r.key} onClick={() => setParams({ r: reaction === r.key ? "" : r.key })} className={side(reaction === r.key)}>
            <span>
              {r.emoji} {r.label}
            </span>
            <span className="text-xs opacity-50">{counts?.reaction[r.key] || 0}</span>
          </button>
        ))}
        <div className="mb-1.5 mt-4 px-3 text-[11px] font-medium text-stone-400">标签</div>
        <div className="flex flex-wrap gap-1 px-2">
          {tags.map((t) => (
            <button
              key={t.tag}
              onClick={() => setParams({ tag: tag === t.tag ? "" : t.tag })}
              className={`chip transition ${tag === t.tag ? "!bg-brand !text-white" : "hover:bg-brand-soft"}`}
            >
              #{t.tag} <span className="ml-1 opacity-60">{t.c}</span>
            </button>
          ))}
          {tags.length === 0 && <p className="text-xs text-stone-400">暂无</p>}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-6">
          <div className="flex gap-3">
            <form
              className="relative flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                setParams({ q });
              }}
            >
              <Search size={15} className="absolute left-3 top-2.5 text-stone-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、摘要、作者、标签、笔记…（回车）" className="input !rounded-full !pl-9" />
            </form>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input value={addId} onChange={(e) => setAddId(e.target.value)} placeholder="arXiv ID 或链接" className="input !w-48 !rounded-full" />
              <button className="btn btn-outline !rounded-full" disabled={adding}>
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                添加
              </button>
            </form>
          </div>
          {addErr && <p className="mt-1 text-xs text-red-600">{addErr}</p>}
          {(tag || query || reaction) && (
            <div className="mt-3 flex gap-2 text-xs">
              {reaction && (
                <button className="chip !bg-brand-soft !text-brand" onClick={() => setParams({ r: "" })}>
                  {REACTIONS.find((r) => r.key === reaction)?.emoji} {REACTIONS.find((r) => r.key === reaction)?.label} ✕
                </button>
              )}
              {tag && (
                <button className="chip !bg-brand-soft !text-brand" onClick={() => setParams({ tag: "" })}>
                  #{tag} ✕
                </button>
              )}
              {query && (
                <button
                  className="chip !bg-brand-soft !text-brand"
                  onClick={() => {
                    setQ("");
                    setParams({ q: "" });
                  }}
                >
                  🔍 {query} ✕
                </button>
              )}
            </div>
          )}
          <div className="mt-4 space-y-3">
            {papers.map((p, i) => (
              <PaperCard key={p.id} paper={p} onChange={onChange} showStatus index={i} />
            ))}
            {papers.length === 0 && <Empty emoji="📭" title="这里还没有论文" hint="去「今日」推送或「调研」专题里，把喜欢的论文加入文库吧" />}
          </div>
        </div>
      </div>
    </div>
  );
}

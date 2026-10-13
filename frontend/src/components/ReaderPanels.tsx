import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Plus, Check, ExternalLink, Network, Lightbulb } from "lucide-react";
import { api, IDEA_STATUS_MAP, timeAgo, type Idea, type RelatedPaper } from "../api";
import { useApp } from "../store";

/** Reader tab: related papers (Semantic Scholar recs + AI-generated arXiv queries, ranked by AI). */
export function RelatedPanel({ paperId }: { paperId: string }) {
  const { model, notify } = useApp();
  const [items, setItems] = useState<RelatedPaper[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setErr("");
    try {
      setItems(await api.related(paperId, refresh, model));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems(null);
    load();
  }, [paperId]);

  const add = async (r: RelatedPaper) => {
    await api.patchPaper(r.id, { status: "later" });
    setItems((xs) => xs!.map((x) => (x.id === r.id ? { ...x, in_library: true, status: "later" } : x)));
    notify(`📥 已加入文库：${r.title.slice(0, 28)}…`);
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <Network size={15} className="text-brand" />
        <span className="text-sm font-semibold">相关论文</span>
        <span className="text-[11px] text-stone-400">Semantic Scholar 推荐 + AI 检索 arXiv</span>
        {items && !loading && (
          <button onClick={() => load(true)} className="btn btn-ghost ml-auto !px-2 !py-1 text-xs">
            <RefreshCw size={12} /> 重新查找
          </button>
        )}
      </div>
      {loading && (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-stone-500">
          <Loader2 className="animate-spin text-brand" size={20} />
          正在顺藤摸瓜找相关工作…（约 30–60 秒）
        </div>
      )}
      {err && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">😵 {err}</p>}
      {items && !loading && items.length === 0 && <p className="py-8 text-center text-sm text-stone-400">没找到相关论文 🫥</p>}
      <div className="space-y-2">
        {!loading &&
          items?.map((r, i) => (
            <div key={r.id} className="animate-rise rounded-xl border border-line bg-white p-3 transition hover:shadow-sm" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">{r.relation}</span>
                <Link to={`/read/${encodeURIComponent(r.id)}`} className="title-serif min-w-0 flex-1 text-[14px] font-semibold leading-snug hover:text-brand">
                  {r.title}
                </Link>
              </div>
              <p className="mt-1 text-xs text-stone-600">{r.why}</p>
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-stone-400">
                <span className="truncate">
                  {r.year} · {r.authors.join(", ")}
                </span>
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="ml-auto shrink-0 hover:text-brand">
                  摘要
                </button>
                <a href={`https://arxiv.org/abs/${r.id}`} target="_blank" rel="noreferrer" className="shrink-0 p-0.5 hover:text-brand">
                  <ExternalLink size={11} />
                </a>
                {r.in_library ? (
                  <span className="flex shrink-0 items-center gap-0.5 text-emerald-600">
                    <Check size={12} /> 已收录
                  </span>
                ) : (
                  <button onClick={() => add(r)} className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-brand ring-1 ring-brand/30 hover:bg-brand-soft">
                    <Plus size={11} /> 文库
                  </button>
                )}
              </div>
              {open === r.id && <p className="mt-2 border-t border-dashed border-line pt-2 text-xs leading-relaxed text-stone-600">{r.abstract}</p>}
            </div>
          ))}
      </div>
    </div>
  );
}

/** Reader tab: ideas linked to this paper, plus quick capture / link existing. */
export function PaperIdeasPanel({ paperId, paperTitle }: { paperId: string; paperTitle: string }) {
  const { quickIdea, quickIdeaState } = useApp();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [all, setAll] = useState<Idea[] | null>(null);

  const load = () => api.paperIdeas(paperId).then(setIdeas);
  useEffect(() => {
    load();
  }, [paperId]);
  useEffect(() => {
    if (!quickIdeaState.open) load();
  }, [quickIdeaState.open]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <button
        onClick={() => quickIdea({ paperId, paperTitle })}
        className="w-full rounded-2xl border-2 border-dashed border-brand/30 bg-brand-soft/50 px-4 py-4 text-left transition hover:border-brand hover:bg-brand-soft"
      >
        <div className="text-sm font-semibold text-brand">💭 读到这里，冒出了什么想法？</div>
        <div className="mt-0.5 text-xs text-stone-500">记下来，自动关联这篇论文。也可以在 PDF 里选中文字后点「记想法」</div>
      </button>

      <div className="mb-2 mt-5 flex items-center gap-2">
        <Lightbulb size={14} className="text-ember" />
        <span className="text-sm font-semibold">关联的想法</span>
        <button
          onClick={async () => setAll(all ? null : await api.ideas())}
          className="btn btn-ghost ml-auto !px-2 !py-0.5 text-xs"
        >
          {all ? "收起" : "+ 关联已有想法"}
        </button>
      </div>
      {all && (
        <div className="mb-3 max-h-48 overflow-y-auto rounded-xl border border-line bg-white p-1">
          {all
            .filter((i) => !ideas.some((x) => x.id === i.id))
            .map((i) => (
              <button
                key={i.id}
                onClick={async () => {
                  await api.linkPaper(i.id, paperId);
                  setAll(null);
                  load();
                }}
                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-paper-2"
              >
                {IDEA_STATUS_MAP[i.status]?.emoji} {i.title || "未命名想法"}
              </button>
            ))}
          {all.length === 0 && <p className="p-2 text-xs text-stone-400">灵感本还是空的</p>}
        </div>
      )}
      <div className="space-y-2">
        {ideas.map((i) => (
          <Link key={i.id} to={`/ideas/${i.id}`} className="block rounded-xl border border-line bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-sm">
            <div className="text-sm font-medium">
              {IDEA_STATUS_MAP[i.status]?.emoji} {i.title || "未命名想法"}
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-stone-500">{i.content.replace(/[#>*`$_]/g, "")}</p>
            <p className="mt-1 text-[10px] text-stone-400">{timeAgo(i.updated_at)}</p>
          </Link>
        ))}
        {ideas.length === 0 && !all && <p className="py-4 text-center text-xs text-stone-400">还没有关联的想法</p>}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { BookOpen, Clock, Archive, ExternalLink, Check, FileText, Plus, X, Flame, MessageCircle, Eye, Heart, Star } from "lucide-react";
import { api, STATUS_LABEL, type Paper, type Status, type TrendItem } from "../api";
import ReactionBar from "./Reactions";
import { useApp } from "../store";

const IN_LIBRARY: Status[] = ["later", "reading", "read", "archived"];

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const cls =
    score >= 8.5
      ? "from-ember to-[#f59e0b] text-white shadow-ember/30"
      : score >= 7
        ? "from-brand to-[#8b5cf6] text-white shadow-brand/30"
        : score >= 5
          ? "from-amber-100 to-amber-200 text-amber-800 shadow-transparent"
          : "from-stone-100 to-stone-200 text-stone-500 shadow-transparent";
  return (
    <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br shadow-md ${cls}`} title="AI 相关度评分">
      <span className="text-[15px] font-bold leading-none">{score.toFixed(score % 1 ? 1 : 0)}</span>
      {score >= 8.5 && <span className="mt-0.5 text-[8px] leading-none">HOT</span>}
    </div>
  );
}

export function BuzzLine({ item }: { item: TrendItem }) {
  const b = item.buzz;
  const h = item.hn;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
      <span className="inline-flex items-center gap-0.5 font-medium text-ember">
        <Flame size={12} /> {item.heat.toFixed(1)}
      </span>
      {b && (
        <>
          <span className="inline-flex items-center gap-0.5"><Eye size={11} /> {b.views}</span>
          <span className="inline-flex items-center gap-0.5"><Heart size={11} /> {b.votes}</span>
          {b.stars > 0 && <span className="inline-flex items-center gap-0.5"><Star size={11} /> {b.stars}</span>}
        </>
      )}
      {h && (
        <a href={h.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded bg-orange-50 px-1 text-orange-700 hover:underline">
          <MessageCircle size={11} /> HN {h.points}▲ {h.comments}
        </a>
      )}
    </div>
  );
}

export default function PaperCard({
  paper,
  onChange,
  showStatus,
  compact,
  extra,
  index = 0,
}: {
  paper: Paper;
  onChange?: (p: Paper) => void;
  showStatus?: boolean;
  compact?: boolean;
  extra?: React.ReactNode;
  index?: number;
}) {
  const { notify } = useApp();
  const set = async (patch: Parameters<typeof api.patchPaper>[1]) => {
    const p = await api.patchPaper(paper.id, patch);
    onChange?.(p);
    return p;
  };
  const inLib = IN_LIBRARY.includes(paper.status);
  const date = paper.published?.slice(0, 10);

  const act = (label: string, icon: React.ReactNode, onClick: () => void, active?: boolean, cls = "") => (
    <button
      onClick={onClick}
      className={`btn btn-ghost !px-2 !py-1 text-xs ${active ? "!bg-brand-soft !text-brand" : ""} ${cls}`}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  const status = (s: Status) => set({ status: s });

  return (
    <div
      className="card group animate-rise p-4 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(60,40,10,0.18)]"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="flex items-start gap-3">
        <ScoreBadge score={paper.score} />
        <div className="min-w-0 flex-1">
          <Link to={`/read/${encodeURIComponent(paper.id)}`} className="title-serif text-[16px] font-semibold leading-snug text-ink hover:text-brand">
            {paper.title}
          </Link>
          <div className="mt-1 truncate text-xs text-stone-500">
            {paper.authors.slice(0, 5).join(", ")}
            {paper.authors.length > 5 && ` 等 ${paper.authors.length} 人`}
            <span className="mx-1.5 text-stone-300">/</span>
            {paper.id}
            <span className="mx-1.5 text-stone-300">/</span>
            {date}
            {showStatus && paper.status !== "pool" && (
              <>
                <span className="mx-1.5 text-stone-300">/</span>
                <span className="text-brand">{STATUS_LABEL[paper.status]}</span>
              </>
            )}
          </div>
          {extra}
          {paper.tldr && <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-stone-800">💡 {paper.tldr}</p>}
          {paper.reason && !compact && <p className="mt-1 text-xs text-stone-500">🎯 {paper.reason}</p>}
          {!compact && (
            <details className="mt-2 text-xs text-stone-600">
              <summary className="cursor-pointer select-none text-stone-400 hover:text-stone-600">原文摘要</summary>
              <p className="mt-1 leading-relaxed">{paper.abstract}</p>
            </details>
          )}
          {(paper.tags.length > 0 || paper.has_analysis) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {paper.tags.map((t) => (
                <Link key={t} to={`/library?tag=${encodeURIComponent(t)}`} className="chip hover:bg-brand-soft hover:text-brand">
                  #{t}
                </Link>
              ))}
              {paper.has_analysis && (
                <span className="chip !bg-emerald-50 !text-emerald-700">
                  <FileText size={11} className="mr-0.5" />
                  已精读
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-dashed border-line pt-2.5">
        <ReactionBar value={paper.reaction} onChange={(r) => set({ reaction: r })} size="sm" />
        <div className="ml-auto flex flex-wrap items-center gap-0.5">
          {inLib ? (
            <>
              {act("稍后读", <Clock size={13} />, () => status("later"), paper.status === "later")}
              {act("已读", <Check size={13} />, () => status("read"), paper.status === "read")}
              {act("归档", <Archive size={13} />, () => status("archived"), paper.status === "archived")}
            </>
          ) : (
            <>
              {act("加入文库", <Plus size={13} />, async () => {
                await status("later");
                notify(`📥 已加入文库：${paper.title.slice(0, 30)}…`);
              })}
              {paper.status === "inbox" && act("忽略", <X size={13} />, () => status("ignored"), false, "hover:!text-red-600")}
            </>
          )}
          <a href={paper.abs_url} target="_blank" rel="noreferrer" className="btn btn-ghost !px-2 !py-1 text-xs" title="arXiv">
            <ExternalLink size={13} />
          </a>
          <Link to={`/read/${encodeURIComponent(paper.id)}`} className="btn btn-primary !px-2.5 !py-1 text-xs">
            <BookOpen size={13} />
            阅读
          </Link>
        </div>
      </div>
    </div>
  );
}

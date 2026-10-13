import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Compass, Loader2, Trash2, Plus, Check, CheckCheck, ExternalLink, BookOpen } from "lucide-react";
import { api, ROLE_META, timeAgo, type ResearchTopic, type TopicRole } from "../api";
import { useApp } from "../store";
import ModelPicker from "../components/ModelPicker";
import Markdown from "../components/Markdown";
import { Empty } from "../components/Feedback";
import ReactionBar from "../components/Reactions";

const EXAMPLES = [
  "检索增强生成（RAG）的发展脉络",
  "扩散模型采样加速的演进",
  "参数高效微调（LoRA 及其变体）",
  "LLM Agent 的规划与工具调用",
  "线性注意力与状态空间模型",
  "LLM 推理加速与量化",
];

const STAGES = ["plan", "verify", "search", "curate", "done"];
const STAGE_LABEL: Record<string, string> = { plan: "🗺️ 规划", verify: "🔎 核实", search: "📡 检索", curate: "🧩 整理", done: "✅ 完成" };

export default function ResearchPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { model, notify } = useApp();
  const [list, setList] = useState<ResearchTopic[]>([]);
  const [topic, setTopic] = useState<ResearchTopic | null>(null);
  const [query, setQuery] = useState("");
  const [fromYear, setFromYear] = useState<number | "">("");
  const [m, setM] = useState("");
  const [roleFilter, setRoleFilter] = useState<TopicRole | "all">("all");
  const [err, setErr] = useState("");
  const timer = useRef<number>(undefined);

  const loadList = () => api.topics().then(setList);

  const loadTopic = async (tid: number) => {
    clearTimeout(timer.current);
    const t = await api.topic(tid);
    setTopic(t);
    if (t.status === "running") timer.current = window.setTimeout(() => loadTopic(tid), 2000);
    else loadList();
  };

  useEffect(() => {
    loadList();
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    setM((x) => x || model);
  }, [model]);
  useEffect(() => {
    setRoleFilter("all");
    if (id) loadTopic(+id);
    else setTopic(null);
  }, [id]);

  const start = async (q = query) => {
    if (!q.trim()) return;
    setErr("");
    try {
      const r = await api.createTopic({ query: q, from_year: fromYear || null, model: m });
      setQuery("");
      await loadList();
      nav(`/research/${r.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const addOne = async (pid: string) => {
    await api.patchPaper(pid, { status: "later" });
    setTopic((t) => (t ? { ...t, papers: t.papers!.map((p) => (p.id === pid ? { ...p, in_library: true, status: "later" } : p)) } : t));
  };
  const addAll = async () => {
    const ids = topic!.papers!.filter((p) => !p.in_library && (roleFilter === "all" || p.role === roleFilter)).map((p) => p.id);
    if (!ids.length) return;
    await api.bulkStatus(ids, "later");
    notify(`📥 已将 ${ids.length} 篇加入文库「稍后读」`);
    loadTopic(topic!.id);
  };

  const shown = topic?.papers?.filter((p) => roleFilter === "all" || p.role === roleFilter) ?? [];
  const stageIdx = topic ? STAGES.indexOf(topic.params.stage || "plan") : 0;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-white/60">
        <div className="p-3">
          <button onClick={() => nav("/research")} className="btn btn-fun w-full justify-center !rounded-xl">
            <Plus size={15} /> 新调研
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => nav(`/research/${t.id}`)}
              className={`group flex w-full flex-col rounded-xl px-3 py-2 text-left ${String(t.id) === id ? "bg-ink text-white" : "hover:bg-paper-2"}`}
            >
              <span className="line-clamp-2 text-[13px] font-medium">
                {t.status === "running" && <Loader2 size={12} className="mr-1 inline animate-spin" />}
                {t.status === "error" && "😵 "}
                {t.title || t.query}
              </span>
              <span className="mt-0.5 text-[11px] opacity-55">
                {t.status === "done" ? `${t.count} 篇` : t.status === "running" ? "调研中…" : "失败"} · {timeAgo(t.created_at)}
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="px-3 pt-2 text-xs text-stone-400">还没有调研专题</p>}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {!id && (
          <div className="mx-auto max-w-3xl p-8">
            <div className="mb-6 text-center">
              <div className="mb-2 text-5xl">🧭</div>
              <h1 className="title-serif text-2xl font-bold">调研一条研究路线</h1>
              <p className="mt-2 text-sm text-stone-500">
                描述你想调研的方向，AI 会列出奠基工作与关键进展、在 arXiv 上逐篇核实、补充检索最新论文，<br />
                然后整理成一张带时间线的文献地图和一段路线综述。
              </p>
            </div>
            <div className="card p-5">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && start()}
                rows={3}
                placeholder="例如：检索增强生成从 RAG 到 GraphRAG 的发展；重点关注检索质量与多跳推理"
                className="input resize-none !text-[15px]"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-stone-500">
                  新工作起始年份
                  <select value={fromYear} onChange={(e) => setFromYear(e.target.value ? +e.target.value : "")} className="input !w-24 !py-1">
                    <option value="">不限</option>
                    {[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <ModelPicker value={m} onChange={setM} compact />
                <button onClick={() => start()} disabled={!query.trim()} className="btn btn-primary ml-auto">
                  <Compass size={15} /> 开始调研
                </button>
              </div>
              {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            </div>
            <div className="mt-5">
              <p className="mb-2 text-xs text-stone-400">试试这些：</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => setQuery(e)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-stone-600 transition hover:border-brand hover:text-brand">
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-6 text-center text-xs text-stone-400">⏱️ 一次调研约 1–3 分钟（arXiv 接口有限速），可以离开页面，完成后在左侧查看</p>
          </div>
        )}

        {id && topic && (
          <div className="mx-auto max-w-4xl p-6">
            <div className="mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="title-serif text-2xl font-bold leading-tight">{topic.title || topic.query}</h1>
                <p className="mt-1 text-xs text-stone-500">
                  “{topic.query}” · {topic.params.model}
                  {topic.params.from_year ? ` · ${topic.params.from_year} 年起` : ""} · {timeAgo(topic.created_at)}
                  {topic.params.candidates ? ` · 从 ${topic.params.candidates} 篇候选中精选` : ""}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm("删除这个调研专题？（已加入文库的论文不受影响）")) return;
                  await api.deleteTopic(topic.id);
                  await loadList();
                  nav("/research");
                }}
                className="btn btn-ghost !p-1.5 text-stone-400 hover:!text-red-600"
              >
                <Trash2 size={15} />
              </button>
            </div>

            {topic.status === "running" && (
              <div className="card p-6">
                <div className="mb-4 flex items-center justify-between">
                  {STAGES.map((s, i) => (
                    <div key={s} className="flex flex-1 items-center">
                      <div
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
                          i < stageIdx ? "bg-emerald-50 text-emerald-700" : i === stageIdx ? "animate-pulse bg-brand text-white" : "bg-paper-2 text-stone-400"
                        }`}
                      >
                        {STAGE_LABEL[s]}
                      </div>
                      {i < STAGES.length - 1 && <div className={`mx-1 h-px flex-1 ${i < stageIdx ? "bg-emerald-300" : "bg-line"}`} />}
                    </div>
                  ))}
                </div>
                <p className="flex items-center gap-2 text-sm text-stone-600">
                  <Loader2 size={14} className="animate-spin text-brand" />
                  {topic.params.message}
                </p>
              </div>
            )}

            {topic.status === "error" && (
              <div className="card border-red-200 bg-red-50 p-5 text-sm text-red-700">
                😵 调研失败：{topic.error}
                <button onClick={() => start(topic.query)} className="btn btn-outline ml-3 text-xs">
                  重试
                </button>
              </div>
            )}

            {topic.status === "done" && (
              <>
                {topic.overview && (
                  <div className="card relative mb-6 overflow-hidden p-6">
                    <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-brand/10 blur-2xl" />
                    <div className="mb-2 text-xs font-medium tracking-wider text-brand">📜 路线综述</div>
                    <Markdown className="relative">{linkify(topic.overview)}</Markdown>
                  </div>
                )}

                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <h2 className="title-serif mr-2 text-base font-semibold">🗺️ 文献地图</h2>
                  {(["all", "foundation", "milestone", "recent", "survey"] as const).map((r) => {
                    const n = r === "all" ? topic.papers!.length : topic.papers!.filter((p) => p.role === r).length;
                    if (!n) return null;
                    return (
                      <button
                        key={r}
                        onClick={() => setRoleFilter(r)}
                        className={`rounded-full px-2.5 py-1 text-xs transition ${roleFilter === r ? "bg-ink text-white" : "bg-white text-stone-600 ring-1 ring-line hover:bg-paper-2"}`}
                      >
                        {r === "all" ? "全部" : `${ROLE_META[r].emoji} ${ROLE_META[r].label}`} {n}
                      </button>
                    );
                  })}
                  <button onClick={addAll} className="btn btn-outline ml-auto text-xs">
                    <CheckCheck size={14} /> 全部加入文库
                  </button>
                </div>

                <div className="relative pl-6">
                  <div className="absolute bottom-2 left-[9px] top-2 w-0.5 rounded-full bg-gradient-to-b from-amber-300 via-violet-300 to-emerald-300" />
                  {shown.map((p, i) => {
                    const meta = ROLE_META[p.role] ?? ROLE_META.recent;
                    const newYear = i === 0 || shown[i - 1].year !== p.year;
                    return (
                      <div key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
                        {newYear && (
                          <div className="relative -ml-6 mb-2 mt-4 flex items-center first:mt-0">
                            <span className="z-10 rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-white">{p.year}</span>
                          </div>
                        )}
                        <div className="relative mb-2.5">
                          <span className="absolute -left-[21px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand ring-2 ring-brand/20" />
                          <div className="card p-3.5 transition hover:shadow-md">
                            <div className="flex items-start gap-2">
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ${meta.cls}`}>
                                {meta.emoji} {meta.label}
                              </span>
                              <Link to={`/read/${encodeURIComponent(p.id)}`} className="title-serif min-w-0 flex-1 text-[15px] font-semibold leading-snug hover:text-brand">
                                {p.title}
                              </Link>
                              {p.relevance != null && <span className="shrink-0 text-xs font-bold text-brand">{p.relevance}</span>}
                            </div>
                            <p className="mt-1.5 text-[13px] text-stone-700">{p.note}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-stone-400">
                                {p.authors.slice(0, 3).join(", ")}
                                {p.authors.length > 3 && " 等"} · {p.id}
                              </span>
                              <div className="ml-auto flex items-center gap-1">
                                <ReactionBar
                                  value={p.reaction}
                                  size="sm"
                                  onChange={async (r) => {
                                    await api.patchPaper(p.id, { reaction: r });
                                    setTopic((t) => (t ? { ...t, papers: t.papers!.map((x) => (x.id === p.id ? { ...x, reaction: r } : x)) } : t));
                                  }}
                                />
                                <a href={p.abs_url} target="_blank" rel="noreferrer" className="btn btn-ghost !p-1">
                                  <ExternalLink size={13} />
                                </a>
                                {p.in_library ? (
                                  <span className="flex items-center gap-0.5 px-1.5 text-xs text-emerald-600">
                                    <Check size={13} /> 已在文库
                                  </span>
                                ) : (
                                  <button onClick={() => addOne(p.id)} className="btn btn-outline !px-2 !py-0.5 text-xs">
                                    <Plus size={12} /> 文库
                                  </button>
                                )}
                                <Link to={`/read/${encodeURIComponent(p.id)}`} className="btn btn-primary !px-2 !py-0.5 text-xs">
                                  <BookOpen size={12} />
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {shown.length === 0 && <Empty emoji="🫥" title="这一类没有论文" />}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Turn [2301.13196] citations in the overview into reader links. */
function linkify(md: string) {
  return md.replace(/\[(\d{4}\.\d{4,5})\]/g, (_, id) => `[[${id}]](/read/${id})`);
}

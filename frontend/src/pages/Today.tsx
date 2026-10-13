import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Loader2, CheckCheck, Flame, Telescope, Inbox as InboxIcon, History, ArrowRight } from "lucide-react";
import { api, REACTIONS, fmtTime, type Digest, type JobState, type Paper, type Stats, type Trend } from "../api";
import { useApp } from "../store";
import PaperCard, { BuzzLine } from "../components/PaperCard";
import ModelPicker from "../components/ModelPicker";
import JobProgress, { Empty } from "../components/Feedback";

type Tab = "arxiv" | "trending";

const GREETINGS: [number, string, string][] = [
  [5, "🌙", "夜深了，还在读论文的你很酷"],
  [11, "☀️", "早上好，今天想读点什么？"],
  [14, "🍜", "中午好，饭后来一篇？"],
  [18, "🌤️", "下午好，保持好奇"],
  [23, "🌆", "晚上好，安静的读论文时间"],
  [24, "🌙", "夜深了，还在读论文的你很酷"],
];

function usePoll(fetcher: () => Promise<JobState>, onDone: () => void) {
  const [state, setState] = useState<JobState | null>(null);
  const timer = useRef<number>(undefined);
  const wasRunning = useRef(false);
  const poll = async () => {
    const s = await fetcher();
    setState(s);
    if (s.running) {
      wasRunning.current = true;
      timer.current = window.setTimeout(poll, 1000);
    } else if (wasRunning.current) {
      wasRunning.current = false;
      if (s.stage === "done") onDone();
    }
  };
  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, []);
  const kick = (s: JobState) => {
    setState(s);
    wasRunning.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(poll, 800);
  };
  return { state, kick };
}

function Heatmap({ data }: { data: Record<string, number> }) {
  const days = useMemo(() => {
    const out: { d: string; c: number }[] = [];
    const now = new Date();
    for (let i = 83; i >= 0; i--) {
      const dt = new Date(now);
      dt.setDate(now.getDate() - i);
      const d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      out.push({ d, c: data[d] || 0 });
    }
    return out;
  }, [data]);
  const lvl = (c: number) => (c === 0 ? "bg-paper-2" : c < 3 ? "bg-brand/25" : c < 8 ? "bg-brand/50" : c < 15 ? "bg-brand/75" : "bg-brand");
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
      {days.map((x) => (
        <div key={x.d} className={`h-[9px] w-[9px] rounded-[2px] ${lvl(x.c)}`} title={`${x.d}：${x.c} 次活动`} />
      ))}
    </div>
  );
}

function Dashboard({ stats }: { stats: Stats | null }) {
  const h = new Date().getHours();
  const [emoji, greet] = GREETINGS.find(([hh]) => h < hh)!.slice(1) as [string, string];
  const total = REACTIONS.reduce((s, r) => s + (stats?.reactions[r.key] || 0), 0);
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-brand/15 to-ember/15 blur-2xl" />
      <div className="relative flex flex-wrap items-start gap-6">
        <div className="min-w-[220px] flex-1">
          <div className="text-3xl">{emoji}</div>
          <h1 className="title-serif mt-1 text-xl font-bold text-ink">{greet}</h1>
          <p className="mt-1 text-xs text-stone-500">
            {new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
            {stats && stats.inbox > 0 && <> · 收件箱还有 <b className="text-brand">{stats.inbox}</b> 篇待筛选</>}
          </p>
        </div>
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Stat n={stats.streak} label="连续活跃" unit="天" emoji={stats.streak >= 3 ? "🔥" : "🌱"} />
              <Stat n={stats.opened_week} label="本周打开" unit="篇" emoji="📖" />
              <Stat n={stats.library} label="文库" unit="篇" emoji="📚" />
              <Stat n={stats.ideas_total} label="灵感" unit="条" emoji="💭" />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] text-stone-400">近 12 周</div>
              <Heatmap data={stats.heatmap} />
            </div>
            {total > 0 && (
              <div className="min-w-[160px]">
                <div className="mb-1.5 text-[11px] text-stone-400">我的口味</div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                  {REACTIONS.map((r) =>
                    stats.reactions[r.key] ? (
                      <div
                        key={r.key}
                        title={`${r.emoji} ${r.label} ${stats.reactions[r.key]}`}
                        style={{ flex: stats.reactions[r.key] }}
                        className={r.tone === "pos" ? "bg-ember/80 even:bg-brand/80" : r.tone === "mid" ? "bg-amber-300" : "bg-stone-300"}
                      />
                    ) : null,
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-2 text-xs">
                  {REACTIONS.filter((r) => stats.reactions[r.key]).map((r) => (
                    <span key={r.key}>
                      {r.emoji}
                      <span className="text-stone-500">{stats.reactions[r.key]}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ASK_CHIPS = ["这周热榜里哪些和我最相关？", "帮我找 Agent 方向近一年的重要论文", "我的灵感里哪个最值得推进？", "整理一下我文库里的 RAG 论文"];

function AskBox() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const go = (text = q) => text.trim() && nav(`/assistant?q=${encodeURIComponent(text.trim())}`);
  return (
    <div className="card relative overflow-hidden p-1.5 ring-1 ring-brand/10">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand/[0.04] via-transparent to-ember/[0.05]" />
      <form
        className="relative flex items-center gap-2 px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <span className="text-xl">✨</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="问问 AI 研究助理：找论文、讨论问题、整理文库、记灵感、发起调研…"
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-stone-400"
        />
        <button className="btn btn-fun !rounded-xl" disabled={!q.trim()}>
          发送
        </button>
      </form>
      <div className="relative flex flex-wrap gap-1.5 px-3 pb-2">
        {ASK_CHIPS.map((c) => (
          <button key={c} onClick={() => go(c)} className="rounded-full bg-paper-2 px-2.5 py-1 text-xs text-stone-600 transition hover:bg-brand-soft hover:text-brand">
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ n, label, unit, emoji }: { n: number; label: string; unit: string; emoji: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-lg">{emoji}</span>
      <div>
        <div className="leading-none">
          <b className="text-lg text-ink">{n}</b>
          <span className="ml-0.5 text-xs text-stone-500">{unit}</span>
        </div>
        <div className="text-[11px] text-stone-400">{label}</div>
      </div>
    </div>
  );
}

export default function TodayPage() {
  const { settings, notify } = useApp();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("today-tab") as Tab) || "arxiv");
  const [stats, setStats] = useState<Stats | null>(null);
  // arXiv push
  const [count, setCount] = useState(10);
  const [days, setDays] = useState(2);
  const [model, setModel] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [digestId, setDigestId] = useState<number | "inbox">("inbox");
  // trending
  const [tDays, setTDays] = useState(7);
  const [tCount, setTCount] = useState(20);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [trendList, setTrendList] = useState<{ id: number; created_at: number }[]>([]);
  const [err, setErr] = useState("");

  const loadStats = () => api.stats().then(setStats);
  const loadPapers = async (d = digestId) =>
    setPapers(d === "inbox" ? await api.papers({ status: "inbox" }) : await api.papers({ digest_id: d }));
  const loadTrend = async (id?: number) => {
    setTrend(id ? await api.trend(id) : await api.trendLatest());
    setTrendList(await api.trends());
  };

  const push = usePoll(api.pushStatus, async () => {
    setDigests(await api.digests());
    setDigestId("inbox");
    loadPapers("inbox");
    loadStats();
    notify("📬 推送完成！");
  });
  const trending = usePoll(api.trendingStatus, () => {
    loadTrend();
    notify("🔥 热榜更新完成！");
  });

  useEffect(() => {
    loadStats();
    api.digests().then(setDigests);
    loadTrend();
  }, []);
  useEffect(() => {
    if (settings) {
      setCount(settings.push_count);
      setDays(settings.push_days);
      setTCount(settings.trend_count);
      setTDays(settings.trend_days);
      setModel((m) => m || settings.push_model);
    }
  }, [settings]);
  useEffect(() => {
    loadPapers();
  }, [digestId]);
  useEffect(() => {
    localStorage.setItem("today-tab", tab);
  }, [tab]);

  const startPush = async () => {
    setErr("");
    try {
      await api.saveSettings({ push_count: count, push_days: days, push_model: model });
      push.kick(await api.startPush({ count, days, model }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const startTrending = async () => {
    setErr("");
    try {
      await api.saveSettings({ trend_count: tCount, trend_days: tDays, push_model: model });
      trending.kick(await api.startTrending({ days: tDays, count: tCount, model }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const onChange = (p: Paper) => {
    setPapers((ps) =>
      digestId === "inbox" && p.status !== "inbox" ? ps.filter((x) => x.id !== p.id) : ps.map((x) => (x.id === p.id ? p : x)),
    );
    loadStats();
  };
  const onTrendChange = (p: Paper) =>
    setTrend((t) => (t ? { ...t, items: t.items.map((x) => (x.id === p.id ? { ...x, ...p } : x)) } : t));

  const markAllLater = async () => {
    if (!confirm(`将收件箱中 ${papers.length} 篇全部移到「稍后读」？`)) return;
    await api.bulkStatus(papers.map((p) => p.id), "later");
    loadPapers();
    loadStats();
  };
  const ignoreRest = async () => {
    const rest = papers.filter((p) => !p.reaction);
    if (!confirm(`将 ${rest.length} 篇没有表态的论文标记为忽略？`)) return;
    await api.bulkStatus(rest.map((p) => p.id), "ignored");
    loadPapers();
  };

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setTab(t)}
      className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
        tab === t ? "bg-white text-ink shadow-sm ring-1 ring-line" : "text-stone-500 hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <Dashboard stats={stats} />
        <AskBox />

        <div className="flex items-center gap-1 rounded-full bg-paper-2 p-1 w-fit">
          {tabBtn("arxiv", "arXiv 新论文", <InboxIcon size={15} />)}
          {tabBtn("trending", "社区热榜 & 话题", <Flame size={15} />)}
        </div>

        {tab === "arxiv" && (
          <div className="flex gap-5">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="card p-5">
                <div className="flex flex-wrap items-end gap-4">
                  <label>
                    <div className="mb-1 text-xs text-stone-500">推送数量</div>
                    <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(+e.target.value)} className="input !w-20" />
                  </label>
                  <label>
                    <div className="mb-1 text-xs text-stone-500">时间范围</div>
                    <select value={days} onChange={(e) => setDays(+e.target.value)} className="input !w-28">
                      {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                        <option key={d} value={d}>
                          最近 {d} 天
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <div className="mb-1 text-xs text-stone-500">模型</div>
                    <ModelPicker value={model} onChange={setModel} />
                  </div>
                  <button onClick={startPush} disabled={push.state?.running} className="btn btn-fun ml-auto !rounded-xl !px-5 !py-2.5">
                    {push.state?.running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {push.state?.running ? "推送中…" : "开始推送"}
                  </button>
                </div>
                <p className="mt-3 text-xs text-stone-400">
                  📡 {settings?.categories.join(" · ") || "未设置分类"}
                  {settings?.keywords.length ? ` · 关键词：${settings.keywords.join(", ")}` : ""}
                  {" · "}最多评估 {settings?.max_candidates} 篇候选
                </p>
                <JobProgress state={push.state} />
                {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
              </div>

              <div className="flex items-center gap-2">
                <h2 className="title-serif text-base font-semibold">
                  {digestId === "inbox" ? `📥 收件箱 · ${papers.length} 篇待筛选` : `📬 推送 #${digestId} · ${papers.length} 篇`}
                </h2>
                {digestId === "inbox" && papers.length > 0 && (
                  <div className="ml-auto flex gap-1">
                    <button onClick={ignoreRest} className="btn btn-ghost text-xs">
                      🙈 忽略未表态的
                    </button>
                    <button onClick={markAllLater} className="btn btn-ghost text-xs">
                      <CheckCheck size={14} /> 全部稍后读
                    </button>
                  </div>
                )}
              </div>
              {digestId === "inbox" && papers.length > 0 && (
                <p className="-mt-2 text-xs text-stone-400">
                  给论文点个表情吧：🔥🤩💡 会让同类论文排得更靠前，🗑️🙅 会让它们少出现
                </p>
              )}
              <div className="space-y-3">
                {papers.map((p, i) => (
                  <PaperCard key={p.id} paper={p} onChange={onChange} showStatus={digestId !== "inbox"} index={i} />
                ))}
                {papers.length === 0 && (
                  <Empty
                    emoji={digestId === "inbox" ? "📭" : "🫥"}
                    title={digestId === "inbox" ? "收件箱空空如也" : "这次推送没有论文"}
                    hint={digestId === "inbox" ? "点「开始推送」，让 AI 从今天的 arXiv 里帮你挑论文" : undefined}
                  />
                )}
              </div>
            </div>

            <aside className="w-52 shrink-0">
              <div className="sticky top-0 space-y-1">
                <button
                  onClick={() => setDigestId("inbox")}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm ${digestId === "inbox" ? "bg-ink text-white" : "hover:bg-paper-2"}`}
                >
                  <InboxIcon size={15} /> 收件箱
                </button>
                <div className="flex items-center gap-1 px-3 pb-1 pt-3 text-[11px] font-medium text-stone-400">
                  <History size={11} /> 推送历史
                </div>
                {digests.length === 0 && <p className="px-3 text-xs text-stone-400">暂无</p>}
                {digests.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDigestId(d.id)}
                    className={`flex w-full flex-col rounded-xl px-3 py-1.5 text-left text-xs ${digestId === d.id ? "bg-ink text-white" : "hover:bg-paper-2"}`}
                  >
                    <span className="font-medium">{fmtTime(d.created_at)}</span>
                    <span className="opacity-60">
                      {d.paper_ids.length} 篇 / {d.candidates} 候选
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}

        {tab === "trending" && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="flex flex-wrap items-end gap-4">
                <div className="max-w-md flex-1">
                  <h3 className="title-serif flex items-center gap-1.5 font-semibold">
                    <Flame size={16} className="text-ember" /> 社区在讨论什么？
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">
                    汇总 alphaXiv 热度榜（浏览/点赞/GitHub，与 X 上的讨论高度相关）和 Hacker News 上的 arXiv 讨论，AI 按你的兴趣筛选，并归纳正在升温的话题。
                  </p>
                </div>
                <label>
                  <div className="mb-1 text-xs text-stone-500">时间窗口</div>
                  <select value={tDays} onChange={(e) => setTDays(+e.target.value)} className="input !w-28">
                    {[3, 7, 30, 90].map((d) => (
                      <option key={d} value={d}>
                        近 {d} 天
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="mb-1 text-xs text-stone-500">精选数量</div>
                  <input type="number" min={5} max={60} value={tCount} onChange={(e) => setTCount(+e.target.value)} className="input !w-20" />
                </label>
                <div>
                  <div className="mb-1 text-xs text-stone-500">模型</div>
                  <ModelPicker value={model} onChange={setModel} />
                </div>
                <button onClick={startTrending} disabled={trending.state?.running} className="btn btn-fun !rounded-xl !px-5 !py-2.5">
                  {trending.state?.running ? <Loader2 size={16} className="animate-spin" /> : <Flame size={16} />}
                  {trending.state?.running ? "刷新中…" : "刷新热榜"}
                </button>
              </div>
              <JobProgress state={trending.state} />
              {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
              {trendList.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-stone-400">
                  历史：
                  {trendList.slice(0, 8).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadTrend(t.id)}
                      className={`rounded-full px-2 py-0.5 ${trend?.id === t.id ? "bg-ink text-white" : "hover:bg-paper-2"}`}
                    >
                      {fmtTime(t.created_at)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!trend && !trending.state?.running && (
              <Empty emoji="🔭" title="还没有热榜" hint="点「刷新热榜」看看这周大家都在聊什么" />
            )}

            {trend && trend.topics.length > 0 && (
              <div>
                <h2 className="title-serif mb-3 flex items-center gap-2 text-base font-semibold">
                  <Telescope size={17} className="text-brand" /> 升温话题
                  <span className="text-xs font-normal text-stone-400">{fmtTime(trend.created_at)} · 来自 {trend.params.candidates} 篇社区热门</span>
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {trend.topics.map((t, i) => (
                    <TopicCard key={i} t={t} index={i} />
                  ))}
                </div>
              </div>
            )}

            {trend && (
              <div>
                <h2 className="title-serif mb-3 flex items-center gap-2 text-base font-semibold">
                  <Flame size={17} className="text-ember" /> 为你精选的热门论文
                </h2>
                <div className="space-y-3">
                  {trend.items.map((p, i) => (
                    <PaperCard key={p.id} paper={p} onChange={onTrendChange} showStatus index={i} extra={<div className="mt-1.5"><BuzzLine item={p} /></div>} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TOPIC_BG = [
  "from-violet-50 to-fuchsia-50",
  "from-amber-50 to-orange-50",
  "from-emerald-50 to-teal-50",
  "from-sky-50 to-indigo-50",
  "from-rose-50 to-pink-50",
];

function TopicCard({ t, index }: { t: Trend["topics"][number]; index: number }) {
  const { quickIdea } = useApp();
  return (
    <div
      className={`animate-rise rounded-2xl border border-line bg-gradient-to-br p-4 ${TOPIC_BG[index % TOPIC_BG.length]}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start gap-2">
        <span className="text-2xl">{t.emoji}</span>
        <h3 className="title-serif flex-1 text-[15px] font-semibold leading-snug text-ink">{t.title}</h3>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-stone-700">{t.summary}</p>
      <div className="mt-2.5 space-y-1">
        {t.papers.map((p) => (
          <Link
            key={p.id}
            to={`/read/${encodeURIComponent(p.id)}`}
            className="flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-xs text-stone-700 hover:bg-white hover:text-brand"
          >
            <ArrowRight size={11} className="shrink-0 text-stone-400" />
            <span className="truncate">{p.title}</span>
          </Link>
        ))}
      </div>
      {t.question && (
        <button
          onClick={() => quickIdea({ text: `${t.emoji} ${t.title}\n> ${t.question}` })}
          className="mt-3 w-full rounded-xl border border-dashed border-stone-300 bg-white/50 px-3 py-2 text-left text-xs text-stone-600 transition hover:border-brand hover:bg-white hover:text-brand"
          title="把这个问题记到灵感本"
        >
          🤔 <b>值得深挖：</b>
          {t.question}
          <span className="ml-1 text-brand">→ 记成灵感</span>
        </button>
      )}
    </div>
  );
}

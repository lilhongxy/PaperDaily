import { useEffect, useState } from "react";
import { Save, Zap, Loader2, Download, X, Plus } from "lucide-react";
import { api, type Settings } from "../api";
import { useApp } from "../store";
import ModelPicker from "../components/ModelPicker";

const COMMON_CATS = ["cs.CL", "cs.LG", "cs.AI", "cs.CV", "cs.IR", "cs.RO", "cs.MA", "cs.SE", "cs.CR", "cs.HC", "stat.ML", "eess.AS", "eess.IV"];

export default function SettingsPage() {
  const { settings, reload, models } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [catInput, setCatInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [test, setTest] = useState<{ loading: boolean; msg: string; ok?: boolean }>({ loading: false, msg: "" });
  const [remote, setRemote] = useState<string[] | null>(null);

  useEffect(() => {
    if (settings) setS(settings);
  }, [settings]);
  if (!s) return null;

  const up = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch });
    setSaved(false);
  };

  const save = async () => {
    const { api_configured: _a, base_url: _b, ...rest } = s;
    await api.saveSettings(rest);
    await reload();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleCat = (c: string) =>
    up({ categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c] });

  const runTest = async () => {
    setTest({ loading: true, msg: "" });
    try {
      const r = await api.testModel(s.reader_model);
      setTest({ loading: false, ok: true, msg: `✅ ${s.reader_model} 可用（${r.latency}s）：${r.reply}` });
    } catch (e) {
      setTest({ loading: false, ok: false, msg: `❌ ${(e as Error).message}` });
    }
  };

  const fetchRemote = async () => {
    try {
      setRemote(await api.remoteModels());
    } catch (e) {
      setTest({ loading: false, ok: false, msg: `获取模型列表失败：${(e as Error).message}` });
    }
  };

  const addModel = (m: string) => {
    m = m.trim();
    if (m && !s.custom_models.includes(m)) up({ custom_models: [...s.custom_models, m] });
  };

  const section = (title: string, desc: string, children: React.ReactNode) => (
    <section className="card p-5">
      <h2 className="title-serif text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-stone-500">{desc}</p>
      {children}
    </section>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        {section(
          "🔌 AI 接口",
          "API Key 在 backend/.env 中配置（留空则沿用终端环境变量 ANTHROPIC_API_KEY）。修改 .env 后无需重启。",
          <div className="space-y-2 text-sm">
            <div>
              状态：
              {s.api_configured ? <span className="text-emerald-600">已检测到 API Key</span> : <span className="text-red-600">未配置 API Key</span>}
              <span className="ml-3 text-stone-500">地址：{s.base_url}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={runTest} disabled={test.loading} className="btn btn-outline">
                {test.loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} 测试当前阅读模型
              </button>
              <button onClick={fetchRemote} className="btn btn-outline">
                <Download size={14} /> 从 API 获取模型列表
              </button>
            </div>
            {test.msg && <p className={`text-xs ${test.ok ? "text-emerald-700" : "text-red-600"}`}>{test.msg}</p>}
          </div>,
        )}

        {section(
          "🤖 模型",
          "可以为推送与热榜（批量评分，量大，可选更便宜的模型）和阅读（精读、对话、调研、灵感）分别设置默认模型；顶栏可随时切换阅读模型。",
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-20 text-stone-500">推送 / 热榜</span>
              <ModelPicker value={s.push_model} onChange={(m) => up({ push_model: m })} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-20 text-stone-500">阅读模型</span>
              <ModelPicker value={s.reader_model} onChange={(m) => up({ reader_model: m })} />
            </div>
            <div>
              <div className="mb-1 text-xs text-stone-500">自定义模型（接口支持的任意模型名）</div>
              <div className="mb-2 flex flex-wrap gap-1">
                {s.custom_models.map((m) => (
                  <span key={m} className="chip">
                    {m}
                    <button className="ml-1" onClick={() => up({ custom_models: s.custom_models.filter((x) => x !== m) })}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addModel(modelInput);
                  setModelInput("");
                }}
              >
                <input value={modelInput} onChange={(e) => setModelInput(e.target.value)} placeholder="例如 claude-sonnet-5-5" className="input !w-72" />
                <button className="btn btn-outline">
                  <Plus size={14} />
                  添加
                </button>
              </form>
              {remote && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {remote.map((m) => (
                    <button
                      key={m}
                      onClick={() => addModel(m)}
                      disabled={models.includes(m) || s.custom_models.includes(m)}
                      className="chip hover:bg-brand-soft disabled:opacity-40"
                    >
                      + {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
        )}

        {section(
          "🎯 研究兴趣",
          "用自然语言描述你的研究方向和关注点，AI 据此为论文打分并给出推荐理由。你给论文点的表情（🔥🤩💡 / 🗑️🙅）会自动作为反馈。",
          <textarea
            value={s.interest}
            onChange={(e) => up({ interest: e.target.value })}
            rows={5}
            placeholder="例如：我研究大语言模型的推理与对齐，尤其关注强化学习微调（RLHF/RLVR）、长链思维推理、评测基准；对多模态和纯 CV 论文兴趣较低。"
            className="input"
          />,
        )}

        {section(
          "📡 arXiv 订阅",
          "推送时从这些分类中抓取候选论文；关键词可选，填写后只抓取包含任一关键词的论文。",
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...COMMON_CATS, ...s.categories])].map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${s.categories.includes(c) ? "border-brand bg-brand-soft text-brand" : "border-line bg-white hover:bg-paper-2"}`}
                >
                  {c}
                </button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (catInput.trim()) toggleCat(catInput.trim());
                  setCatInput("");
                }}
              >
                <input value={catInput} onChange={(e) => setCatInput(e.target.value)} placeholder="其他分类，如 q-bio.NC" className="input !w-44 !py-1 text-xs" />
              </form>
            </div>
            <label className="block">
              <div className="mb-1 text-xs text-stone-500">关键词（逗号分隔，可留空）</div>
              <input
                value={s.keywords.join(", ")}
                onChange={(e) => up({ keywords: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) })}
                placeholder="例如 reasoning, reinforcement learning, agent"
                className="input"
              />
            </label>
            <div className="flex gap-6">
              <label>
                <div className="mb-1 text-xs text-stone-500">默认推送数量</div>
                <input type="number" min={1} max={100} value={s.push_count} onChange={(e) => up({ push_count: +e.target.value })} className="input !w-24" />
              </label>
              <label>
                <div className="mb-1 text-xs text-stone-500">默认时间范围（天）</div>
                <input type="number" min={1} max={30} value={s.push_days} onChange={(e) => up({ push_days: +e.target.value })} className="input !w-24" />
              </label>
              <label>
                <div className="mb-1 text-xs text-stone-500">最多评估候选数</div>
                <input type="number" min={10} max={1000} step={10} value={s.max_candidates} onChange={(e) => up({ max_candidates: +e.target.value })} className="input !w-24" />
              </label>
            </div>
          </div>,
        )}

        {section(
          "🔥 热榜与调研",
          "社区热榜从 alphaXiv（热度与 X/Twitter 讨论高度相关）与 Hacker News 获取；调研专题由 AI 规划、在 arXiv 上核实与检索。",
          <div className="flex flex-wrap gap-6 text-sm">
            <label>
              <div className="mb-1 text-xs text-stone-500">热榜默认窗口</div>
              <select value={s.trend_days} onChange={(e) => up({ trend_days: +e.target.value })} className="input !w-28">
                {[3, 7, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    近 {d} 天
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div className="mb-1 text-xs text-stone-500">热榜精选数量</div>
              <input type="number" min={5} max={60} value={s.trend_count} onChange={(e) => up({ trend_count: +e.target.value })} className="input !w-24" />
            </label>
            <label>
              <div className="mb-1 text-xs text-stone-500">调研专题最多收录</div>
              <input type="number" min={10} max={80} value={s.research_max} onChange={(e) => up({ research_max: +e.target.value })} className="input !w-24" />
            </label>
          </div>,
        )}

        <div className="sticky bottom-0 flex justify-end bg-gradient-to-t from-paper via-paper/90 py-3">
          <button onClick={save} className="btn btn-fun !rounded-xl !px-6">
            <Save size={15} />
            {saved ? "已保存 ✓" : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}

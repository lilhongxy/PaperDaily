export type Status = "inbox" | "pool" | "later" | "reading" | "read" | "archived" | "ignored";
export type Reaction = "must" | "love" | "insight" | "doubt" | "meh" | "trash" | "nope";

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  published: string;
  pdf_url: string;
  abs_url: string;
  status: Status;
  reaction: Reaction | null;
  score: number | null;
  reason: string | null;
  tldr: string | null;
  tags: string[];
  analysis?: string | null;
  has_analysis?: boolean;
  digest_id: number | null;
  source: string | null;
  created_at: number;
  updated_at: number;
}

export interface Highlight {
  id: number;
  paper_id: string;
  text: string;
  page: number | null;
  comment: string;
  created_at: number;
}

export interface ChatMsg {
  id?: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  mode?: string;
}

export interface PaperDetail extends Paper {
  note: { content: string; updated_at: number | null };
  highlights: Highlight[];
  chats: ChatMsg[];
}

export interface Settings {
  interest: string;
  categories: string[];
  keywords: string[];
  push_count: number;
  push_days: number;
  max_candidates: number;
  push_model: string;
  reader_model: string;
  custom_models: string[];
  trend_count: number;
  trend_days: number;
  research_max: number;
  api_configured?: boolean;
  base_url?: string;
}

export interface JobState {
  running: boolean;
  stage: string;
  message: string;
  progress: number;
  error: string | null;
  result_id: number | null;
  started_at: number | null;
}

export interface Digest {
  id: number;
  created_at: number;
  params: { count: number; days: number; model: string; categories: string[]; keywords: string[] };
  paper_ids: string[];
  candidates: number;
}

export interface TrendItem extends Paper {
  heat: number;
  buzz?: { views: number; votes: number; stars: number; topics: string[]; blurb: string; thumb?: string } | null;
  hn?: { points: number; comments: number; title: string; url: string } | null;
}

export interface TrendTopic {
  emoji: string;
  title: string;
  summary: string;
  question: string;
  paper_ids: string[];
  papers: Paper[];
}

export interface Trend {
  id: number;
  created_at: number;
  params: { days: number; count: number; model: string; candidates: number };
  items: TrendItem[];
  topics: TrendTopic[];
}

export type TopicRole = "foundation" | "milestone" | "recent" | "survey";

export interface ResearchTopic {
  id: number;
  query: string;
  title: string | null;
  status: "running" | "done" | "error";
  overview?: string | null;
  error: string | null;
  params: { from_year: number | null; model: string; stage?: string; message?: string; candidates?: number };
  count?: number;
  papers?: (Paper & { role: TopicRole; note: string; relevance: number | null; year: string; in_library: boolean })[];
  created_at: number;
  updated_at: number;
}

export interface RelatedPaper {
  id: string;
  title: string;
  authors: string[];
  year: string;
  abstract: string;
  relation: string;
  why: string;
  status: Status;
  in_library: boolean;
}

export type IdeaStatus = "seed" | "growing" | "formed" | "doing" | "shelved";

export interface Idea {
  id: number;
  title: string;
  content: string;
  status: IdeaStatus;
  tags: string[];
  pinned: boolean;
  created_at: number;
  updated_at: number;
  paper_count?: number;
  chat_count?: number;
  papers?: Paper[];
  chats?: ChatMsg[];
}

export interface Stats {
  streak: number;
  opened_week: number;
  finished_week: number;
  ideas_total: number;
  ideas_week: number;
  library: number;
  inbox: number;
  reactions: Partial<Record<Reaction, number>>;
  heatmap: Record<string, number>;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

const enc = encodeURIComponent;
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  return q.toString();
};

export const api = {
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("PUT", "/api/settings", s),
  models: () => req<string[]>("GET", "/api/models"),
  remoteModels: () => req<string[]>("GET", "/api/models/remote"),
  testModel: (model: string) => req<{ reply: string; latency: number }>("POST", "/api/models/test", { model }),
  stats: () => req<Stats>("GET", "/api/stats"),

  startPush: (p: { count: number; days: number; model: string }) => req<JobState>("POST", "/api/push", p),
  pushStatus: () => req<JobState>("GET", "/api/push/status"),
  digests: () => req<Digest[]>("GET", "/api/digests"),

  startTrending: (p: { days: number; count: number; model: string }) => req<JobState>("POST", "/api/trending", p),
  trendingStatus: () => req<JobState>("GET", "/api/trending/status"),
  trends: () => req<{ id: number; created_at: number; params: Trend["params"] }[]>("GET", "/api/trends"),
  trendLatest: () => req<Trend | null>("GET", "/api/trends/latest"),
  trend: (id: number) => req<Trend>("GET", `/api/trends/${id}`),

  createTopic: (p: { query: string; from_year: number | null; model: string }) => req<{ id: number }>("POST", "/api/topics", p),
  topics: () => req<ResearchTopic[]>("GET", "/api/topics"),
  topic: (id: number) => req<ResearchTopic>("GET", `/api/topics/${id}`),
  deleteTopic: (id: number) => req("DELETE", `/api/topics/${id}`),

  papers: (params: Record<string, string | number | boolean | undefined>) => req<Paper[]>("GET", `/api/papers?${qs(params)}`),
  counts: () => req<{ status: Partial<Record<Status, number>>; reaction: Partial<Record<Reaction, number>>; notes: number }>("GET", "/api/papers/counts"),
  tags: () => req<{ tag: string; c: number }[]>("GET", "/api/tags"),
  paper: (id: string) => req<PaperDetail>("GET", `/api/papers/${enc(id)}`),
  patchPaper: (id: string, p: { status?: Status; reaction?: Reaction | null; tags?: string[] }) => req<Paper>("PATCH", `/api/papers/${enc(id)}`, p),
  bulkStatus: (ids: string[], status: Status) => req("POST", "/api/papers/bulk-status", { ids, status }),
  deletePaper: (id: string) => req("DELETE", `/api/papers/${enc(id)}`),
  addPaper: (arxiv: string) => req<Paper>("POST", "/api/papers", { arxiv }),
  pdfUrl: (id: string) => `/api/papers/${enc(id)}/pdf`,
  related: (id: string, refresh = false, model?: string) => req<RelatedPaper[]>("GET", `/api/papers/${enc(id)}/related?${qs({ refresh, model })}`),
  paperIdeas: (id: string) => req<Idea[]>("GET", `/api/papers/${enc(id)}/ideas`),

  saveNote: (id: string, content: string) => req<{ updated_at: number }>("PUT", `/api/notes/${enc(id)}`, { content }),
  notes: (q?: string) =>
    req<{ paper_id: string; content: string; updated_at: number; title: string; status: Status; reaction: Reaction | null; tags: string[] }[]>(
      "GET", `/api/notes?${qs({ q })}`),
  addHighlight: (h: { paper_id: string; text: string; page: number | null; comment?: string }) => req<Highlight>("POST", "/api/highlights", h),
  patchHighlight: (id: number, comment: string) => req("PATCH", `/api/highlights/${id}`, { comment }),
  deleteHighlight: (id: number) => req("DELETE", `/api/highlights/${id}`),
  clearChat: (id: string) => req("DELETE", `/api/ai/chat/${enc(id)}`),

  ideas: (p: { q?: string; status?: string } = {}) => req<Idea[]>("GET", `/api/ideas?${qs(p)}`),
  idea: (id: number) => req<Idea>("GET", `/api/ideas/${id}`),
  createIdea: (p: { title?: string; content?: string; status?: IdeaStatus; tags?: string[]; paper_ids?: string[] }) => req<Idea>("POST", "/api/ideas", p),
  patchIdea: (id: number, p: Partial<Pick<Idea, "title" | "content" | "status" | "tags" | "pinned">>) => req<Idea>("PATCH", `/api/ideas/${id}`, p),
  deleteIdea: (id: number) => req("DELETE", `/api/ideas/${id}`),
  linkPaper: (id: number, paper_id: string) => req<Idea>("POST", `/api/ideas/${id}/papers`, { paper_id }),
  unlinkPaper: (id: number, paper_id: string) => req<Idea>("DELETE", `/api/ideas/${id}/papers/${enc(paper_id)}`),
  clearIdeaChats: (id: number) => req("DELETE", `/api/ideas/${id}/chats`),
};

export interface AssistantThread {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MiniPaper {
  id: string;
  title: string;
  authors?: string[];
  year?: string;
  tldr?: string | null;
  status?: Status | null;
  reaction?: Reaction | null;
  in_library?: boolean;
  heat?: number;
}

export type ToolUI =
  | { kind: "papers"; papers: MiniPaper[] }
  | { kind: "ideas"; ideas: { id: number; title: string; status: IdeaStatus; tags: string[] }[]; created?: boolean }
  | { kind: "topics"; topics: { id: number; title: string; status: string; papers: number }[] }
  | { kind: "note"; text: string; paper?: { id: string; title: string } };

export type AssistantItem =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown>; ok: boolean | null; ui: ToolUI | null; error?: string | null };

export type AssistantEvent =
  | { type: "thread"; id: number }
  | { type: "text"; t: string }
  | { type: "tool_pending"; name: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; ok: boolean; ui: ToolUI | null; error: string | null }
  | { type: "done" }
  | { type: "error"; error: string };

export const assistantApi = {
  threads: () => req<AssistantThread[]>("GET", "/api/assistant/threads"),
  thread: (id: number) => req<AssistantThread & { items: AssistantItem[] }>("GET", `/api/assistant/threads/${id}`),
  deleteThread: (id: number) => req("DELETE", `/api/assistant/threads/${id}`),
};

/** POST and consume an SSE stream of JSON events. */
export async function streamEvents<E>(url: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (line.startsWith("data:")) onEvent(JSON.parse(line.slice(5)));
    }
  }
}

/** POST and consume an SSE text stream. Calls onText with each chunk; resolves with the full text. */
export async function streamAI(
  url: string,
  body: unknown,
  onText: (chunk: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith("data:")) continue;
      const msg = JSON.parse(line.slice(5));
      if (msg.error) throw new Error(msg.error);
      if (msg.t) {
        full += msg.t;
        onText(msg.t, full);
      }
    }
  }
  return full;
}

export const STATUS_LABEL: Record<Status, string> = {
  inbox: "收件箱",
  pool: "未收录",
  later: "稍后读",
  reading: "在读",
  read: "已读",
  archived: "归档",
  ignored: "已忽略",
};

export const REACTIONS: { key: Reaction; emoji: string; label: string; tone: "pos" | "mid" | "neg" }[] = [
  { key: "must", emoji: "🔥", label: "必读", tone: "pos" },
  { key: "love", emoji: "🤩", label: "很赞", tone: "pos" },
  { key: "insight", emoji: "💡", label: "有启发", tone: "pos" },
  { key: "doubt", emoji: "🤔", label: "存疑", tone: "mid" },
  { key: "meh", emoji: "😐", label: "一般", tone: "mid" },
  { key: "trash", emoji: "🗑️", label: "没价值", tone: "neg" },
  { key: "nope", emoji: "🙅", label: "不感兴趣", tone: "neg" },
];
export const REACTION_MAP = Object.fromEntries(REACTIONS.map((r) => [r.key, r])) as Record<Reaction, (typeof REACTIONS)[number]>;

export const IDEA_STATUS: { key: IdeaStatus; emoji: string; label: string }[] = [
  { key: "seed", emoji: "💭", label: "萌芽" },
  { key: "growing", emoji: "🌱", label: "发展中" },
  { key: "formed", emoji: "🌳", label: "成型" },
  { key: "doing", emoji: "🧪", label: "在做" },
  { key: "shelved", emoji: "📦", label: "搁置" },
];
export const IDEA_STATUS_MAP = Object.fromEntries(IDEA_STATUS.map((s) => [s.key, s])) as Record<IdeaStatus, (typeof IDEA_STATUS)[number]>;

export const ROLE_META: Record<TopicRole, { label: string; emoji: string; cls: string }> = {
  foundation: { label: "奠基", emoji: "🏛️", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  milestone: { label: "关键进展", emoji: "🚩", cls: "bg-violet-100 text-violet-800 ring-violet-200" },
  recent: { label: "最新", emoji: "✨", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  survey: { label: "综述", emoji: "📚", cls: "bg-sky-100 text-sky-800 ring-sky-200" },
};

export const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const timeAgo = (ts: number) => {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN");
};

import { Loader2 } from "lucide-react";
import type { JobState } from "../api";

const QUIPS = [
  "正在和 arXiv 握手 🤝",
  "AI 正在戴上老花镜 🧐",
  "给每篇论文泡一杯咖啡 ☕",
  "翻阅中…请勿打扰 📖",
  "在摘要的海洋里捞珍珠 🦪",
  "和审稿人 2 号据理力争 ⚔️",
];

export default function JobProgress({ state }: { state: JobState | null }) {
  if (!state || state.stage === "idle") return null;
  const quip = QUIPS[Math.floor((state.started_at ?? 0) % QUIPS.length)];
  return (
    <div className="mt-4">
      <div className="h-2 overflow-hidden rounded-full bg-paper-2">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            state.error ? "bg-red-500" : state.stage === "done" ? "bg-emerald-500" : "bg-gradient-to-r from-brand via-[#8b5cf6] to-ember"
          } ${state.running ? "animate-pulse" : ""}`}
          style={{ width: `${Math.max(4, Math.round(state.progress * 100))}%` }}
        />
      </div>
      <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${state.error ? "text-red-600" : state.stage === "done" ? "text-emerald-700" : "text-stone-500"}`}>
        {state.running && <Loader2 size={12} className="animate-spin" />}
        {state.error ? `😵 ${state.message}` : state.stage === "done" ? `🎉 ${state.message}` : state.message}
        {state.running && <span className="ml-auto text-stone-400">{quip}</span>}
      </p>
    </div>
  );
}

export function Empty({ emoji, title, hint, children }: { emoji: string; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-line px-6 py-12 text-center">
      <div className="mb-2 text-4xl hover:animate-wiggle">{emoji}</div>
      <p className="title-serif text-[15px] font-semibold text-stone-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-stone-400">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

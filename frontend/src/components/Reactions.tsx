import { useState } from "react";
import { REACTIONS, REACTION_MAP, type Reaction } from "../api";

/** Emoji reaction bar. Click to set, click again to clear. */
export default function ReactionBar({
  value,
  onChange,
  size = "md",
}: {
  value: Reaction | null;
  onChange: (r: Reaction | null) => void;
  size?: "sm" | "md";
}) {
  const [popKey, setPopKey] = useState<string | null>(null);
  const sm = size === "sm";
  return (
    <div className={`inline-flex items-center rounded-full border border-line bg-white/80 ${sm ? "p-0.5" : "p-1"}`}>
      {REACTIONS.map((r, i) => {
        const active = value === r.key;
        return (
          <span key={r.key} className="contents">
            {(i === 3 || i === 5) && <span className="mx-0.5 h-4 w-px bg-line" />}
            <button
              title={r.label}
              onClick={() => {
                setPopKey(r.key + Date.now());
                onChange(active ? null : r.key);
              }}
              className={`group/r relative flex items-center justify-center rounded-full transition ${
                sm ? "h-6 w-6 text-[13px]" : "h-7 w-7 text-[15px]"
              } ${active ? "bg-brand-soft ring-1 ring-brand/30" : "hover:bg-paper-2"} ${
                value && !active ? "opacity-45 grayscale-[60%] hover:opacity-100 hover:grayscale-0" : ""
              }`}
            >
              <span key={active ? popKey ?? "" : r.key} className={`transition-transform group-hover/r:scale-125 ${active ? "animate-pop" : ""}`}>
                {r.emoji}
              </span>
              <span className="pointer-events-none absolute -top-7 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover/r:opacity-100">
                {r.label}
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function ReactionBadge({ value }: { value: Reaction | null }) {
  if (!value) return null;
  const r = REACTION_MAP[value];
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-paper-2 px-1.5 py-0.5 text-[11px] text-stone-600" title={r.label}>
      {r.emoji} {r.label}
    </span>
  );
}

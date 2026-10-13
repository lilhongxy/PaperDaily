import { useApp } from "../store";
import { Cpu } from "lucide-react";

export default function ModelPicker({
  value,
  onChange,
  compact,
}: {
  value?: string;
  onChange?: (m: string) => void;
  compact?: boolean;
}) {
  const { models, model, setModel } = useApp();
  const v = value ?? model;
  const set = onChange ?? setModel;
  const list = models.includes(v) || !v ? models : [v, ...models];
  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-white pl-2 transition focus-within:border-brand ${compact ? "text-xs" : "text-sm"}`}
      title="切换 AI 模型"
    >
      <Cpu size={compact ? 13 : 14} className="text-brand" />
      <select value={v} onChange={(e) => set(e.target.value)} className="cursor-pointer bg-transparent py-1 pr-2 outline-none">
        {list.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}

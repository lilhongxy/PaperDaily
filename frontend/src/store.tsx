import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Settings } from "./api";

interface Toast {
  id: number;
  text: string;
}

interface Ctx {
  settings: Settings | null;
  models: string[];
  /** Current reading model, switchable from the top bar. */
  model: string;
  setModel: (m: string) => void;
  reload: () => Promise<void>;
  notify: (text: string) => void;
  /** Opens the global quick-idea composer, optionally pre-linked to a paper. */
  quickIdea: (opts?: { paperId?: string; paperTitle?: string; text?: string }) => void;
  quickIdeaState: { open: boolean; paperId?: string; paperTitle?: string; text?: string };
  closeQuickIdea: () => void;
}

const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModelState] = useState<string>("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [quickIdeaState, setQI] = useState<Ctx["quickIdeaState"]>({ open: false });

  const reload = async () => {
    const [s, m] = await Promise.all([api.settings(), api.models()]);
    setSettings(s);
    setModels(m);
    setModelState((cur) => cur || s.reader_model);
  };

  useEffect(() => {
    reload();
  }, []);

  const setModel = (m: string) => {
    setModelState(m);
    api.saveSettings({ reader_model: m }).then((s) => setSettings((old) => ({ ...old, ...s })));
  };

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const quickIdea = useCallback((opts: Omit<Ctx["quickIdeaState"], "open"> = {}) => setQI({ open: true, ...opts }), []);
  const closeQuickIdea = useCallback(() => setQI({ open: false }), []);

  return (
    <AppCtx.Provider value={{ settings, models, model, setModel, reload, notify, quickIdea, quickIdeaState, closeQuickIdea }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="animate-rise rounded-full bg-ink/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur">
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

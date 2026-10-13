import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import "./index.css";
import { AppProvider, useApp } from "./store";
import ModelPicker from "./components/ModelPicker";
import QuickIdea from "./components/QuickIdea";
import ErrorBoundary from "./components/ErrorBoundary";
import { AssistantLauncher } from "./components/Assistant";
import AssistantPage from "./pages/Assistant";
import TodayPage from "./pages/Today";
import ResearchPage from "./pages/Research";
import LibraryPage from "./pages/Library";
import NotesPage from "./pages/Notes";
import IdeasPage from "./pages/Ideas";
import SettingsPage from "./pages/Settings";
import ReaderPage from "./pages/Reader";

const NAV = [
  { to: "/today", emoji: "☀️", label: "今日" },
  { to: "/assistant", emoji: "✨", label: "助理" },
  { to: "/research", emoji: "🧭", label: "调研" },
  { to: "/library", emoji: "📚", label: "文库" },
  { to: "/ideas", emoji: "💭", label: "灵感" },
  { to: "/notes", emoji: "📝", label: "笔记" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { settings, quickIdea } = useApp();
  const loc = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        quickIdea();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickIdea]);

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex h-13 shrink-0 items-center gap-1 border-b border-line bg-paper/85 px-4 backdrop-blur">
        <NavLink to="/today" className="group mr-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand via-[#8b5cf6] to-ember text-base shadow-md shadow-brand/30 transition group-hover:rotate-[-8deg]">
            📑
          </span>
          <span className="title-serif text-[17px] font-bold tracking-tight text-ink">
            Daily<span className="text-brand">Paper</span>
          </span>
        </NavLink>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `group flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                isActive ? "bg-ink text-white shadow-sm" : "text-stone-600 hover:bg-paper-2"
              }`
            }
          >
            <span className="transition group-hover:scale-125">{n.emoji}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {settings && !settings.api_configured && (
            <NavLink to="/settings" className="text-xs text-red-600 underline">
              ⚠️ 未配置 API 令牌
            </NavLink>
          )}
          <button onClick={() => quickIdea()} className="btn btn-outline !rounded-full !py-1 text-xs" title="记下想法 (⌘I)">
            💭 记想法
            <kbd className="rounded bg-paper-2 px-1 text-[10px] text-stone-500">⌘I</kbd>
          </button>
          <ModelPicker compact />
          <NavLink
            to="/settings"
            className={({ isActive }) => `rounded-full p-1.5 text-base transition hover:rotate-45 ${isActive ? "bg-ink" : "hover:bg-paper-2"}`}
            title="设置"
          >
            ⚙️
          </NavLink>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary>
      </main>
      <ErrorBoundary>
        <QuickIdea />
      </ErrorBoundary>
      <ErrorBoundary resetKey={loc.pathname}>
        <AssistantLauncher />
      </ErrorBoundary>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/push" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/assistant/:id" element={<AssistantPage />} />
            <Route path="/research" element={<ResearchPage />} />
            <Route path="/research/:id" element={<ResearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
            <Route path="/ideas/:id" element={<IdeasPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/read/:id" element={<ReaderPage />} />
          </Routes>
        </Shell>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);

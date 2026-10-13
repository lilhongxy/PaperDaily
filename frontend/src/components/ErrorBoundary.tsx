import { Component, type ReactNode } from "react";

/** Keeps a crash in one area from blanking the whole app; shows the error with a retry. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[DailyPaper] UI error:", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card max-w-lg p-6 text-center">
          <div className="mb-2 text-4xl">😵‍💫</div>
          <p className="title-serif font-semibold">这一块出错了</p>
          <p className="mt-2 break-all rounded-lg bg-paper-2 p-2 font-mono text-xs text-stone-500">{this.state.error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => this.setState({ error: null })} className="btn btn-primary">
              重试
            </button>
            <button onClick={() => location.reload()} className="btn btn-outline">
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}

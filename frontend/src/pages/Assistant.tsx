import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AssistantChat, ThreadList } from "../components/Assistant";

export default function AssistantPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const threadId = id ? +id : null;
  // A question handed over from the home page is sent once, then dropped from the URL.
  const [initial] = useState(() => sp.get("q") || undefined);
  useEffect(() => {
    if (sp.get("q")) setSp({}, { replace: true });
  }, []);
  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 border-r border-line bg-white/60">
        <ThreadList current={threadId} onPick={(t) => nav(`/assistant/${t}`)} onNew={() => nav("/assistant")} />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mx-auto h-full max-w-4xl">
          <AssistantChat threadId={threadId} initial={initial} onThread={(t) => nav(`/assistant/${t}`, { replace: true })} />
        </div>
      </div>
    </div>
  );
}

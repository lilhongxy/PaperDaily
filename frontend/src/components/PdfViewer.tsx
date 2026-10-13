import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { ZoomIn, ZoomOut, Loader2, Highlighter, Languages, Lightbulb, MessageSquare, Sparkle } from "lucide-react";
import type { Highlight } from "../api";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type SelAction = "highlight" | "explain" | "translate" | "ask" | "idea";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export default function PdfViewer({
  url,
  highlights,
  onSelection,
  jumpTo,
}: {
  url: string;
  highlights: Highlight[];
  onSelection: (action: SelAction, text: string, page: number | null) => void;
  jumpTo?: { page: number; n: number } | null;
}) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; page: number | null } | null>(null);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jumpTo || !box.current) return;
    box.current.querySelector(`[data-page-number="${jumpTo.page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jumpTo]);

  // Text-layer items that fall inside a saved highlight get wrapped in <mark>.
  const byPage = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const h of highlights) if (h.page) m.set(h.page, [...(m.get(h.page) || []), norm(h.text)]);
    return m;
  }, [highlights]);

  const renderer = useCallback(
    ({ str, pageNumber }: { str: string; pageNumber: number }) => {
      const hs = byPage.get(pageNumber);
      const s = norm(str);
      if (hs && s.length >= 3 && hs.some((h) => h.includes(s))) return `<mark style="background:rgba(250,204,21,.45);color:transparent">${escapeHtml(str)}</mark>`;
      return escapeHtml(str);
    },
    [byPage],
  );

  const onMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !box.current) return;
    const node = sel!.anchorNode?.parentElement?.closest("[data-page-number]");
    const page = node ? Number(node.getAttribute("data-page-number")) : null;
    const rect = box.current.getBoundingClientRect();
    setMenu({ x: e.clientX - rect.left + box.current.scrollLeft, y: e.clientY - rect.top + box.current.scrollTop + 10, text, page });
  };

  const act = (a: SelAction) => {
    if (!menu) return;
    onSelection(a, menu.text, menu.page);
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex h-full flex-col bg-paper-2">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-white px-3 text-xs text-stone-600">
        <button className="btn btn-ghost !p-1" onClick={() => setScale((s) => Math.max(0.6, s - 0.15))}>
          <ZoomOut size={15} />
        </button>
        <span className="w-10 text-center">{Math.round(scale * 100)}%</span>
        <button className="btn btn-ghost !p-1" onClick={() => setScale((s) => Math.min(3, s + 0.15))}>
          <ZoomIn size={15} />
        </button>
        <span className="ml-2">{numPages ? `${numPages} 页` : ""}</span>
        <span className="ml-auto text-stone-400">选中文字可：高亮 / 解释 / 翻译 / 提问 / 记想法</span>
      </div>
      <div ref={box} className="relative flex-1 overflow-auto" onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest(".sel-menu") && setMenu(null)}>
        {err && <p className="p-6 text-sm text-red-600">PDF 加载失败：{err}</p>}
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(e) => setErr(e.message)}
          loading={
            <div className="flex items-center gap-2 p-10 text-sm text-stone-500">
              <Loader2 className="animate-spin" size={16} /> 正在下载并加载 PDF…
            </div>
          }
          className="flex flex-col items-center gap-3 py-4"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i}
              pageNumber={i + 1}
              scale={scale}
              className="pdf-page shadow-md"
              customTextRenderer={renderer}
              loading={<div style={{ height: 1000 * scale * 0.8, width: 612 * scale }} className="bg-white" />}
            />
          ))}
        </Document>
        {menu && (
          <div
            className="sel-menu absolute z-20 flex gap-0.5 rounded-xl border border-line bg-white p-1 shadow-xl"
            style={{ left: Math.max(4, menu.x - 190), top: menu.y }}
          >
            {(
              [
                ["highlight", "高亮", <Highlighter size={14} />],
                ["explain", "解释", <Lightbulb size={14} />],
                ["translate", "翻译", <Languages size={14} />],
                ["ask", "提问", <MessageSquare size={14} />],
                ["idea", "记想法", <Sparkle size={14} />],
              ] as const
            ).map(([a, label, icon]) => (
              <button key={a} onClick={() => act(a)} className="btn btn-ghost !px-2 !py-1 text-xs">
                {icon}
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

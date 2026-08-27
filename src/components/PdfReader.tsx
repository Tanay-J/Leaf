import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Book } from "../books";
import { loadProgress, saveProgress } from "../lib";
import { loadBook } from "../bookLoader";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface OutlineEntry {
  title: string;
  page: number | null;
  depth: number;
}

interface Props {
  book: Book;
  setControls: (node: ReactNode) => void;
  setSidebar: (node: ReactNode) => void;
}

export default function PdfReader({ book, setControls, setSidebar }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const seqRef = useRef(0);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => loadProgress(book.id).page ?? 1);
  const [zoom, setZoom] = useState(() => loadProgress(book.id).zoom ?? 1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorText, setErrorText] = useState("");
  const [outline, setOutline] = useState<OutlineEntry[]>([]);

  /* Load the document once per book: download the bytes and hand them to
     pdf.js. */
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const data = await loadBook(book);
        if (disposed) return;

        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(data),
        }).promise;
        if (disposed) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");

        // Resolve the outline (if any) into flat entries with page numbers.
        try {
          const rawOutline = await pdf.getOutline();
          if (disposed || !rawOutline) return;

          type OutlineNode = {
            title: string;
            dest: string | unknown[] | null;
            items: OutlineNode[];
          };

          const resolveDest = async (
            dest: string | unknown[] | null
          ): Promise<number | null> => {
            try {
              if (!dest) return null;
              const explicitDest =
                typeof dest === "string"
                  ? await pdf.getDestination(dest)
                  : dest;
              const ref = (explicitDest as unknown[] | null)?.[0];
              if (ref == null) return null;
              const index = await pdf.getPageIndex(
                ref as Parameters<typeof pdf.getPageIndex>[0]
              );
              return index + 1;
            } catch {
              return null;
            }
          };

          const entries: OutlineEntry[] = [];
          const walk = async (nodes: OutlineNode[], depth: number) => {
            for (const node of nodes ?? []) {
              entries.push({
                title: (node.title ?? "").trim(),
                page: await resolveDest(node.dest),
                depth,
              });
              if (node.items?.length) await walk(node.items, depth + 1);
            }
          };
          await walk(rawOutline as unknown as OutlineNode[], 0);
          if (!disposed) setOutline(entries);
        } catch {
          if (!disposed) setOutline([]);
        }
      } catch (err) {
        if (disposed) return;
        setStatus("error");
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      disposed = true;
      taskRef.current?.cancel();
      void pdfRef.current?.destroy();
      pdfRef.current = null;
      setOutline([]);
    };
  }, [book.url]);

  const clampPage = useCallback(
    (p: number) =>
      Math.min(Math.max(Math.round(p) || 1, 1), Math.max(numPages, 1)),
    [numPages]
  );

  /* Render the current page, fit-to-width times zoom. */
  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    const p = clampPage(page);
    const seq = ++seqRef.current;
    try {
      const pdfPage = await pdf.getPage(p);
      if (seq !== seqRef.current) return; // superseded while fetching

      const base = pdfPage.getViewport({ scale: 1 });
      const available = Math.max(
        (canvas.parentElement?.clientWidth ?? 900) - 32,
        120
      );
      const scale = Math.max(available / base.width, 0.05) * zoom;
      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: scale * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(base.width * scale)}px`;
      canvas.style.height = `${Math.floor(base.height * scale)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      taskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      taskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* cancelled by a newer render */
      }
    } catch (err) {
      console.error(err);
    }
  }, [page, zoom, clampPage]);

  useEffect(() => {
    void renderPage();
  }, [renderPage, status]);

  /* Persist progress. */
  useEffect(() => {
    if (!numPages) return;
    saveProgress(book.id, { page: clampPage(page), total: numPages, zoom });
  }, [page, zoom, numPages, book.id, clampPage]);

  /* Re-render on container resize (fit-to-width depends on it). */
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void renderPage(), 150);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [renderPage]);

  /* Keyboard navigation. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") setPage((p) => clampPage(p - 1));
      if (e.key === "ArrowRight") setPage((p) => clampPage(p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clampPage]);

  /* Render format-specific controls into the topbar slot. */
  useEffect(() => {
    setControls(
      <>
        <button
          className="mini-btn"
          onClick={() =>
            setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))
          }
          title="Zoom out"
        >
          <Minus size={14} />
        </button>
        <span className="pos-label">{Math.round(zoom * 100)}%</span>
        <button
          className="mini-btn"
          onClick={() =>
            setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))
          }
          title="Zoom in"
        >
          <Plus size={14} />
        </button>
      </>
    );
    return () => setControls(null);
  }, [zoom, setControls]);

  /* Render the outline (bookmarks) into the collapsible sidebar. */
  useEffect(() => {
    if (outline.length === 0) {
      setSidebar(null);
      return () => setSidebar(null);
    }
    setSidebar(
      <ul className="toc-list">
        {outline.map((it, i) => (
          <li key={`${it.title}-${i}`}>
            <button
              className={`toc-item${
                it.page != null && it.page === page ? " active" : ""
              }`}
              style={{ paddingLeft: 12 + it.depth * 14 }}
              disabled={it.page == null}
              onClick={() => {
                if (it.page != null) setPage(clampPage(it.page));
              }}
            >
              {it.title || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    );
    return () => setSidebar(null);
  }, [outline, page, clampPage, setSidebar]);

  return (
    <div className="format-reader">
      {status === "loading" && (
        <div className="pane-overlay">
          <Loader2 className="spin" size={26} />
          <span>Loading PDF…</span>
        </div>
      )}
      {status === "error" && (
        <div className="error-pane">
          <strong>Could not load “{book.title}”.</strong>
          <p>{errorText}</p>
          <p>
            If this looks like a network/CORS error, host the file somewhere
            that sends Access-Control-Allow-Origin (GitHub Pages and
            raw.githubusercontent.com both do).
          </p>
        </div>
      )}
      <div className="pdf-scroll">
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
      <footer className="reader-navbar">
        <button
          className="nav-btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => clampPage(p - 1))}
        >
          <ChevronLeft size={15} />
          Prev
        </button>
        <span className="nav-pos page-jump">
          <input
            type="number"
            min={1}
            max={numPages || undefined}
            value={page}
            onChange={(e) => setPage(clampPage(Number(e.target.value)))}
          />
          {" / "}
          {numPages || "…"}
        </span>
        <button
          className="nav-btn"
          disabled={!!numPages && page >= numPages}
          onClick={() => setPage((p) => clampPage(p + 1))}
        >
          Next
          <ChevronRight size={15} />
        </button>
      </footer>
    </div>
  );
}
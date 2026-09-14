import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Contrast, Loader2, Minus, Plus, Search } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Book } from "../books";
import { addReadingSeconds, loadProgress, saveProgress } from "../lib";
import { loadBook } from "../bookLoader";
import SearchPanel, { type SearchHit } from "./SearchPanel";
import {
  PassphraseRequiredError,
  WrongPassphraseError,
  setStoredPassphrase,
} from "../bookCrypto";
import PassphrasePrompt from "./PassphrasePrompt";

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
  /** Reports reading position as 0..1 for the reader progress line. */
  onProgress?: (pct: number | null) => void;
}

export default function PdfReader({
  book,
  setControls,
  setSidebar,
  onProgress,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const seqRef = useRef(0);
  /** Per-page text cache, filled lazily by search. */
  const pageTextRef = useRef<Map<number, string>>(new Map());

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => loadProgress(book.id).page ?? 1);
  const [zoom, setZoom] = useState(() => loadProgress(book.id).zoom ?? 1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [invert, setInvert] = useState(
    () => loadProgress(book.id).invert ?? false
  );

  const toggleInvert = () =>
    setInvert((v) => {
      const next = !v;
      saveProgress(book.id, { ...loadProgress(book.id), invert: next });
      return next;
    });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorText, setErrorText] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [wrongPassphrase, setWrongPassphrase] = useState(false);
  const [unlockAttempt, setUnlockAttempt] = useState(0);
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
        if (err instanceof PassphraseRequiredError) {
          setNeedsPassphrase(true);
          setWrongPassphrase(false);
          return;
        }
        if (err instanceof WrongPassphraseError) {
          setNeedsPassphrase(true);
          setWrongPassphrase(true);
          return;
        }
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
  }, [book.url, unlockAttempt]);

  /* Called by PassphrasePrompt once the visitor submits a passphrase. */
  const handleUnlock = (pw: string) => {
    setStoredPassphrase(pw);
    setNeedsPassphrase(false);
    setWrongPassphrase(false);
    setOutline([]);
    setStatus("loading");
    setUnlockAttempt((n) => n + 1);
  };

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
  const saveGuard = useRef(true);
  useEffect(() => {
    if (!numPages) return;
    const prev = loadProgress(book.id);
    // Skip the first run (restored state isn't reading activity) so merely
    // reopening a book never marks it finished or read-today.
    const moved = !saveGuard.current;
    saveGuard.current = false;
    saveProgress(book.id, {
      ...prev,
      page: clampPage(page),
      total: numPages,
      zoom,
      ...(moved && page > 1
        ? { lastReadAt: Date.now(), updatedAt: Date.now() }
        : {}),
      ...(moved && page >= numPages && !prev.finishedAt
        ? { finishedAt: Date.now() }
        : {}),
    });
  }, [page, zoom, numPages, book.id, clampPage]);

  /* Reading-time tracking: 15 s ticks while the PDF is open and visible. */
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        addReadingSeconds(book.id, 15);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [status, book.id]);

  /* Reader progress line: position as 0..1. */
  useEffect(() => {
    onProgress?.(
      numPages ? Math.min(1, Math.max(0, clampPage(page) / numPages)) : null
    );
  }, [page, numPages, clampPage, onProgress]);

  /* In-book search: extracts each page's text (cached after first pass). */
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched("");
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      const hits: SearchHit[] = [];
      const pdf = pdfRef.current;
      const lower = q.toLowerCase();
      if (pdf) {
        for (let p = 1; p <= pdf.numPages && hits.length < 30; p++) {
          let text = pageTextRef.current.get(p);
          if (text === undefined) {
            try {
              const pdfPage = await pdf.getPage(p);
              const content = await pdfPage.getTextContent();
              text = content.items
                .map((it) => ("str" in it ? it.str : ""))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
              pageTextRef.current.set(p, text);
              pdfPage.cleanup();
            } catch {
              text = "";
              pageTextRef.current.set(p, text);
            }
          }
          if (!text) continue;
          const lowerText = text.toLowerCase();
          let idx = lowerText.indexOf(lower);
          let count = 0;
          while (idx !== -1 && count < 2 && hits.length < 30) {
            const from = Math.max(0, idx - 60);
            const to = Math.min(text.length, idx + lower.length + 60);
            hits.push({
              id: `p${p}-${idx}`,
              where: `Page ${p}`,
              excerpt: `${from > 0 ? "…" : ""}${text.slice(from, to)}${
                to < text.length ? "…" : ""
              }`,
              page: p,
            });
            count++;
            idx = lowerText.indexOf(lower, idx + lower.length);
          }
        }
      }
      if (disposed) return;
      setResults(hits);
      setSearched(q);
      setSearchBusy(false);
    }, 350);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [query, searchOpen]);

  const pickSearch = (hit: SearchHit) => {
    if (hit.page) setPage(clampPage(hit.page));
    setSearchOpen(false);
  };

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
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "k")
        setPage((p) => clampPage(p - 1));
      if (e.key === "ArrowRight" || e.key === "j")
        setPage((p) => clampPage(p + 1));
      if (e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) setPage((p) => clampPage(p - 1));
        else setPage((p) => clampPage(p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clampPage, searchOpen]);

  /* Render format-specific controls into the topbar slot. */
  useEffect(() => {
    setControls(
      <>
        <button
          className={`mini-btn${searchOpen ? " active" : ""}`}
          onClick={() => setSearchOpen((o) => !o)}
          title="Search in book"
          aria-label="Search in book"
        >
          <Search size={14} />
        </button>
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
        <button
          className={`mini-btn${invert ? " active" : ""}`}
          onClick={toggleInvert}
          title="Invert page colors (dark reading)"
          aria-label="Invert page colors"
          aria-pressed={invert}
        >
          <Contrast size={14} />
        </button>
      </>
    );
    return () => setControls(null);
  }, [zoom, searchOpen, invert, setControls]);

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
      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={query}
        onQueryChange={setQuery}
        results={results}
        busy={searchBusy}
        searched={searched}
        onPick={pickSearch}
      />
      {status === "loading" && !needsPassphrase && (
        <div className="pane-overlay">
          <Loader2 className="spin" size={26} />
          <span>Loading PDF…</span>
        </div>
      )}
      {needsPassphrase && (
        <PassphrasePrompt
          wrong={wrongPassphrase}
          onSubmit={handleUnlock}
        />
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
        <canvas
          ref={canvasRef}
          className={`pdf-canvas${invert ? " inverted" : ""}`}
        />
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
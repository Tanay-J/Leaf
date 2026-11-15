import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import ePub from "epubjs";
import type { Book as EpubBook, Rendition } from "epubjs";
import type { Book } from "../books";
import {
  addReadingSeconds,
  loadProgress,
  saveProgress,
  type BookmarkItem,
  type EpubLayout,
  type HighlightItem,
  type Theme,
} from "../lib";
import { loadBook } from "../bookLoader";
import SearchPanel, { type SearchHit } from "./SearchPanel";
import TypographyMenu from "./TypographyMenu";
import {
  LINE_HEIGHT_OPTIONS,
  DEFAULT_SPACING_ID,
  fontStackFor,
  spacingValueFor,
} from "../typography";
import {
  PassphraseRequiredError,
  WrongPassphraseError,
  setStoredPassphrase,
} from "../bookCrypto";
import PassphrasePrompt from "./PassphrasePrompt";

/* Font and spacing choices live in src/typography.ts, shared with the
   article reader. */

/* Warm paper tint injected into the book body in sepia mode.
   Mirrors the --bg-app value of html.sepia-theme. */
const SEPIA_BODY_BG = "#f4ead8";

interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

interface Props {
  book: Book;
  theme: Theme;
  setControls: (node: ReactNode) => void;
  setSidebar: (node: ReactNode) => void;
  /** Reports reading position as 0..1 for the reader progress line. */
  onProgress?: (pct: number | null) => void;
}

export default function EpubReader({
  book,
  theme,
  setControls,
  setSidebar,
  onProgress,
}: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<TocEntry[]>([]);
  const bookRef = useRef<EpubBook | null>(null);
  const swipeBound = useRef<WeakSet<object>>(new WeakSet());
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeToc, setActiveToc] = useState(-1);
  const [chapter, setChapter] = useState("");
  const [currentCfi, setCurrentCfi] = useState(
    () => loadProgress(book.id).cfi ?? ""
  );
  const [sidebarTab, setSidebarTab] = useState<"toc" | "notes">("toc");
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(
    () => loadProgress(book.id).bookmarks ?? []
  );
  const [highlights, setHighlights] = useState<HighlightItem[]>(
    () => loadProgress(book.id).highlights ?? []
  );
  const [pendingSel, setPendingSel] = useState<{
    cfiRange: string;
    text: string;
  } | null>(null);
  const [copiedNote, setCopiedNote] = useState(false);
  const chapterRef = useRef("");
  chapterRef.current = chapter;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [fontSize, setFontSize] = useState<number>(
    () => loadProgress(book.id).fontSize ?? 100
  );
  const [fontFamily, setFontFamily] = useState<string>(
    () => loadProgress(book.id).fontFamily ?? ""
  );
  const [spacingId, setSpacingId] = useState<string>(() => {
    const lh = loadProgress(book.id).lineHeight;
    const opt = LINE_HEIGHT_OPTIONS.find((o) => o.value === lh);
    return opt?.id ?? DEFAULT_SPACING_ID;
  });
  const [layout, setLayout] = useState<EpubLayout>(
    () => loadProgress(book.id).layout ?? "single"
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorText, setErrorText] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [wrongPassphrase, setWrongPassphrase] = useState(false);
  const [unlockAttempt, setUnlockAttempt] = useState(0);

  /* Fetch the book bytes, then create the rendition. */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    let disposed = false;
    let eb: EpubBook | null = null;
    let rendition: Rendition | null = null;
    const saved = loadProgress(book.id);

    (async () => {
      try {
        const data = await loadBook(book);
        if (disposed) return;

        eb = ePub(data);
        bookRef.current = eb;
        rendition = eb.renderTo(el, {
          width: "100%",
          height: "100%",
          spread: layout === "spread" ? "always" : "none",
          minSpreadWidth: 480,
          flow: layout === "scroll" ? "scrolled-doc" : "paginated",
        });
        renditionRef.current = rendition;

        // Touch page-turns: swipes inside the iframe never reach the parent
        // document, so listen in each rendered section's own document.
        const rend = rendition; // non-null; const narrows inside the closure
        rend.on("rendered", () => {
          // Runtime returns an array of Contents (types simplify to one).
          const contents = rend.getContents() as unknown as Array<{
            document?: Document;
          }>;
          for (const c of contents) {
            if (swipeBound.current.has(c)) continue;
            swipeBound.current.add(c);
            const doc: Document | undefined = c.document;
            if (!doc) continue;
            doc.addEventListener(
              "touchstart",
              (ev: TouchEvent) => {
                touchStart.current = {
                  x: ev.touches[0]?.clientX ?? 0,
                  y: ev.touches[0]?.clientY ?? 0,
                };
              },
              { passive: true }
            );
            doc.addEventListener(
              "touchend",
              (ev: TouchEvent) => {
                const start = touchStart.current;
                touchStart.current = null;
                if (!start) return;
                const dx = (ev.changedTouches[0]?.clientX ?? start.x) - start.x;
                const dy = Math.abs(
                  (ev.changedTouches[0]?.clientY ?? start.y) - start.y
                );
                if (Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5) {
                  if (dx < 0) void renditionRef.current?.next();
                  else void renditionRef.current?.prev();
                }
              },
              { passive: true }
            );
          }
        });

        // Flatten the table of contents into a dropdown list.
        eb.loaded.navigation
          .then((nav) => {
            if (disposed) return;
            const entries: TocEntry[] = [];
            const walk = (items: unknown[], depth: number) => {
              for (const raw of items ?? []) {
                const item = raw as {
                  label?: string;
                  href?: string;
                  subitems?: unknown[];
                };
                entries.push({
                  label: String(item.label ?? "").trim(),
                  href: String(item.href ?? ""),
                  depth,
                });
                if (item.subitems?.length) walk(item.subitems, depth + 1);
              }
            };
            walk((nav as { toc?: unknown[] }).toc ?? [], 0);
            tocRef.current = entries;
            setToc(entries);
          })
          .catch(() => undefined);

        // Track position and persist progress.
        rendition.on("relocated", (loc: unknown) => {
          const location = loc as {
            start?: { cfi?: string; href?: string };
            end?: { percentage?: number };
          };
          const start = location?.start;
          const cfi = start?.cfi ?? "";
          const href = (start?.href ?? "").split("#")[0];
          const entries = tocRef.current;
          const idx = entries.findIndex((it) => it.href.split("#")[0] === href);
          const label = idx >= 0 ? entries[idx].label : "";
          setChapter(label);
          setCurrentCfi(cfi);
          setActiveToc(idx);
          setPendingSel(null);
          const prev = loadProgress(book.id);
          const pct = location?.end?.percentage ?? 0;
          onProgress?.(Math.min(1, Math.max(0, pct)));
          saveProgress(book.id, {
            ...prev,
            cfi,
            chapter: label,
            // Reading position as 0..1, surfaced on library cards.
            pct: Math.round(Math.min(1, Math.max(0, pct)) * 1000) / 1000,
            lastReadAt: Date.now(),
            updatedAt: Date.now(),
            ...(pct >= 0.995 && !prev.finishedAt
              ? { finishedAt: Date.now() }
              : {}),
          });
        });

        // Listen for text selection inside the EPUB iframe to offer highlighting.
        rendition.on(
          "selected",
          (cfiRange: string, contents: { window?: Window }) => {
            const text = (contents?.window?.getSelection()?.toString() ?? "")
              .replace(/\s+/g, " ")
              .trim();
            if (text.length >= 2) {
              setPendingSel({ cfiRange, text });
            }
          }
        );

        await rendition.display(saved.cfi || undefined);
        // Apply any saved highlights onto the rendition annotations layer.
        for (const h of loadProgress(book.id).highlights ?? []) {
          try {
            rendition.annotations.highlight(h.cfiRange, {}, () => {
              void renditionRef.current?.display(h.cfiRange);
            });
          } catch {
            /* ignore invalid range */
          }
        }
        if (!disposed) setStatus("ready");
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
      bookRef.current = null;
      renditionRef.current = null;
      rendition?.destroy();
      eb?.destroy();
    };
  }, [book.id, book.url, unlockAttempt, layout]);

  /* Called by PassphrasePrompt once the visitor submits a passphrase. */
  const handleUnlock = (pw: string, remember: boolean) => {
    setStoredPassphrase(pw, remember);
    setNeedsPassphrase(false);
    setWrongPassphrase(false);
    setStatus("loading");
    setUnlockAttempt((n) => n + 1);
  };

  /* Apply typography and the sepia page tint whenever they change. */
  useEffect(() => {
    const themes = renditionRef.current?.themes;
    if (!themes) return;

    // epubjs implements removeOverride() at runtime but omits it from types.
    const t = themes as typeof themes & { removeOverride(name: string): void };

    const stack = fontStackFor(fontFamily);
    if (stack) {
      t.font(stack);
    } else {
      t.removeOverride("font-family");
    }

    themes.fontSize(`${fontSize}%`);

    /* Line spacing: a registered theme with !important rules, so books that
       set line-height on <p> don't defeat it. Re-registering the same name
       updates the injected stylesheet in place (epubjs handles dedupe). */
    const lh = spacingValueFor(spacingId);
    const spacingRules: Record<string, Record<string, string>> = {};
    if (lh) {
      for (const sel of ["body", "p", "li"]) {
        spacingRules[sel] = { "line-height": `${lh} !important` };
      }
    }
    themes.register("leaf-line-spacing", spacingRules);
    themes.select("leaf-line-spacing");

    if (theme === "sepia") {
      themes.override("background-color", SEPIA_BODY_BG);
    } else {
      t.removeOverride("background-color");
    }
  }, [fontSize, fontFamily, spacingId, theme, status]);

  /* Reflow epubjs rendition when the Bento stage or sidebar resizes. */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rend = renditionRef.current as unknown as {
          resize?: (w: number, h: number) => void;
        } | null;
        rend?.resize?.(Math.floor(rect.width), Math.floor(rect.height));
      }, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [status]);

  useEffect(() => {
    saveProgress(book.id, {
      ...loadProgress(book.id),
      fontSize,
      fontFamily,
      lineHeight: spacingValueFor(spacingId),
      layout,
    });
  }, [fontSize, fontFamily, spacingId, layout, book.id]);

  const changeFont = (delta: number) =>
    setFontSize((f) => Math.min(200, Math.max(60, f + delta)));

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  const isBookmarked = Boolean(
    currentCfi && bookmarks.some((b) => b.cfi === currentCfi)
  );

  const toggleBookmark = useCallback(() => {
    if (!currentCfi) return;
    setBookmarks((prev) => {
      const exists = prev.some((b) => b.cfi === currentCfi);
      const next = exists
        ? prev.filter((b) => b.cfi !== currentCfi)
        : [
            ...prev,
            {
              id: `bm-${Date.now()}`,
              cfi: currentCfi,
              label:
                chapterRef.current ||
                `${Math.round((loadProgress(book.id).pct ?? 0) * 100)}% into book`,
              createdAt: Date.now(),
            },
          ];
      const p = loadProgress(book.id);
      saveProgress(book.id, {
        ...p,
        bookmarks: next,
        updatedAt: Date.now(),
      });
      return next;
    });
  }, [currentCfi, book.id]);

  const removeBookmark = useCallback(
    (id: string) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        const p = loadProgress(book.id);
        saveProgress(book.id, {
          ...p,
          bookmarks: next,
          updatedAt: Date.now(),
        });
        return next;
      });
    },
    [book.id]
  );

  const addHighlight = () => {
    if (!pendingSel) return;
    const { cfiRange, text } = pendingSel;
    setPendingSel(null);
    try {
      renditionRef.current?.annotations.highlight(cfiRange, {}, () => {
        void renditionRef.current?.display(cfiRange);
      });
    } catch {
      /* ignore */
    }
    setHighlights((prev) => {
      if (prev.some((h) => h.cfiRange === cfiRange)) return prev;
      const item: HighlightItem = {
        id: `hl-${Date.now()}`,
        cfiRange,
        text,
        ...(chapter ? { chapter } : {}),
        createdAt: Date.now(),
      };
      const next = [...prev, item];
      const p = loadProgress(book.id);
      saveProgress(book.id, {
        ...p,
        highlights: next,
        updatedAt: Date.now(),
      });
      return next;
    });
  };

  const removeHighlight = useCallback(
    (item: HighlightItem) => {
      try {
        renditionRef.current?.annotations.remove(item.cfiRange, "highlight");
      } catch {
        /* ignore */
      }
      setHighlights((prev) => {
        const next = prev.filter((h) => h.id !== item.id);
        const p = loadProgress(book.id);
        saveProgress(book.id, {
          ...p,
          highlights: next,
          updatedAt: Date.now(),
        });
        return next;
      });
    },
    [book.id]
  );

  const copyAllNotes = useCallback(() => {
    const lines: string[] = [`# ${book.title}${book.author ? ` — ${book.author}` : ""}`];
    if (bookmarks.length > 0) {
      lines.push("", "## Bookmarks");
      for (const b of bookmarks) {
        lines.push(`- ${b.label}`);
      }
    }
    if (highlights.length > 0) {
      lines.push("", "## Highlights");
      for (const h of highlights) {
        lines.push(
          `> ${h.text}${h.chapter ? `\n> — *${h.chapter}*` : ""}`,
          ""
        );
      }
    }
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopiedNote(true);
      window.setTimeout(() => setCopiedNote(false), 1800);
    });
  }, [book.title, book.author, bookmarks, highlights]);

  /* Reading-time tracking: 15 s ticks while the book is open in a visible
     tab. Time rides along on the next progress push (no extra sync events). */
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        addReadingSeconds(book.id, 15);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [status, book.id]);

  /* In-book search: scans each spine section's text (debounced). Results
     jump to the section they came from. */
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
      const lower = q.toLowerCase();
      const eb = bookRef.current;
      if (eb) {
        // spineItems exists at runtime but is missing from epubjs's types.
        type SpineItem = {
          href: string;
          load(req?: unknown): Promise<Document | undefined | null>;
          unload(): void;
        };
        const items =
          (eb.spine as unknown as { spineItems?: SpineItem[] }).spineItems ??
          [];
        for (const item of items) {
          try {
            const doc = await item.load(eb.load.bind(eb));
            const text = (doc?.body?.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            if (text) {
              const lowerText = text.toLowerCase();
              let idx = lowerText.indexOf(lower);
              let count = 0;
              const label =
                tocRef.current.find(
                  (t) => t.href.split("#")[0] === item.href.split("#")[0]
                )?.label || item.href;
              while (idx !== -1 && count < 2 && hits.length < 30) {
                const from = Math.max(0, idx - 60);
                const to = Math.min(text.length, idx + lower.length + 60);
                hits.push({
                  id: `${item.href}-${idx}`,
                  where: label,
                  excerpt: `${from > 0 ? "…" : ""}${text.slice(from, to)}${
                    to < text.length ? "…" : ""
                  }`,
                  href: item.href,
                });
                count++;
                idx = lowerText.indexOf(lower, idx + lower.length);
              }
            }
          } catch {
            /* skip unreadable sections */
          } finally {
            try {
              item.unload();
            } catch {
              /* ignore */
            }
          }
          if (hits.length >= 30) break;
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
    if (hit.href) void renditionRef.current?.display(hit.href);
    setSearchOpen(false);
  };

  /* Keyboard navigation: arrows, J/K, Space, B, and Esc for the search panel. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (pendingSel) {
          setPendingSel(null);
          return;
        }
      }
      if (e.key === "b") toggleBookmark();
      if (e.key === "ArrowLeft" || e.key === "k") goPrev();
      if (e.key === "ArrowRight" || e.key === "j") goNext();
      if (e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, searchOpen, pendingSel, toggleBookmark]);

  /* Render format-specific controls into the topbar slot. */
  useEffect(() => {
    setControls(
      <>
        <div
          className="studio-seg-toggle"
          role="group"
          aria-label="Page layout"
        >
          <button
            type="button"
            className={layout !== "spread" ? "active" : ""}
            onClick={() => setLayout("single")}
            title="Single-page view"
          >
            1-Page
          </button>
          <button
            type="button"
            className={layout === "spread" ? "active" : ""}
            onClick={() => setLayout("spread")}
            title="Two-page spread view"
          >
            2-Page
          </button>
        </div>
        <button
          className={`mini-btn${isBookmarked ? " active" : ""}`}
          onClick={toggleBookmark}
          title={isBookmarked ? "Remove bookmark (B)" : "Bookmark page (B)"}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark page"}
          aria-pressed={isBookmarked}
        >
          <Bookmark size={14} />
        </button>
        <button
          className={`mini-btn${searchOpen ? " active" : ""}`}
          onClick={() => setSearchOpen((o) => !o)}
          title="Search in book"
          aria-label="Search in book"
        >
          <Search size={14} />
        </button>
        <TypographyMenu
          fontId={fontFamily}
          spacingId={spacingId}
          fontSize={fontSize}
          layout={layout}
          onFont={setFontFamily}
          onSpacing={setSpacingId}
          onSize={changeFont}
          onLayout={setLayout}
        />
      </>
    );
    return () => setControls(null);
  }, [
    fontSize,
    fontFamily,
    spacingId,
    layout,
    searchOpen,
    isBookmarked,
    toggleBookmark,
    setControls,
  ]);

  /* Render the table of contents + bookmarks/highlights into the sidebar. */
  useEffect(() => {
    const notesCount = bookmarks.length + highlights.length;
    setSidebar(
      <>
        <div className="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === "toc"}
            className={`sidebar-tab${sidebarTab === "toc" ? " active" : ""}`}
            onClick={() => setSidebarTab("toc")}
          >
            Contents
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === "notes"}
            className={`sidebar-tab${sidebarTab === "notes" ? " active" : ""}`}
            onClick={() => setSidebarTab("notes")}
          >
            Saved
            {notesCount > 0 && (
              <span className="sidebar-badge">{notesCount}</span>
            )}
          </button>
        </div>

        {sidebarTab === "toc" ? (
          toc.length === 0 ? (
            <p className="reader-sidebar-empty">No contents to show.</p>
          ) : (
            <ul className="toc-list">
              {toc.map((it, i) => (
                <li key={`${it.href}-${i}`}>
                  <button
                    className={`toc-item${i === activeToc ? " active" : ""}`}
                    style={{ paddingLeft: 12 + it.depth * 14 }}
                    onClick={() => renditionRef.current?.display(it.href)}
                  >
                    {it.label || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : notesCount === 0 ? (
          <p className="reader-sidebar-empty">
            No bookmarks or highlights yet. Press <strong>B</strong> to bookmark
            a page, or select text in the book to highlight a quote.
          </p>
        ) : (
          <div className="sidebar-notes">
            <button
              type="button"
              className="secondary-action sidebar-copy-btn"
              onClick={copyAllNotes}
            >
              <Copy size={13} />
              {copiedNote ? "Copied Markdown!" : "Copy as Markdown"}
            </button>

            {bookmarks.length > 0 && (
              <div className="sidebar-section">
                <span className="reader-sidebar-title">Bookmarks</span>
                <ul className="toc-list">
                  {bookmarks.map((bm) => (
                    <li key={bm.id} className="sidebar-note-row">
                      <button
                        type="button"
                        className="toc-item"
                        onClick={() => {
                          if (bm.cfi) void renditionRef.current?.display(bm.cfi);
                        }}
                      >
                        {bm.label}
                      </button>
                      <button
                        type="button"
                        className="note-del-btn"
                        onClick={() => removeBookmark(bm.id)}
                        title="Remove bookmark"
                        aria-label="Remove bookmark"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {highlights.length > 0 && (
              <div className="sidebar-section">
                <span className="reader-sidebar-title">Highlights</span>
                <ul className="toc-list">
                  {highlights.map((hl) => (
                    <li key={hl.id} className="sidebar-note-row highlight-row">
                      <button
                        type="button"
                        className="toc-item highlight-item"
                        onClick={() =>
                          void renditionRef.current?.display(hl.cfiRange)
                        }
                      >
                        <span className="highlight-quote">“{hl.text}”</span>
                        {hl.chapter && (
                          <span className="highlight-chapter">{hl.chapter}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="note-del-btn"
                        onClick={() => removeHighlight(hl)}
                        title="Remove highlight"
                        aria-label="Remove highlight"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </>
    );
    return () => setSidebar(null);
  }, [
    toc,
    activeToc,
    sidebarTab,
    bookmarks,
    highlights,
    copiedNote,
    copyAllNotes,
    removeBookmark,
    removeHighlight,
    setSidebar,
  ]);

  const currentPct = loadProgress(book.id).pct ?? null;

  return (
    <div className="format-reader bento-format-reader">
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
      {pendingSel && (
        <div className="selection-bar" role="region" aria-label="Selected text actions">
          <span className="selection-preview">“{pendingSel.text}”</span>
          <button
            type="button"
            className="add-article-btn selection-btn"
            onClick={addHighlight}
          >
            <Highlighter size={14} />
            Highlight
          </button>
          <button
            type="button"
            className="secondary-action selection-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(pendingSel.text);
              setPendingSel(null);
            }}
          >
            <Copy size={13} />
            Copy
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPendingSel(null)}
            aria-label="Dismiss selection"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {status === "loading" && !needsPassphrase && (
        <div className="pane-overlay">
          <Loader2 className="spin" size={26} />
          <span>Loading book…</span>
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
      <div className="reader-stage-area studio-canvas">
        <div
          className={`studio-sheet${layout === "spread" ? " is-spread" : ""}`}
        >
          {layout === "spread" && (
            <div className="bento-spread-spine" aria-hidden="true" />
          )}
          {layout !== "scroll" && (
            <button
              type="button"
              className="edge-tap edge-tap-left"
              onClick={goPrev}
              aria-label="Previous page"
              tabIndex={-1}
            />
          )}
          <div
            ref={viewerRef}
            className={`epub-viewer${layout === "spread" ? " epub-spread" : ""}`}
          />
          {layout !== "scroll" && (
            <button
              type="button"
              className="edge-tap edge-tap-right"
              onClick={goNext}
              aria-label="Next page"
              tabIndex={-1}
            />
          )}
        </div>
      </div>
      <footer className="reader-navbar studio-reader-footer">
        <button className="nav-btn" onClick={goPrev}>
          <ChevronLeft size={15} />
          Previous
        </button>
        <div className="studio-footer-center">
          {currentPct != null && (
            <div className="studio-footer-track">
              <span style={{ width: `${Math.round(currentPct * 100)}%` }} />
            </div>
          )}
          <span className="nav-pos">
            {currentPct != null ? `${Math.round(currentPct * 100)}% · ` : ""}
            {chapter || book.title}
          </span>
        </div>
        <button className="nav-btn" onClick={goNext}>
          Next
          <ChevronRight size={15} />
        </button>
      </footer>
    </div>
  );
}
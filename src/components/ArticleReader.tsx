import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  parseReaderResponse,
  setArticleProgress,
  setArticleRead,
  updateArticleExtracted,
  type SavedArticle,
} from "../articles";
import {
  fetchVaultArticleContent,
  syncArticleContent,
} from "../articleSync";
import { navigate, type Theme } from "../lib";
import { loadArticleContent, saveArticleContent } from "../localBooks";
import {
  ARTICLE_DEFAULT_LINE_HEIGHT,
  DEFAULT_SPACING_ID,
  fontStackFor,
  spacingValueFor,
} from "../typography";
import ThemeButton from "./ThemeButton";
import TypographyMenu from "./TypographyMenu";

interface Props {
  article: SavedArticle;
  theme: Theme;
  onCycleTheme: () => void;
  /** When true, rendered inside the split-pane Articles Workspace. */
  embedded?: boolean;
  listMinimized?: boolean;
  onToggleList?: () => void;
}

const FONT_KEY = "article-font";
const FONT_FAMILY_KEY = "article-font-family";
const SPACING_KEY = "article-line-height";

function loadFont(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    if (n >= 70 && n <= 200) return n;
  } catch {
    /* private mode */
  }
  return 100;
}

function loadFontFamily(): string {
  try {
    return localStorage.getItem(FONT_FAMILY_KEY) ?? "";
  } catch {
    /* private mode */
    return "";
  }
}

function loadSpacingId(): string {
  try {
    return localStorage.getItem(SPACING_KEY) ?? DEFAULT_SPACING_ID;
  } catch {
    /* private mode */
    return DEFAULT_SPACING_ID;
  }
}

/**
 * Reader mode for a saved link.
 * Resolution order:
 *   1. Local IndexedDB cache (instant, offline)
 *   2. Vault sync branch copy (articles/content/<id>.md, cross-device)
 *   3. Jina Reader extraction (r.jina.ai/<url>), then cached & synced to vault
 */
export default function ArticleReader({
  article,
  theme,
  onCycleTheme,
  embedded,
  listMinimized,
  onToggleList,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = useState("");
  const [errorText, setErrorText] = useState("");
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [font, setFont] = useState<number>(loadFont);
  const [fontFamily, setFontFamily] = useState<string>(loadFontFamily);
  const [spacingId, setSpacingId] = useState<string>(loadSpacingId);
  const [retry, setRetry] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setStatus("loading");
    setErrorText("");
    setHtml("");
    setFetchedTitle(null);

    const applyMarkdown = (raw: string): string => {
      const { title: parsedTitle, markdown } = parseReaderResponse(raw);
      const rendered = marked.parse(markdown) as string;
      setHtml(DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } }));
      if (parsedTitle) setFetchedTitle(parsedTitle);
      return markdown;
    };

    (async () => {
      try {
        // 1. Local cache (skip when user explicitly clicked Refresh)
        if (forceRefresh === 0) {
          const cached = await loadArticleContent(article.id).catch(() => null);
          if (disposed) return;
          if (cached) {
            applyMarkdown(cached);
            setStatus("ready");
            setArticleRead(article.id, true);
            return;
          }

          // 2. Vault sync branch copy (cross-device offline text)
          const vaultMd = await fetchVaultArticleContent(article.id).catch(
            () => null
          );
          if (disposed) return;
          if (vaultMd) {
            const cleanMd = applyMarkdown(vaultMd);
            setStatus("ready");
            setArticleRead(article.id, true);
            void saveArticleContent(article.id, cleanMd).catch(() => {});
            updateArticleExtracted(article.id, {
              title: parseReaderResponse(vaultMd).title,
              markdown: cleanMd,
            });
            return;
          }
        }

        // 3. Extract from Jina Reader
        const res = await fetch(`https://r.jina.ai/${article.url}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        if (disposed) return;
        const { title: parsedTitle, markdown } = parseReaderResponse(raw);
        if (!markdown) throw new Error("Empty article");
        applyMarkdown(markdown);
        setStatus("ready");
        setArticleRead(article.id, true);
        void saveArticleContent(article.id, markdown).catch(() => {});
        updateArticleExtracted(article.id, { title: parsedTitle, markdown });
        void syncArticleContent(article.id, markdown).catch(() => {});
      } catch (err) {
        if (disposed || controller.signal.aborted) return;
        setErrorText(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [article.id, article.url, retry, forceRefresh]);

  // Restore scroll position when ready and persist scroll progress
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || status !== "ready") return;
    if (article.progress && article.progress > 0.02 && article.progress < 0.98) {
      const target = el.scrollHeight - el.clientHeight;
      if (target > 0) el.scrollTop = target * article.progress;
    }
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = el.scrollHeight - el.clientHeight;
        if (max > 40) {
          setArticleProgress(article.id, el.scrollTop / max);
        }
      }, 600);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [article.id, status]);

  function changeFont(delta: number): void {
    setFont((f) => {
      const next = Math.min(180, Math.max(80, f + delta));
      try {
        localStorage.setItem(FONT_KEY, String(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  function changeFontFamily(id: string): void {
    setFontFamily(id);
    try {
      localStorage.setItem(FONT_FAMILY_KEY, id);
    } catch {
      /* private mode */
    }
  }

  function changeSpacing(id: string): void {
    setSpacingId(id);
    try {
      localStorage.setItem(SPACING_KEY, id);
    } catch {
      /* private mode */
    }
  }

  const title = fetchedTitle ?? article.title;

  return (
    <div className={`article-reader${embedded ? " embedded-article-reader" : ""}`}>
      <header className="topbar reader-topbar">
        <div className="topbar-actions">
          {embedded && onToggleList ? (
            <button
              type="button"
              className="secondary-action"
              onClick={onToggleList}
              title={listMinimized ? "Show reading list" : "Minimize reading list"}
            >
              {listMinimized ? (
                <PanelLeftOpen size={15} />
              ) : (
                <PanelLeftClose size={15} />
              )}
              {listMinimized ? "Show List" : "Minimize List"}
            </button>
          ) : (
            <button
              className="secondary-action"
              onClick={() => navigate("#/articles")}
            >
              <ArrowLeft size={15} />
              Reading list
            </button>
          )}
        </div>
        <div className="reader-title">
          <strong>{title}</strong>
          <span>
            {article.domain}
            {article.readingMinutes ? ` · ${article.readingMinutes} min read` : ""}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setForceRefresh((n) => n + 1)}
            title="Re-fetch fresh copy from web"
            aria-label="Refresh article"
          >
            <RefreshCw size={14} />
          </button>
          <a
            className="icon-btn"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
          >
            <ExternalLink size={15} />
          </a>
          <TypographyMenu
            fontId={fontFamily}
            spacingId={spacingId}
            fontSize={font}
            onFont={changeFontFamily}
            onSpacing={changeSpacing}
            onSize={changeFont}
          />
          {!embedded && (
            <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
          )}
        </div>
      </header>

      <main className="article-body" ref={bodyRef}>
        {status === "loading" && (
          <div className="pane-overlay">
            <Loader2 className="spin" size={26} />
            <span>Fetching article…</span>
          </div>
        )}
        {status === "error" && (
          <div className="error-pane">
            <strong>Could not fetch this article.</strong>
            <p>{errorText}</p>
            <p>The site may block reader extraction or require a login.</p>
            <div className="error-actions">
              <button
                className="secondary-action"
                onClick={() => setRetry((r) => r + 1)}
              >
                Retry
              </button>
              <a
                className="secondary-action"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}
        {status === "ready" && (
          <div className="article-scroll">
            <div
              className="article-prose"
              style={{
                fontSize: `${font}%`,
                fontFamily: fontStackFor(fontFamily),
                lineHeight:
                  spacingValueFor(spacingId) ?? ARTICLE_DEFAULT_LINE_HEIGHT,
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <p className="article-source">
              Source:{" "}
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                {article.domain || article.url}
              </a>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

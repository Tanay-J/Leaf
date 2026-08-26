import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Minus, Plus } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { setArticleRead, updateArticleTitle, type SavedArticle } from "../articles";
import { navigate, type Theme } from "../lib";
import ThemeButton from "./ThemeButton";

interface Props {
  article: SavedArticle;
  theme: Theme;
  onCycleTheme: () => void;
}

const FONT_KEY = "article-font";

function loadFont(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    if (n >= 70 && n <= 200) return n;
  } catch {
    /* private mode */
  }
  return 100;
}

/**
 * Reader mode for a saved link. Content comes from Jina Reader
 * (https://r.jina.ai/<url>) — free, CORS-enabled, returns clean markdown —
 * then is rendered as sanitized HTML. Sites that block extraction fall
 * back to an "open original" escape hatch.
 */
export default function ArticleReader({ article, theme, onCycleTheme }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = useState("");
  const [errorText, setErrorText] = useState("");
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [font, setFont] = useState<number>(loadFont);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setStatus("loading");
    setErrorText("");
    setHtml("");
    setFetchedTitle(null);

    (async () => {
      try {
        const res = await fetch(`https://r.jina.ai/${article.url}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        if (disposed) return;
        const rendered = marked.parse(md) as string;
        setHtml(DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } }));
        setStatus("ready");
        setArticleRead(article.id, true);
        const heading = /^#\s+(.+)$/m.exec(md.slice(0, 4000))?.[1];
        if (heading?.trim()) {
          setFetchedTitle(heading.trim());
          updateArticleTitle(article.id, heading.trim());
        }
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
  }, [article.id, article.url, retry]);

  function changeFont(delta: number): void {
    setFont((f) => {
      const next = Math.min(180, Math.max(80, f + delta));
      try {
        localStorage.setItem(FONT_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const title = fetchedTitle ?? article.title;

  return (
    <div className="article-reader">
      <header className="topbar reader-topbar">
        <div className="topbar-actions">
          <button className="secondary-action" onClick={() => navigate("#/articles")}>
            <ArrowLeft size={15} />
            Reading list
          </button>
        </div>
        <div className="reader-title">
          <strong>{title}</strong>
          <span>{article.domain}</span>
        </div>
        <div className="topbar-actions">
          <a
            className="icon-btn"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
          >
            <ExternalLink size={15} />
          </a>
          <button className="mini-btn" onClick={() => changeFont(-10)} title="Smaller text">
            <Minus size={14} />
          </button>
          <span className="pos-label">{font}%</span>
          <button className="mini-btn" onClick={() => changeFont(10)} title="Larger text">
            <Plus size={14} />
          </button>
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="article-body">
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
              <button className="secondary-action" onClick={() => setRetry((r) => r + 1)}>
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
              style={{ fontSize: `${font}%` }}
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

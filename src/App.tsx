import { useEffect, useMemo } from "react";
import { useHashRoute, useTheme, navigate } from "./lib";
import Library from "./components/Library";
import Reader from "./components/Reader";
import ArticlesList from "./components/ArticlesList";
import ArticleReader from "./components/ArticleReader";
import { addArticle, getArticle } from "./articles";
import { initSync } from "./articleSync";
import { findBook } from "./userBooks";

export default function App() {
  const route = useHashRoute();
  const { theme, cycleTheme } = useTheme();

  /* Start the read-later sync engine once: it listens for local article
     mutations and pulls the remote gist once per session. */
  useEffect(() => {
    initSync();
  }, []);

  /* Split the hash into its path and query parts:
     "#/article/<id>", "#/articles", "#/add?url=...". */
  const parsed = useMemo(() => {
    const [path, queryString = ""] = route.split("?");
    return { path, query: new URLSearchParams(queryString) };
  }, [route]);

  /* The "#/add?url=…" route is the entry point used by the "Save to Leaf"
     bookmarklet: it saves the passed URL and jumps straight to reading. */
  useEffect(() => {
    if (parsed.path !== "#/add") return;
    const raw = parsed.query.get("url") ?? "";
    try {
      const { article } = addArticle(raw);
      navigate(`#/article/${article.id}`);
    } catch {
      navigate("#/articles?error=invalid");
    }
  }, [parsed]);

  const book = useMemo(() => {
    const prefix = "#/book/";
    if (!parsed.path.startsWith(prefix)) return null;
    const id = decodeURIComponent(parsed.path.slice(prefix.length));
    return findBook(id) ?? null;
  }, [parsed]);

  const articleId = useMemo(() => {
    const prefix = "#/article/";
    if (!parsed.path.startsWith(prefix)) return null;
    return decodeURIComponent(parsed.path.slice(prefix.length));
  }, [parsed]);

  const shared = { theme, onCycleTheme: cycleTheme };

  if (book) {
    return <Reader key={book.id} book={book} {...shared} />;
  }

  if (articleId) {
    const article = getArticle(articleId);
    return article ? (
      <ArticleReader key={article.id} article={article} {...shared} />
    ) : (
      <ArticlesList {...shared} />
    );
  }

  if (parsed.path === "#/add") return null; // redirecting via the effect above

  if (parsed.path === "#/articles") {
    return (
      <ArticlesList
        {...shared}
        initialError={parsed.query.get("error") === "invalid"}
      />
    );
  }

  return <Library {...shared} />;
}
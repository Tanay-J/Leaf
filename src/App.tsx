import { useMemo } from "react";
import { BOOKS } from "./books";
import { useHashRoute, useTheme } from "./lib";
import Library from "./components/Library";
import Reader from "./components/Reader";

export default function App() {
  const route = useHashRoute();
  const { theme, cycleTheme } = useTheme();

  const book = useMemo(() => {
    const prefix = "#/book/";
    if (!route.startsWith(prefix)) return null;
    const id = decodeURIComponent(route.slice(prefix.length));
    return BOOKS.find((b) => b.id === id) ?? null;
  }, [route]);

  return book ? (
    <Reader key={book.id} book={book} theme={theme} onCycleTheme={cycleTheme} />
  ) : (
    <Library theme={theme} onCycleTheme={cycleTheme} />
  );
}
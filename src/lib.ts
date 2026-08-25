import { useEffect, useState } from "react";

/* ---------- hash routing (works on GitHub Pages without server config) ---------- */

export function useHashRoute(): string {
  const [hash, setHash] = useState<string>(
    () => window.location.hash || "#/"
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

/* ---------- theme (light / sepia / dark) ---------- */

export type Theme = "light" | "sepia" | "dark";

const THEME_CYCLE: Theme[] = ["light", "sepia", "dark"];

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("reader-theme");
    if (stored && THEME_CYCLE.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    /* private mode */
  }
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark-theme", theme === "dark");
    root.classList.toggle("sepia-theme", theme === "sepia");
    try {
      localStorage.setItem("reader-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return {
    theme,
    cycleTheme: () =>
      setTheme(
        (t) => THEME_CYCLE[(THEME_CYCLE.indexOf(t) + 1) % THEME_CYCLE.length]
      ),
  };
}

/* ---------- reader sidebar (collapsible left pane) ---------- */

const sidebarKey = "reader-sidebar-open";

export function useSidebarOpen() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(sidebarKey);
      if (stored !== null) return stored === "1";
    } catch {
      /* private mode */
    }
    return typeof window === "undefined" || window.innerWidth > 720;
  });

  useEffect(() => {
    try {
      localStorage.setItem(sidebarKey, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [open]);

  return { sidebarOpen: open, toggleSidebar: () => setOpen((o) => !o) };
}

/* ---------- library view mode (grid / list) ---------- */

export type LibraryView = "grid" | "list";

export function useLibraryView() {
  const [view, setView] = useState<LibraryView>(() => {
    try {
      return localStorage.getItem("library-view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("library-view", view);
    } catch {
      /* storage unavailable */
    }
  }, [view]);

  return { view, setView };
}

/* ---------- reading progress (per browser, via localStorage) ---------- */

export interface BookProgress {
  cfi?: string;
  chapter?: string;
  fontSize?: number;
  fontFamily?: string;
  page?: number;
  total?: number;
  zoom?: number;
}

const progressKey = (id: string) => `reader:${id}`;

export function loadProgress(id: string): BookProgress {
  try {
    return JSON.parse(localStorage.getItem(progressKey(id)) ?? "{}");
  } catch {
    return {};
  }
}

export function saveProgress(id: string, data: BookProgress): void {
  try {
    localStorage.setItem(progressKey(id), JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}
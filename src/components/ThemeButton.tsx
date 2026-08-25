import { Moon, Sun, Sunset } from "lucide-react";
import type { ReactNode } from "react";
import type { Theme } from "../lib";

/* The icon previews the theme the next click will switch to. */
const NEXT_THEME_ICON: Record<Theme, ReactNode> = {
  light: <Sunset size={16} />,
  sepia: <Moon size={16} />,
  dark: <Sun size={16} />,
};

interface Props {
  theme: Theme;
  onCycleTheme: () => void;
}

export default function ThemeButton({ theme, onCycleTheme }: Props) {
  return (
    <button
      className="icon-btn"
      onClick={onCycleTheme}
      title={`Theme: ${theme} — click to change`}
    >
      {NEXT_THEME_ICON[theme]}
    </button>
  );
}
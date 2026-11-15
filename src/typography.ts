/**
 * Shared typography choices for the readers (EPUB + articles).
 *
 * Font stacks deliberately use system fonts (plus Literata, loaded from
 * Google Fonts in index.html) so nothing is bundled. An empty stack keeps
 * the book's own typography untouched.
 */
export interface FontOption {
  id: string;
  label: string;
  stack?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "", label: "Book's default font" },
  {
    id: "lora",
    label: "Lora (Classic Serif)",
    stack: "'Lora', Georgia, serif",
  },
  {
    id: "cormorant",
    label: "Cormorant Garamond",
    stack: "'Cormorant Garamond', Garamond, Georgia, serif",
  },
  {
    id: "literata",
    label: "Literata (Book)",
    stack: "'Literata', Georgia, serif",
  },
  {
    id: "newsreader",
    label: "Newsreader (Editorial)",
    stack: "'Newsreader', Georgia, serif",
  },
  {
    id: "eb-garamond",
    label: "EB Garamond",
    stack: "'EB Garamond', Garamond, Georgia, serif",
  },
  {
    id: "libre-baskerville",
    label: "Libre Baskerville",
    stack: "'Libre Baskerville', Baskerville, Georgia, serif",
  },
  {
    id: "serif",
    label: "Georgia",
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: "book",
    label: "Palatino",
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  {
    id: "charter",
    label: "Charter",
    stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
  },
  {
    id: "jakarta",
    label: "Sans — Plus Jakarta",
    stack: "'Plus Jakarta Sans', system-ui, sans-serif",
  },
  {
    id: "sans",
    label: "Sans — System",
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
];

export function fontStackFor(id: string): string | undefined {
  return FONT_OPTIONS.find((o) => o.id === id)?.stack;
}

/**
 * Line-spacing presets. `undefined` (the "default" option) leaves the book's
 * own line-height in place.
 */
export interface SpacingOption {
  id: string;
  label: string;
  value?: number;
}

export const LINE_HEIGHT_OPTIONS: SpacingOption[] = [
  { id: "tight", label: "Spacing: Tight", value: 1.4 },
  { id: "default", label: "Spacing: Default" },
  { id: "relaxed", label: "Spacing: Relaxed", value: 1.7 },
  { id: "wide", label: "Spacing: Wide", value: 2 },
];

/** "default" is the absence of an override. */
export const DEFAULT_SPACING_ID = "default";

export function spacingValueFor(id: string): number | undefined {
  return LINE_HEIGHT_OPTIONS.find((o) => o.id === id)?.value;
}

/** Matches the .article-prose CSS line-height used when no preset is set. */
export const ARTICLE_DEFAULT_LINE_HEIGHT = 1.8;
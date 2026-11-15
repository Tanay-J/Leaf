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
  { id: "", label: "Default font" },
  {
    id: "literata",
    label: "Literata (book)",
    stack: "'Literata', Georgia, serif",
  },
  {
    id: "serif",
    label: "Serif — Georgia",
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: "book",
    label: "Book — Palatino",
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  {
    id: "baskerville",
    label: "Baskerville",
    stack:
      "Baskerville, 'Baskerville Old Face', 'Hoefler Text', Garamond, 'Times New Roman', serif",
  },
  {
    id: "charter",
    label: "Charter",
    stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
  },
  {
    id: "sans",
    label: "Sans — System",
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  {
    id: "jakarta",
    label: "Sans — Jakarta",
    stack: "'Plus Jakarta Sans', system-ui, sans-serif",
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
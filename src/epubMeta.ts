/**
 * Reads an EPUB's own metadata (title/author/cover) with epub.js — used to
 * prefill the Add-book form and to give shelf cards real cover images.
 * Falls back to nulls on anything unexpected; never throws.
 */
import ePub from "epubjs";

export interface EpubMeta {
  title?: string;
  author?: string;
  cover?: Blob;
}

export async function readEpubMeta(file: File): Promise<EpubMeta | null> {
  let book: ReturnType<typeof ePub> | null = null;
  try {
    book = ePub(await file.arrayBuffer());
    await book.ready;
    const metadata = (
      book as unknown as {
        packaging?: { metadata?: { title?: unknown; creator?: unknown } };
      }
    ).packaging?.metadata;
    const title =
      typeof metadata?.title === "string" ? metadata.title.trim() : "";
    const author =
      typeof metadata?.creator === "string" ? metadata.creator.trim() : "";

    let cover: Blob | undefined;
    try {
      const url = await book.coverUrl();
      if (url) cover = await (await fetch(url)).blob();
    } catch {
      /* cover is optional */
    }

    return title || author || cover
      ? {
          ...(title ? { title } : {}),
          ...(author ? { author } : {}),
          ...(cover ? { cover } : {}),
        }
      : null;
  } catch {
    return null;
  } finally {
    try {
      (book as unknown as { destroy?: () => void } | null)?.destroy?.();
    } catch {
      /* cleanup is best-effort */
    }
  }
}
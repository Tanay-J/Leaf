/**
 * Deletes any unencrypted (*.epub / *.pdf) files from dist/books after a
 * build. Vite copies public/books verbatim, which may contain plain files
 * for local development — this guarantees only ciphertext can ever be
 * uploaded to hosting, even on a manual deploy.
 */
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve("dist/books");

try {
  const files = await readdir(dir);
  let removed = 0;
  for (const f of files) {
    // catalog.json is the generated manifest the app fetches — keep it.
    // covers/ holds the deploy-time cover images catalog.json points at.
    if (!f.endsWith(".enc") && f !== "catalog.json" && f !== "covers") {
      await unlink(path.join(dir, f));
      removed++;
    }
  }
  if (removed > 0) {
    console.log(
      `prune-plain-books: removed ${removed} unencrypted file(s) from dist/books`
    );
  }
} catch {
  // dist/books may not exist (e.g. fresh CI checkout) — nothing to prune.
}
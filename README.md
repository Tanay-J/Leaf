# Leaf 🍃

A personal web reader for EPUB and PDF files, built with React + Vite +
TypeScript. Same design language as the frontend-roadmap app (Plus Jakarta
Sans, card UI, light/dark themes).

- No uploads, no accounts — your books are listed in one file (`src/books.ts`)
  and fetched at runtime. The files live OUT of this repo and are served only
  as AES-256-GCM ciphertext, decrypted in the browser with a passphrase only
  you know (see "Your library stays off this repo").
- Remembers where you stopped in each book (per browser, via localStorage).
- Hash-based routing, so it works on GitHub Pages with zero server config.

## Add your books

Edit `src/books.ts`:

```ts
{
  id: "alice",                       // unique slug
  title: "Alice's Adventures in Wonderland",
  author: "Lewis Carroll",           // optional
  type: "epub",                      // "epub" or "pdf"
  url: "books/alice.epub",           // relative to the deployed site root
}
```

The `url` must be directly fetchable with CORS enabled. With the default
setup below, books are served by your own GitHub Pages site (which sends
`Access-Control-Allow-Origin: *`), so plain relative URLs like the above
just work. Absolute URLs to any CORS-enabled host are also fine.

## Develop

```
npm install
npm run dev        # http://localhost:5173
```

For `npm run preview` and production builds, generate ciphertext copies of
your local library first: `npm run encrypt-books` (prompts for your
passphrase). Every build also prunes unencrypted files from `dist/`.

## Deploy to GitHub Pages

A GitHub Actions workflow is included (`.github/workflows/deploy.yml`):

1. Push this repo to GitHub.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` builds and deploys automatically.
4. Open `https://<user>.github.io/<repo>/`.

## Your library stays off this repo

Book files never live in this public repo — and the live site never serves
readable ones either. Two layers achieve that on plain static hosting:

### 1. Source separation

Keep your `.epub` / `.pdf` files in any **private** source GitHub Actions
can check out — a private repo under your account works well, and its name
is entirely up to you. Wire it up with three Actions secrets (*this* repo →
Settings → Secrets and variables → Actions):

| Secret             | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| `CONTENT_REPO`     | `owner/name` of that private source                        |
| `CONTENT_TOKEN`    | fine-grained PAT: repository access limited to it, permission **Contents: Read-only** |
| `BOOKS_PASSPHRASE` | your library passphrase — pick a long one, and back it up  |

Because the source is referenced only through secrets, nothing in this
repo — code, git history, or CI logs — reveals where your files live.

### 2. Encryption

On every push, the workflow checks the source out, encrypts every file
with AES-256-GCM (key derived from `BOOKS_PASSPHRASE` via PBKDF2), and
deploys only `.enc` blobs. Builds additionally prune any unencrypted file
from `dist/`, so plaintext can't reach Pages even by accident. A missing
`BOOKS_PASSPHRASE` fails the deploy **on purpose**.

In the browser, visitors enter the passphrase once per session
(`sessionStorage`); `src/bookCrypto.ts` decrypts in memory and hands bytes
straight to epub.js / pdf.js. URLs in `src/books.ts` stay relative
(`books/alice.epub`) — the app transparently fetches `alice.epub.enc`.

**Honest limits:** the ciphertext itself remains downloadable, and a
determined visitor could dump decrypted bytes via devtools while reading —
client-side crypto can't prevent that. What this does stop is casual
downloading, hotlinking, crawlers, and plain EPUBs sitting on a public
host. Share the passphrase only with people you want reading your library.

## Features

- **EPUB** via [epub.js](https://github.com/futurepress/epub.js): paginated
  rendering, table of contents dropdown, font size controls, arrow keys.
- **PDF** via [Mozilla pdf.js](https://mozilla.github.io/pdf.js/): fit-to-width
  pages, zoom, jump-to-page, arrow keys.
- **Both**: prev/next buttons, resume-where-you-left-off, light/dark theme
  (dark mode inverts rendered book content for night reading).

## Notes

- Progress lives in `localStorage` under keys like `reader:<id>` — per
  browser/device.
- The theme choice is stored under `reader-theme`.
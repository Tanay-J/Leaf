# Leaf 🍃

A personal reading app for your EPUB and PDF books. Open a book and pick up
right where you left off — no accounts, no uploads, no sign-in.

---

## Quick Start (Local Use)

### 1. Prerequisites
- **Node.js**: v20 or higher
- **npm**: v9 or higher

### 2. Install & Start Development Server
```bash
git clone git@github.com:Tanay-J/Leaf.git
cd Leaf
npm install
npm run dev
```
Open **http://localhost:5173/** in your browser.

### 3. Local Book Encryption & Vault Catalog
Book files in `public/books/` are gitignored to keep media out of repository history.

To encrypt local books for testing or offline reading:
```bash
# Place your .epub or .pdf files inside public/books/
BOOKS_PASSPHRASE="your-passphrase" npm run encrypt-books
```
This script (`scripts/encrypt-books.mjs`):
1. Derives an AES-256-GCM key with PBKDF2 (310,000 iterations).
2. Encrypts each book into `public/books/<name>.enc`.
3. Extracts embedded covers into `public/books/covers/`.
4. Writes the catalog manifest to `public/books/catalog.json`.

> **Local Dev Remote Fallback:** When running locally (`http://localhost:5173`), if a book from `catalog.json` isn't present in your local `public/books/`, Leaf automatically fetches the ciphertext from your live GitHub Pages deployment and decrypts it with your passphrase.

### 4. Build for Production
```bash
npm run build
```
This runs TypeScript checking (`tsc`), compiles Vite bundles to `dist/`, and runs `scripts/prune-plain-books.mjs` to ensure unencrypted files never enter `dist/`.

Preview the production build locally:
```bash
npm run preview
```

---

## App Layout & Architecture

### 1. Landing Page — 3-Pane Studio Workbench
The library interface provides a desktop-class studio workbench:
- **Left Rail**:
  - **Workspace navigation**: Quick links to *My Shelf*, *Browse Vault*, *Reading List* (with unread article badge), and *Activity & Stats* (with live reading streak).
  - **Status filters**: Filter your books by *All*, *In Progress*, *Finished*, or *Unopened* with live counts.
  - **Add or Drop Book**: Quick file selector modal or drop any EPUB/PDF directly onto the window.
- **Center Shelf**:
  - **Search & Sort**: Filter books by title or author; sort by Recent, Title, Author, or Progress.
  - **Table / 2:3 Cover Grid View**: High-density table view with progress bars or visual 2:3 cover cards.
  - **Quick Vault Actions**: Move any book to *My Shelf* with the `+ Shelf` / `✓ On Shelf` button, or use `+ Pin All to Shelf` in the command bar.
  - **Continue Reading Banner**: One-click resume card at the top of your shelf.
- **Right Persistent Inspector**:
  - Real-time details for the selected book without leaving the shelf.
  - Cover preview, inline title/author metadata editing, reading time stats, and finish/resume toggles.
  - Live list of saved **Highlights & Bookmarks** with click-to-jump and **Copy as Markdown**.

### 2. Reader — Studio Docked Frame
A balanced, distraction-free reading environment:
- **Docked Left Rail**: Full-height drawer for the Table of Contents and saved notes, with a `← Back to Shelf` shortcut. Toggle with <kbd>S</kbd>.
- **Symmetric Top Header**: Centered book title and author, clean segmented `[ 1-Page | 2-Page ]` spread switcher, bookmark toggle, search, typography menu, and theme switcher.
- **Elevated Book Sheet**: Centered reading sheet (`.studio-sheet`) that smoothly widens in 2-page spread mode with a subtle book spine crease divider.
- **Integrated Docked Footer**: Docked bottom navigation bar with `‹ Previous` and `Next ›` controls, reading progress bar, and percentage readout.
- **Focus / Zen Mode**: Press <kbd>Z</kbd> or click the maximize button to collapse all bars and focus purely on reading. Press <kbd>Esc</kbd> or <kbd>Z</kbd> to exit.

---

## Reading Features

### EPUB & PDF Support
- **Page Layout**: Switch between **1-Page** and **2-Page Spread** view on both EPUBs and PDFs. EPUBs also support continuous scroll mode via the Typography menu.
- **Keyboard Navigation**:
  - `←` / `→` or `J` / `K`: Turn pages
  - `Space` / `Shift+Space`: Next / previous page
  - `B`: Toggle bookmark on the current page or chapter
  - `S`: Toggle sidebar (Contents & Notes)
  - `Z`: Toggle focus mode
  - `F`: Fullscreen
  - `?`: Open shortcut cheat sheet
- **Typography & Dark Reading**:
  - Adjust font size, line spacing, and choose font families (Literata, Georgia, Palatino, Baskerville, Charter, Sans-serif).
  - Cycle themes with the theme button: **Light → Sepia → Dark**. Sepia injects paper warm tints, and Dark mode inverts PDF and EPUB page content for night reading.
- **Bookmarks & Highlights**:
  - Press <kbd>B</kbd> to bookmark any page or chapter.
  - Select text in EPUBs to highlight passages or copy them to clipboard.
  - All highlights and bookmarks appear under the **Saved** sidebar tab and in the Library Inspector, with a one-click **Copy as Markdown** button.

---

## Adding books to the site

The Browse catalog is generated from the private content vault at deploy
time — book files live only there, never in this repo.

1. Drop the `.epub`/`.pdf` into the vault repo.
2. Optionally add display metadata to the vault's `books.json`
   (`"my-new-book.epub": { "title": "My New Book", "author": "A. Writer" }`).
   Without it, the title is derived from the filename.
3. Deploy manually: open the **Actions** tab in this repo, pick
   **Deploy to GitHub Pages**, and click **Run workflow**. Nothing runs on a
   schedule — books only go live when a deploy is triggered.

### Upload books from the app (recommended)

In **Add book**, choose **Set up vault uploads** and follow the steps shown
there (you'll need a GitHub token — the app walks you through what to
create). After that, **Add book → Choose an EPUB or PDF to upload** sends
the book to your private vault from any browser, including a phone. Once
the deploy finishes, the book shows up under **Browse** on every device and
can be pinned to your library with **+**.

The token is stored in this browser only and can be revoked any time;
**Disconnect vault** forgets it. Books stay private — they're encrypted
before being published.

New books then show up under **Browse** automatically; pin them to your
shelf with **+**.

---

## Passphrase Protection & Security

The built-in catalog is **passphrase-protected**: books are deployed as
encrypted files, and the reader asks for the library passphrase **once per
session** when you first open any catalog book.
- Enter your passphrase and check **Remember on this device** to persist it in `localStorage` across visits.
- Device-local books added via file picker or drag-and-drop are stored securely in IndexedDB and are never encrypted or uploaded.

---

## Reading list

A funnel for things you found online but want to read later — web pages, not
books.

- **Open it** — the **Reading list** button in the Library rail or top bar.
- **Add an article** — paste a link at the top of the page, or drag the
  **Save to Leaf** bookmarklet to your browser’s bookmarks bar.
- **Read** — tap an article. Adjust font styles, spacing, and font size.
- **Sync across devices** — sync via your vault (`sync` branch) or GitHub Gist.

---

## Privacy & Backups

Everything — reading progress, font preferences, bookmarks, and theme — stays in
your browser. Nothing is uploaded or shared without explicit token configuration.

The **Sync & backup** card at the bottom of the Library rail allows you to
**export** your entire library state (progress, pins, highlights, bookmarks, reading streak)
as a single JSON backup file and restore it on any browser. Tokens are never included in backups.

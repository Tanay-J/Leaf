# Leaf 🍃

A personal reading app for your EPUB and PDF books. Open a book and pick up
right where you left off — no accounts, no uploads, no sign-in.

## Your library

The front page is **your** shelf — only the books you've collected. Use the
**My library / Browse** control to move between your shelf and the built-in
catalog that ships with Leaf.

- **Browse** — every book from the built-in catalog lives here. Click **+** on
  a card to pin it to your library, or ✓ again to unpin; you can open and read
  anything without adding it first.
- **Add a book** — click **Add book** and either paste a link to an EPUB/PDF
  hosted anywhere, or choose a file from this device. Device files are stored
  in your browser (IndexedDB) and never uploaded; removing the book deletes
  its stored copy. You can also **upload a file to your vault** — it's
  published on every device after the deploy (see below).
- **Find a book** — search by title or author (scoped to whichever tab you're
  on), or switch between grid and list views.
- **Open a book** — click any card to start reading.
- **Resume reading** — every book remembers the page or chapter you were on.
  With your vault connected, your place, pins, and "finished" marks follow
  you across devices automatically.
- **Reading stats** — My library quietly shows how many books you've
  finished, how many you're reading, and your current reading streak.

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

## Reading

The built-in catalog is **passphrase-protected**: books are deployed as
encrypted files, and the reader asks for the library passphrase **once per
session** when you first open any catalog book. Enter it and every book unlocks
for that browser session. Your own device-added books are never encrypted —
they never leave your browser.

**EPUB**
- Turn pages with the **Prev / Next** buttons or the **← / → arrow keys**.
- Use the **Contents** panel to jump to any chapter.
- Adjust **font size** and choose a **font style** (default, serif, book,
  sans) from the toolbar.

**PDF**
- **Zoom in / out** to fit the page width you prefer.
- **Jump to a page** with the page-number box at the bottom.
- The **Contents** panel shows bookmarks when the PDF has them.

## Reading list

A funnel for things you found online but want to read later — web pages, not
books.

- **Open it** — the **Reading list** button in the Library top bar (the badge
  shows how many unread articles you have).
- **Add an article** — paste a link at the top of the page, or drag the
  **Save to Leaf** bookmark to your browser’s bookmarks bar; clicking it on
  any website saves that page instantly.
- **Read** — tap an article. Use the **− / +** buttons to change the text size
  and **Open original** to see it on the source site. Opening an article marks
  it as read (the unread dot clears).
- **Remove** — use the trash icon on any row.

Articles stay in your browser, just like reading progress.

### Sync across devices

Your reading list can follow you across browsers and computers.

**Easiest — through your vault:** if you've connected your vault (book
uploads), open the Reading list and click **Sync via my vault**. No token,
no setup — the list syncs through your vault on every connected device.

**Classic — through a GitHub Gist:**

1. Create a **classic** personal access token with only the **`gist`** scope
   (GitHub → Settings → Developer settings → Personal access tokens → Tokens
   (classic)).
2. On the Reading list page, paste the token into the **Sync across devices**
   card and connect.
3. Do the same on your other devices. The first device creates the gist; the
   rest find it automatically from your account.

- Your list syncs automatically after you add, read, or remove an article, and
  on each visit. Use **Sync now** to force a refresh.
- Reading state and titles sync too. Removing an article deletes it everywhere.
- The token is stored in your browser only and can be revoked at any time.
  Deleting the Gist stops sync but never touches your local copy.

## Appearance

The theme button cycles **Light → Sepia → Dark**. Dark mode is easier on the
eyes at night, and your choice is remembered.

## Privacy

Everything — reading progress, font preferences, and the theme — stays in
your browser. Nothing is uploaded or shared.

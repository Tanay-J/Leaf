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
  its stored copy.
- **Find a book** — search by title or author (scoped to whichever tab you're
  on), or switch between grid and list views.
- **Open a book** — click any card to start reading.
- **Resume reading** — every book remembers the page or chapter you were on,
  per browser. Pinning and unpinning never loses your place.

## Reading

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

Your reading list can follow you across browsers and computers, synced through
a private GitHub Gist.

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

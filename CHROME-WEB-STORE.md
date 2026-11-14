# Chrome Web Store submission kit

Everything here is paste-ready for the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## One-time prerequisites

1. Sign in with any Google account.
2. Pay the **$5 one-time registration fee** (Google requires it; no way around it).
3. Accept the developer terms.

## Create the item

1. Dashboard → **New item** → upload the store zip: `dist/StepNotate-1.0.0.zip`
   (manifest.json is at the zip root, as required).
2. Fill the listing:

### Store listing

- **Title:** `StepNotate — PDF Annotator`
- **Summary** (max 132 chars):

  ```
  Open any PDF or image and mark it up — highlights, ink, notes, signatures. Free, local, no account.
  ```

- **Description:**

  ```
  StepNotate turns any PDF or image into a page you can mark up — without accounts, uploads, or limits.

  OPEN ANYTHING
  • Files from your computer (picker or drag-and-drop)
  • Direct document URLs
  • Right-click any PDF or image link on the web → "Open with StepNotate"
  • Press Alt+Shift+S to jump in from anywhere

  ANNOTATE
  • Highlight, underline, strikethrough over real text
  • Pen and marker ink, rectangles, ellipses, lines, arrows
  • Text boxes and sticky notes
  • Draw-once signature pad and custom image stamps
  • Eraser, select/move/resize, full undo/redo

  WORK SMARTER
  • Full-text search across the document
  • Page thumbnails and a notes list
  • Zoom, rotate, night mode (inverts dark pages), distraction-free present mode
  • Autosave — every document keeps its marks locally, reopen anytime

  EXPORT
  • Flattened annotated PDF that opens anywhere (Ctrl+S)
  • Single page as PNG
  • Your whole mark set as a portable .stepnotate.json project file

  PRIVATE BY DESIGN
  No accounts. No servers. No analytics. Nothing you open ever leaves your device.

  Free forever. Made by St3p.
  ```

- **Language:** English
- **Category:** `Productivity`
- **Graphic assets:** at least one screenshot (see below).

### Data safety

- Select: **"This item does not collect user data."**
- No data transmitted, no data sold, no data retained off-device — all correct for StepNotate.
- **Privacy policy URL:** `https://github.com/thefirstacc164/StepNotate/blob/main/PRIVACY.md`

### Single purpose

```
View, annotate, and export PDF and image documents opened by the user.
```

### Permission justifications (review form)

Paste these verbatim:

- **Why does your extension need the `unlimitedStorage` permission?**

  ```
  Documents and annotations are stored locally in the browser's IndexedDB. Browser quota for extension origins is about 10MB — smaller than many single PDFs. unlimitedStorage lets users annotate files of any size without the extension failing to save.
  ```

- **Why does your extension need the <all_urls> host permission?**

  ```
  Two reasons: (1) fetching the document from the direct URL the user explicitly enters, which browsers block cross-origin without host permission; (2) reading the current tab's address so the toolbar popup can offer to open it. The extension injects no content scripts and modifies no page content.
  ```

- **Why does your extension need the `contextMenus` permission?**

  ```
  Adds the "Open with StepNotate" item to the right-click menu on PDF and image links, so users can open a document in one click.
  ```

## Screenshots

Take 1–3 screenshots after loading the extension in Brave (1280×800 or 640×400):

1. The welcome page with the sample document open.
2. Annotating: highlights + pen marks on the sample's "checklist" page.
3. The notes list / search panel or a night-mode page.

Tip: `brave://extensions` → StepNotate → "Open sample" (or the welcome screen's *Open the sample* button) gives an instant demo document.

## What happens next

1. Submit for review — typical first review is 1–3 days (new developer accounts can take up to a week).
2. Common review questions are pre-answered by the justifications above; the extension ships no remote code, everything is bundled.
3. Once approved it's live at a store URL and installable by anyone.

The exact same zip works for manual Brave install today — the store step only adds Google's review + distribution.

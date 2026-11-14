# StepNotate

A free PDF annotator for Chrome and Brave. Open any PDF or image — from disk, a direct link, or drag-and-drop — and mark it up: highlights, pen, sticky notes, text, signatures, stamps. Everything runs on your device; nothing is uploaded.

Built by **St3p**.

---

## Install (Brave / Chrome)

1. Download or clone this repository.
2. Open `brave://extensions` (Chrome: `chrome://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension/` folder from this repo.

That's it — StepNotate appears in your toolbar. Press **Alt+Shift+S** anywhere to jump in.

Prefer a zip? Unzip `dist/StepNotate-1.0.0.zip` and load the extracted folder unpacked.

## Open a document

- **Toolbar popup** → Open file / Open link / pick from recent documents
- **Right-click a PDF or image link** on any page → *Open with StepNotate*
- **Drag & drop** a file onto the viewer
- **Ctrl+O** inside the viewer
- Or start with the bundled 3-page sample from the welcome screen

## Tools

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Move, resize, restyle anything on the page |
| Highlight | H | Marker-style highlight over real text (multiply blend) |
| Pen | P | Freehand ink |
| Marker | M | Thick translucent marker strokes |
| Underline / Strike | — | From the selection bar while text is selected |
| Text | T | Click to drop a text box |
| Note | N | Sticky notes with a comment thread feel |
| Signature | G | Draw once, reuse everywhere |
| Stamp | I | Custom image stamps |
| Shapes | — | Rectangle, ellipse, line, arrow (palette flyout) |
| Eraser | R | Rub out marks |

Plus: undo/redo, full-text search, page thumbnails, notes list, zoom & rotate, night mode (inverts dark PDFs), present mode, and autosave — every mark is kept per document, locally, in IndexedDB.

## Export

- **Ctrl+S** — flattened annotated PDF (marks are baked in, opens anywhere)
- **Menu → Export page as PNG**
- **Menu → Export / import project** — move your marks as a `.stepnotate.json` file

## Shortcuts

`V H P M T N G I R` tools · `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Ctrl+S` export · `Ctrl+F` search · `Ctrl+/-/0` zoom · `Esc` close/cancel · `PgUp/PgDn` pages · `Del` remove selection

(Full list lives in the viewer menu → *Keyboard shortcuts*.)

## Privacy

No accounts, no servers, no analytics, no AI. Documents and annotations never leave your machine. The extension only asks for the access it needs to open pages and files you choose.

## Repository layout

```
extension/          the extension itself (load this folder unpacked)
  manifest.json     MV3 manifest
  viewer.html       the annotate page (SPA)
  js/               app modules (state, engine, tools, export, …)
  styles/           design system
  vendor/           pdf.js + pdf-lib (MIT, licenses included)
  samples/          bundled sample document
tools/              dev scripts (no dependencies)
samples/            sample source copy
```

Dev scripts (Node 18+):

```bash
node tools/make-icons.mjs     # regenerate extension/icons
node tools/make-sample.mjs    # regenerate the sample PDF
node tools/smoke.mjs          # static + module-graph checks
node tools/e2e.mjs            # sample → annotate → export round-trip
```

## License

Code by St3p. Vendored pdf.js and pdf-lib keep their own MIT licenses under `extension/vendor/`.

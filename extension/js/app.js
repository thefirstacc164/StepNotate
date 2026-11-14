import {
  state,
  on,
  emit,
  loadPrefs,
  savePrefs,
  TOOL_LABELS,
  TOOL_HINTS,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  NOTE_COLORS,
} from "./state.js";
import { engine } from "./engine.js";
import { history } from "./history.js";
import {
  buildDocument,
  fetchDocumentBytes,
  hashBytes,
  looksLikePdf,
} from "./loader.js";
import * as db from "./db.js";
import { initTools, finishEditing, isEditing, refreshSelBar } from "./tools.js";
import { initInspector, refreshInspector } from "./inspector.js";
import { initSidebar, focusSearch, refreshSidebar } from "./sidebar.js";
import { renderAllOverlays, selectAnn, clearAll } from "./annotations.js";
import { exportPdf, exportPng, exportProject, importProject } from "./exporter.js";
import { openModal, toast, confirmDialog, colorPop, signaturePad } from "./dialogs.js";
import {
  formatBytes,
  timeAgo,
  escapeHtml,
  isWebUrl,
  fileNameFromUrl,
  clamp,
} from "./util.js";

const $ = (id) => document.getElementById(id);

let docId = null;
let saveTimer = null;
let thumbDone = false;

function showLanding() {
  $("landing").hidden = false;
  $("app").hidden = true;
  document.title = "StepNotate";
}

function showApp() {
  $("landing").hidden = true;
  $("app").hidden = false;
}

function setSaveState(text, kind) {
  const el = $("saveState");
  el.classList.toggle("is-saving", kind === "saving");
  el.classList.toggle("is-error", kind === "error");
  el.innerHTML = `<span class="save-dot"></span> ${escapeHtml(text)}`;
}

function scheduleSave() {
  if (!docId) return;
  state.dirty = true;
  setSaveState("Saving…", "saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 550);
}

async function flushSave() {
  if (!docId) return;
  clearTimeout(saveTimer);
  try {
    await db.saveMarks(docId, state.annotations, { pageCount: state.pageCount });
    state.dirty = false;
    setSaveState("Saved locally", "ok");
  } catch {
    setSaveState("Save failed", "error");
  }
}

function updateStatus() {
  $("statusPages").textContent = state.pageCount ? `${state.pageCount} page${state.pageCount > 1 ? "s" : ""}` : "—";
  const bytes = state.doc?.bytes?.byteLength || 0;
  $("statusSize").textContent = bytes ? formatBytes(bytes) : "—";
  $("docName").textContent = state.doc?.name || "Document";
  $("docSub").textContent = state.doc
    ? `${state.pageCount} page${state.pageCount > 1 ? "s" : ""} · ${state.doc.kind === "pdf" ? "PDF" : "Image"}`
    : "—";
  $("pageTotal").textContent = String(state.pageCount || 1);
}

function updateZoomLabel() {
  $("zoomValue").textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateUndoRedo() {
  $("undoBtn").disabled = !history.canUndo();
  $("redoBtn").disabled = !history.canRedo();
}

function chipColorsForTool() {
  const t = state.tool;
  if (t === "highlight") return { colors: HIGHLIGHT_COLORS, key: "highlight" };
  if (t === "note") return { colors: NOTE_COLORS, key: "note" };
  return { colors: INK_COLORS, key: "ink" };
}

function syncChip() {
  const { colors, key } = chipColorsForTool();
  $("chipSwatch").style.background = state.style[key];
  $("paletteChip").dataset.key = key;
  void colors;
}

function setTool(tool, opts = {}) {
  if (!TOOL_LABELS[tool]) return;
  if (state.tool !== tool) finishEditing();
  state.tool = tool;
  state.toolOptions.textMark = ["underline", "strike"].includes(tool) ? tool : state.toolOptions.textMark;
  document.querySelectorAll(".tool[data-tool]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.tool === tool);
  });
  const shapeTools = ["rect", "ellipse", "line", "arrow"];
  const flyoutBtn = document.querySelector('[data-flyout="shape"]');
  if (flyoutBtn) flyoutBtn.classList.toggle("is-on", shapeTools.includes(tool));
  if (!shapeTools.includes(tool)) $("shapeFlyout").hidden = true;
  engine.setToolClass(tool);
  $("toolHint").textContent = TOOL_HINTS[tool] || "";
  syncChip();
  refreshInspector();
  if (!opts.silent) emit("tool");
}

function applyZoom(zoom, opts = {}) {
  state.zoom = clamp(zoom, 0.08, 8);
  if (opts.fit) state.fit = opts.fit;
  else state.fit = null;
  updateZoomLabel();
  engine.updateView();
  renderAllOverlays();
  refreshSelBar();
}

function applyFit(mode) {
  if (!state.doc) return;
  const stage = $("stage");
  const zoom = engine.fit(mode, stage.clientWidth, stage.clientHeight);
  state.fit = mode;
  applyZoom(zoom, { fit: mode });
}

function currentFitZoom() {
  if (!state.fit || !state.doc) return null;
  const stage = $("stage");
  return engine.fit(state.fit, stage.clientWidth, stage.clientHeight);
}

function gotoPage(n, smooth = true) {
  if (!state.doc) return;
  engine.scrollToPage(n, smooth);
}

function updatePagePill() {
  $("pageInput").value = String(state.currentPage);
}

function openFilePicker() {
  $("docInput").value = "";
  $("docInput").click();
}

async function handleFile(file) {
  if (!file) return;
  const bytes = await file.arrayBuffer();
  await openBytes(bytes, file.name, file.type || guessMime(file.name));
}

function guessMime(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "avif") return "image/avif";
  return "application/octet-stream";
}

function showError(title, text) {
  showApp();
  $("stageLoading").hidden = true;
  $("errorCard").hidden = false;
  $("errorTitle").textContent = title;
  $("errorText").textContent = text;
}

function hideError() {
  $("errorCard").hidden = true;
}

async function openBytes(input, name, mime, opts = {}) {
  let bytes = input;
  if (ArrayBuffer.isView(bytes)) {
    bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  hideError();
  showApp();
  $("stageLoading").hidden = false;
  $("loadingTitle").textContent = `Opening ${name}`;
  $("loadingSub").textContent = "Reading pages…";
  try {
    if (state.doc?.destroy) {
      try {
        await state.doc.destroy();
      } catch {}
    }
    const id = opts.id || `d_${await hashBytes(bytes)}`;
    const doc = await buildDocument({
      bytes,
      name,
      mime,
      onProgress: (p) => {
        $("loadingSub").textContent = `Reading pages… ${Math.round(p * 100)}%`;
      },
    });
    const existing = await db.getDocumentMeta(id);
    const meta = {
      id,
      name: doc.name,
      mime: doc.mime || mime,
      size: bytes.byteLength,
      pageCount: doc.pageCount,
      openedAt: Date.now(),
      ...(existing?.thumb ? { thumb: existing.thumb } : {}),
    };
    await db.saveDocument(meta, existing ? null : bytes);
    const marks = await db.getMarks(id);
    docId = id;
    state.doc = doc;
    state.pageCount = doc.pageCount;
    state.annotations = Array.isArray(marks?.annotations) ? marks.annotations : [];
    state.selection = null;
    state.currentPage = 1;
    state.__searchText = null;
    state.dirty = false;
    history.past = [];
    history.future = [];
    history.pending = null;
    emit("history");
    engine.build($("pages"), $("pageScroll"), doc);
    setTool(state.tool, { silent: true });
    applyFit("width");
    $("stageLoading").hidden = true;
    hideError();
    updateStatus();
    updatePagePill();
    setSaveState("Saved locally", "ok");
    thumbDone = false;
    emit("pages-rendered");
    renderAllOverlays();
    document.title = `${doc.name} · StepNotate`;
    setTimeout(() => engine.renderNear(), 30);
  } catch (err) {
    console.error(err);
    $("stageLoading").hidden = true;
    const msg = String(err?.message || err);
    showError(
      "Could not open that file",
      /network|failed|cors|403|404/i.test(msg)
        ? "The link could not be fetched (blocked by the site or the network). Try downloading the file and opening it from disk."
        : `The file could not be read. ${msg.slice(0, 140)}`
    );
  }
}

async function openUrl(url) {
  if (!isWebUrl(url)) {
    showError("Invalid link", "Enter a full http(s) URL to a PDF or image.");
    return;
  }
  showApp();
  $("stageLoading").hidden = false;
  $("loadingTitle").textContent = "Fetching document";
  $("loadingSub").textContent = fileNameFromUrl(url) || url;
  try {
    const bytes = await fetchDocumentBytes(url);
    const name = fileNameFromUrl(url) || "Document";
    await openBytes(bytes, name, guessMime(name));
  } catch (err) {
    console.error(err);
    $("stageLoading").hidden = true;
    showError(
      "Could not fetch that link",
      "The site blocked the request or the URL is not reachable from here. Download the file and use “Open a file” instead."
    );
  }
}

async function openStored(id) {
  try {
    const meta = await db.getDocumentMeta(id);
    if (!meta) {
      showLanding();
      toast("That document is no longer in the library", "bad");
      return;
    }
    const bytes = await db.getDocumentBytes(id);
    if (!bytes) {
      showLanding();
      toast("File data missing — open it from disk again", "bad");
      return;
    }
    await openBytes(bytes, meta.name, meta.mime, { id });
  } catch (err) {
    console.error(err);
    showLanding();
    toast("Could not open that document", "bad");
  }
}

async function openSample() {
  try {
    const hasChrome = typeof chrome !== "undefined" && !!chrome.runtime?.getURL;
    const url = hasChrome ? chrome.runtime.getURL("samples/sample.pdf") : "samples/sample.pdf";
    const bytes = await fetchDocumentBytes(url);
    await openBytes(bytes, "StepNotate sample.pdf", "application/pdf");
  } catch (err) {
    console.error(err);
    showLanding();
    toast("Sample could not be loaded", "bad");
  }
}

async function renderRecent() {
  const root = $("landingRecent");
  const empty = $("landingEmpty");
  try {
    const docs = await db.listDocuments();
    const items = docs.slice(0, 8);
    empty.hidden = items.length > 0;
    root.innerHTML = items
      .map(
        (d) => `
      <button class="recent-item" data-id="${escapeHtml(d.id)}">
        <span class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : `${d.pageCount || 1}p`}</span>
        <span class="recent-info">
          <span class="recent-title">${escapeHtml(d.name || "Untitled")}</span>
          <span class="recent-sub">${d.pageCount ? `${d.pageCount} page${d.pageCount > 1 ? "s" : ""}` : "Document"} · ${timeAgo(d.openedAt)}</span>
        </span>
      </button>`
      )
      .join("");
    root.querySelectorAll(".recent-item").forEach((row) => {
      row.addEventListener("click", () => openStored(row.dataset.id));
    });
  } catch {
    empty.hidden = false;
  }
}

function toggleMenu(force) {
  const pop = $("menuPop");
  const show = force !== undefined ? force : pop.hidden;
  pop.hidden = !show;
  if (show) {
    const btn = $("menuBtn").getBoundingClientRect();
    pop.style.top = `${btn.bottom + 8}px`;
    pop.style.left = `${Math.max(8, btn.right - pop.offsetWidth)}px`;
  }
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  savePrefs();
}

function toggleNight() {
  state.night = !state.night;
  document.body.classList.toggle("night", state.night);
  $("nightCheck").classList.toggle("is-on", state.night);
}

function togglePresent() {
  document.body.classList.toggle("is-present");
  if (document.body.classList.contains("is-present")) {
    toast("Present mode — Esc to exit");
    setTimeout(() => applyFit(state.fit || "page"), 60);
  } else if (state.doc) {
    setTimeout(() => state.fit && applyFit(state.fit), 60);
  }
}

const SHORTCUTS = [
  ["Select tool", "V"],
  ["Highlight text", "H"],
  ["Pen", "P"],
  ["Marker", "M"],
  ["Text box", "T"],
  ["Sticky note", "N"],
  ["Signature", "G"],
  ["Image stamp", "I"],
  ["Eraser", "E"],
  ["Rectangle", "R"],
  ["Escape / back to select", "Esc"],
  ["Undo", "Ctrl Z"],
  ["Redo", "Ctrl Shift Z"],
  ["Save annotated PDF", "Ctrl S"],
  ["Find in document", "Ctrl F"],
  ["Zoom in / out", "Ctrl + / −"],
  ["Fit width", "Ctrl 0"],
  ["Delete selection", "Del"],
  ["Next / previous page", "PgDn / PgUp"],
];

function showShortcuts() {
  openModal({
    title: "Keyboard shortcuts",
    body: `<table class="shortcut-table">${SHORTCUTS.map(([label, keys]) => `<tr><td>${escapeHtml(label)}</td><td><kbd>${escapeHtml(keys)}</kbd></td></tr>`).join("")}</table>`,
    actions: [{ label: "Close", primary: true }],
    wide: false,
  });
}

function showAbout() {
  openModal({
    title: "About StepNotate",
    body: `
      <div class="mark about-mark" style="width:56px;height:56px;margin-bottom:12px">
        <svg viewBox="0 0 128 128" aria-hidden="true" style="width:56px;height:56px">
          <rect width="128" height="128" rx="30" fill="#1b1f24"/>
          <path d="M29 96V55h22V35h22V15h26v81H29Z" fill="#faf8f3"/>
          <rect x="29" y="100" width="70" height="10" rx="5" fill="#d8482a"/>
        </svg>
      </div>
      <p><b>StepNotate 1.0 · Made by St3p.</b></p>
      <p>PDFs and images open in a full markup workspace. Files are read in this browser, annotations are stored in this browser's local database, and exports happen on your machine. No account, no tracking, no server.</p>
      <p>Project files can be handed to someone else and reopened with Import project.</p>`,
    actions: [{ label: "Close", primary: true }],
  });
}

async function clearMarks() {
  const ok = await confirmDialog(
    "Clear all annotations",
    `Remove every mark on this document (${state.annotations.length})? You can undo this once.`,
    "Clear all"
  );
  if (!ok) return;
  clearAll();
}

function bindDropTarget() {
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    depth += 1;
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    await handleFile(e.dataTransfer.files[0]);
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    const inField =
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Escape") {
      if (document.body.classList.contains("is-present")) {
        togglePresent();
        return;
      }
      if (!$("menuPop").hidden) {
        toggleMenu(false);
        return;
      }
      if (!$("shapeFlyout").hidden) {
        $("shapeFlyout").hidden = true;
        return;
      }
      if (inField) return;
      if (isEditing()) return;
      if (state.tool !== "select") setTool("select");
      else if (state.selection) selectAnn(null);
      return;
    }

    if (inField || isEditing()) return;

    if (mod) {
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (key === "y") {
        e.preventDefault();
        history.redo();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        exportPdf();
        return;
      }
      if (key === "f") {
        e.preventDefault();
        if (state.doc) focusSearch();
        return;
      }
      if (key === "=" || key === "+") {
        e.preventDefault();
        applyZoom(state.zoom * 1.25);
        return;
      }
      if (key === "-" || key === "_") {
        e.preventDefault();
        applyZoom(state.zoom / 1.25);
        return;
      }
      if (key === "0") {
        e.preventDefault();
        applyFit("width");
        return;
      }
      return;
    }

    if (!state.doc) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selection) {
        e.preventDefault();
        import("./annotations.js").then((m) => {
          history.push();
          m.removeAnn(state.selection);
        });
      }
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      gotoPage(state.currentPage + 1);
      return;
    }
    if (e.key === "PageUp") {
      e.preventDefault();
      gotoPage(state.currentPage - 1);
      return;
    }

    const map = {
      v: "select",
      h: "highlight",
      p: "pen",
      m: "marker",
      t: "text",
      n: "note",
      g: "signature",
      i: "stamp",
      e: "eraser",
      r: "rect",
    };
    const tool = map[e.key.toLowerCase()];
    if (tool && !e.altKey) {
      e.preventDefault();
      setTool(tool);
    }
  });
}

function bindUI() {
  $("openFileBtn").addEventListener("click", openFilePicker);
  $("errorPickFile").addEventListener("click", openFilePicker);
  $("errorHome").addEventListener("click", () => {
    hideError();
    showLanding();
    renderRecent();
  });
  $("docInput").addEventListener("change", () => {
    handleFile($("docInput").files?.[0])?.catch?.((err) => {
      console.error(err);
      showError("Could not open that file", String(err?.message || err));
    });
  });

  $("openLinkBtn").addEventListener("click", () => {
    const form = $("urlForm");
    form.hidden = !form.hidden;
    if (!form.hidden) $("urlInput").focus();
  });
  $("urlForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("urlInput").value.trim();
    if (url) openUrl(url);
  });

  $("landingTheme").addEventListener("click", toggleTheme);
  $("landingShortcuts").addEventListener("click", showShortcuts);
  $("clearRecent").addEventListener("click", async () => {
    const ok = await confirmDialog("Clear library", "Remove all stored documents and annotations from this browser?", "Clear");
    if (!ok) return;
    try {
      const docs = await db.listDocuments();
      for (const d of docs) await db.removeDocument(d.id);
    } catch {}
    renderRecent();
    toast("Library cleared");
  });
  $("openAppFooter").addEventListener("click", openFilePicker);

  $("homeBtn").addEventListener("click", async () => {
    await flushSave();
    showLanding();
    renderRecent();
  });

  $("toolPalette").addEventListener("click", (e) => {
    const flyoutBtn = e.target.closest("[data-flyout]");
    if (flyoutBtn) {
      const panel = $("shapeFlyout");
      panel.hidden = !panel.hidden;
      return;
    }
    const btn = e.target.closest("[data-tool]");
    if (!btn) return;
    setTool(btn.dataset.tool);
    if (["rect", "ellipse", "line", "arrow"].includes(btn.dataset.tool)) {
      $("shapeFlyout").hidden = true;
    }
  });

  $("paletteChip").addEventListener("click", () => {
    const { colors, key } = chipColorsForTool();
    colorPop($("paletteChip"), colors, state.style[key], (color) => {
      state.style[key] = color;
      savePrefs();
      syncChip();
      refreshInspector();
      emit("style");
    });
  });

  $("zoomIn").addEventListener("click", () => applyZoom(state.zoom * 1.25));
  $("zoomOut").addEventListener("click", () => applyZoom(state.zoom / 1.25));
  $("zoomValue").addEventListener("click", () => applyZoom(1));
  $("fitWidth").addEventListener("click", () => applyFit("width"));
  $("fitPage").addEventListener("click", () => applyFit("page"));

  $("undoBtn").addEventListener("click", () => history.undo());
  $("redoBtn").addEventListener("click", () => history.redo());
  $("saveBtn").addEventListener("click", () => exportPdf());

  $("menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!$("menuPop").hidden && !$("menuPop").contains(e.target) && e.target !== $("menuBtn") && !$("menuBtn").contains(e.target)) {
      toggleMenu(false);
    }
  });

  const menuActions = [
    ["menuDownloadPdf", () => exportPdf()],
    ["menuDownloadPage", () => exportPng()],
    ["menuExportProject", () => exportProject()],
    ["menuImportProject", () => importProject()],
    ["menuRotate", () => {
      state.rotation = (state.rotation + 90) % 360;
      engine.updateView();
      renderAllOverlays();
      refreshSidebar();
      toast(`Rotated to ${state.rotation}°`);
    }],
    ["menuNight", () => toggleNight()],
    ["menuPresent", () => togglePresent()],
    ["menuTheme", () => toggleTheme()],
    ["menuOpen", () => openFilePicker()],
    ["menuShortcuts", () => showShortcuts()],
    ["menuClearMarks", () => clearMarks()],
    ["menuAbout", () => showAbout()],
  ];
  for (const [id, fn] of menuActions) {
    $(id).addEventListener("click", () => {
      toggleMenu(false);
      fn();
    });
  }

  $("prevPage").addEventListener("click", () => gotoPage(state.currentPage - 1));
  $("nextPage").addEventListener("click", () => gotoPage(state.currentPage + 1));
  $("pageInput").addEventListener("change", () => {
    const n = parseInt($("pageInput").value, 10);
    if (Number.isFinite(n)) gotoPage(n);
    else updatePagePill();
  });
  $("pageInput").addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") $("pageInput").blur();
  });

  $("sidebarToggle").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-hidden");
    setTimeout(() => {
      const fit = currentFitZoom();
      if (fit) applyZoom(fit, { fit: state.fit });
    }, 240);
  });
  $("inspectorHide").addEventListener("click", () => {
    document.body.classList.add("inspector-hidden");
    $("inspectorPeek").hidden = false;
  });
  $("inspectorPeek").addEventListener("click", () => {
    document.body.classList.remove("inspector-hidden");
    $("inspectorPeek").hidden = true;
  });

  window.addEventListener("resize", () => {
    const fit = currentFitZoom();
    if (fit && Math.abs(fit - state.zoom) > 0.001) applyZoom(fit, { fit: state.fit });
  });

  window.addEventListener("beforeunload", () => {
    if (state.dirty && docId) {
      try {
        db.saveMarks(docId, state.annotations, { pageCount: state.pageCount });
      } catch {}
    }
  });
}

function bindEvents() {
  on("changed", () => {
    scheduleSave();
    updateUndoRedo();
    refreshInspector();
    refreshSidebar();
  });
  on("selection", () => {
    refreshInspector();
    renderAllOverlays();
  });
  on("history", updateUndoRedo);
  on("tool", () => {
    $("toolHint").textContent = TOOL_HINTS[state.tool] || "";
  });
  on("page-changed", (n) => {
    state.currentPage = n;
    updatePagePill();
    document.querySelectorAll(".thumb").forEach((t) => {
      t.classList.toggle("is-on", Number(t.dataset.thumb) === n - 1);
    });
  });
  on("style", syncChip);
  on("page-rendered", (index) => {
    if (index === 0 && !thumbDone && docId && state.doc) {
      thumbDone = true;
      const canvas = document.createElement("canvas");
      engine
        .thumbInto(0, canvas, 160)
        .then(() => db.saveThumb(docId, canvas.toDataURL("image/jpeg", 0.72)))
        .catch(() => {});
    }
  });
}

function bindScrollTracking() {
  const scroller = $("pageScroll");
  let queued = false;
  scroller.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        engine.trackCurrent();
      });
    },
    { passive: true }
  );
}

async function route() {
  const params = new URLSearchParams(location.search);
  if (params.get("pending") === "1") {
    try {
      const rec = await db.takePending();
      if (rec?.bytes) {
        await openBytes(rec.bytes, rec.name || "Document", rec.mime || "application/octet-stream");
        return;
      }
    } catch (err) {
      console.error(err);
    }
    showLanding();
    renderRecent();
    return;
  }
  const url = params.get("url");
  if (url) {
    await openUrl(url);
    return;
  }
  const id = params.get("doc");
  if (id) {
    await openStored(id);
    return;
  }
  if (params.get("sample") === "1") {
    await openSample();
    return;
  }
  showLanding();
  renderRecent();
}

async function init() {
  loadPrefs();
  document.body.classList.toggle("night", state.night);
  $("nightCheck").classList.toggle("is-on", state.night);
  bindUI();
  bindEvents();
  bindKeyboard();
  bindDropTarget();
  bindScrollTracking();
  initTools();
  initInspector();
  initSidebar();
  setTool("select", { silent: true });
  updateUndoRedo();
  syncChip();
  await route();
}

init().catch((err) => {
  console.error(err);
  showLanding();
  renderRecent();
});

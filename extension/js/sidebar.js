import { state, emit, on } from "./state.js";
import { engine } from "./engine.js";
import { history } from "./history.js";
import { selectAnn, renderOverlay } from "./annotations.js";
import { confirmDialog, toast } from "./dialogs.js";
import { escapeHtml, debounce } from "./util.js";

const NOTE_TYPES = new Set(["note", "text"]);

function tabButtons() {
  return Array.from(document.querySelectorAll(".side-tab"));
}

function panes() {
  return Array.from(document.querySelectorAll(".side-pane"));
}

function showTab(name) {
  tabButtons().forEach((b) => b.classList.toggle("is-on", b.dataset.tab === name));
  panes().forEach((p) => p.classList.toggle("is-on", p.dataset.pane === name));
}

let thumbObserver = null;
let thumbsBuiltFor = null;
const thumbTasks = new Map();

function scheduleThumb(index) {
  const canvas = document.querySelector(`.thumb[data-thumb="${index}"] canvas`);
  if (!canvas) return;
  if (thumbTasks.has(index)) return;
  const task = Promise.resolve().then(() => {
    thumbTasks.delete(index);
    engine.thumbInto(index, canvas, 78);
  });
  thumbTasks.set(index, task);
}

function renderThumbs(force = false) {
  const root = document.getElementById("thumbs");
  if (!root || !state.doc) return;
  if (!force && thumbsBuiltFor === state.doc) return;
  thumbsBuiltFor = state.doc;
  root.innerHTML = "";
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          scheduleThumb(Number(entry.target.dataset.thumb));
          thumbObserver.unobserve(entry.target);
        }
      }
    },
    { root, rootMargin: "300px" }
  );
  for (let i = 0; i < state.pageCount; i += 1) {
    const frame = document.createElement("button");
    frame.className = "thumb";
    frame.dataset.thumb = String(i);
    frame.innerHTML = `<div class="thumb-frame"><canvas></canvas></div><div class="thumb-meta"><span class="thumb-num">${i + 1}</span><span class="thumb-badge" data-badge="${i}" hidden>0</span></div>`;
    frame.addEventListener("click", () => engine.scrollToPage(i + 1));
    root.append(frame);
    thumbObserver.observe(frame);
  }
  updateThumbBadges();
}

function updateThumbBadges() {
  const counts = new Map();
  for (const ann of state.annotations) {
    counts.set(ann.page, (counts.get(ann.page) || 0) + 1);
  }
  document.querySelectorAll("[data-badge]").forEach((el) => {
    const n = counts.get(Number(el.dataset.badge)) || 0;
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}

function renderNotes() {
  const root = document.getElementById("notesList");
  const countEl = document.getElementById("notesCount");
  if (!root) return;
  const notes = state.annotations.filter((a) => NOTE_TYPES.has(a.type));
  countEl.textContent = notes.length ? String(notes.length) : "";
  if (!notes.length) {
    root.innerHTML = `<div class="notes-empty">No notes yet.<br>Drop a <b>N</b> note on the page to start.</div>`;
    return;
  }
  root.innerHTML = notes
    .map((a) => {
      const body = (a.text || "").trim() || (a.type === "text" ? "(empty text)" : "(empty note)");
      const isNote = a.type === "note";
      return `<button class="note-card${state.selection === a.id ? " is-on" : ""}" data-note-id="${a.id}">
        <span class="note-top">
          <span class="note-kind"><span class="dot" style="background:${a.color}"></span>${isNote ? "Note" : "Text"}</span>
          <span class="note-page">p${a.page + 1}</span>
        </span>
        <span class="note-text">${escapeHtml(body.slice(0, 160))}</span>
      </button>`;
    })
    .join("");
}

function snippetFor(pageIndex, start, len) {
  const text = state.__searchText?.[pageIndex] || "";
  const from = Math.max(0, start - 32);
  const to = Math.min(text.length, start + len + 48);
  const pre = escapeHtml(text.slice(from, start));
  const hit = escapeHtml(text.slice(start, start + len));
  const post = escapeHtml(text.slice(start + len, to));
  return `${from > 0 ? "…" : ""}${pre}<b>${hit}</b>${post}${to < text.length ? "…" : ""}`;
}

async function runSearch(q) {
  const root = document.getElementById("findResults");
  if (!root) return;
  if (!q || q.length < 2) {
    root.innerHTML = `<div class="notes-empty">Type at least 2 characters.<br>Search runs across all page text.</div>`;
    return;
  }
  if (!state.doc) {
    root.innerHTML = `<div class="notes-empty">Open a document first.</div>`;
    return;
  }
  const needle = q.toLowerCase();
  const hits = [];
  if (!state.__searchText) state.__searchText = [];
  for (let i = 0; i < state.pageCount && hits.length < 200; i += 1) {
    let text = state.__searchText[i];
    if (text === undefined) {
      try {
        text = (await state.doc.textContent(i)) || "";
      } catch {
        text = "";
      }
      state.__searchText[i] = text;
    }
    const lower = text.toLowerCase();
    let at = 0;
    while (hits.length < 200) {
      const idx = lower.indexOf(needle, at);
      if (idx < 0) break;
      hits.push({ page: i, start: idx, len: q.length });
      at = idx + needle.length;
    }
  }
  if (!hits.length) {
    root.innerHTML = `<div class="notes-empty">No matches for “${escapeHtml(q)}”.</div>`;
    return;
  }
  root.innerHTML = hits
    .map(
      (h) => `<button class="find-hit" data-page="${h.page}">
        <b>Page ${h.page + 1}</b>
        <span class="find-snippet">${snippetFor(h.page, h.start, h.len)}</span>
      </button>`
    )
    .join("");
}

function bindSidebar() {
  tabButtons().forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  document.getElementById("notesList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-note-id]");
    if (!item) return;
    const ann = state.annotations.find((a) => a.id === item.dataset.noteId);
    if (!ann) return;
    engine.scrollToPage(ann.page + 1);
    selectAnn(ann.id);
    renderOverlay(ann.page);
    if (ann.type === "note") {
      import("./tools.js").then((m) => m.openNoteFor(ann));
    }
  });

  const findInput = document.getElementById("findInput");
  const doSearch = debounce(() => runSearch(findInput.value.trim()), 260);
  findInput.addEventListener("input", doSearch);
  findInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch(findInput.value.trim());
    }
    if (e.key === "Escape") {
      findInput.value = "";
      runSearch("");
      findInput.blur();
    }
  });
  document.getElementById("findResults").addEventListener("click", (e) => {
    const hit = e.target.closest("[data-page]");
    if (!hit) return;
    engine.scrollToPage(Number(hit.dataset.page) + 1);
  });
}

export function focusSearch() {
  showTab("search");
  const findInput = document.getElementById("findInput");
  findInput.focus();
  findInput.select();
}

export function refreshSidebar() {
  updateThumbBadges();
  renderNotes();
}

export function initSidebar() {
  bindSidebar();
  showTab("pages");
  renderThumbs();
  renderNotes();
  on("changed", () => {
    refreshSidebar();
  });
  on("selection", () => {
    renderNotes();
  });
  on("pages-rendered", () => {
    renderThumbs();
    refreshSidebar();
  });
}

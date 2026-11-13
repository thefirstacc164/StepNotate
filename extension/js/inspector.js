import { state, emit, savePrefs, HIGHLIGHT_COLORS, INK_COLORS, NOTE_COLORS, TOOL_LABELS, TOOL_HINTS } from "./state.js";
import { engine } from "./engine.js";
import { history } from "./history.js";
import { removeAnn, annBBox, renderOverlay, textBoxHeight } from "./annotations.js";
import { signaturePad, toast } from "./dialogs.js";
import { formatBytes } from "./util.js";

const INSP = () => document.getElementById("inspector");

function typeLabel(ann) {
  const map = {
    highlight: "Highlight",
    underline: "Underline",
    strike: "Strikethrough",
    ink: "Pen stroke",
    marker: "Marker stroke",
    rect: "Rectangle",
    ellipse: "Ellipse",
    line: "Line",
    arrow: "Arrow",
    text: "Text box",
    note: "Sticky note",
    signature: "Signature",
    stamp: "Stamp",
  };
  return map[ann.type] || ann.type;
}

function swatches(colors, current, attr) {
  return `<div class="insp-row"><label>Color</label><div class="insp-swatches">${colors
    .map((c) => `<button class="color-btn${c === current ? " is-on" : ""}" data-${attr}="${c}" style="background:${c}"></button>`)
    .join("")}</div></div>`;
}

function slider(label, attr, min, max, step, value, suffix = "") {
  return `<div class="insp-row"><label>${label}</label><div class="insp-slider"><input type="range" data-prop="${attr}" min="${min}" max="${max}" step="${step}" value="${value}"><span class="insp-val" data-val="${attr}">${value}${suffix}</span></div></div>`;
}

function numRow(label, attr, min, max, step, value) {
  return `<div class="insp-row"><label>${label}</label><input class="insp-num" type="number" data-prop="${attr}" min="${min}" max="${max}" step="${step}" value="${Math.round(value * 10) / 10}"></div>`;
}

function forToolDefaults() {
  const t = state.tool;
  const label = TOOL_LABELS[t] || t;
  let html = `<div class="insp-card"><div class="insp-card-title">${label}</div><div class="insp-hint">${TOOL_HINTS[t] || ""}</div>`;
  if (["highlight"].includes(t)) {
    html += swatches(HIGHLIGHT_COLORS, state.style.highlight, "style-highlight");
    html += slider("Opacity", "style-highlightOpacity", 0.1, 1, 0.02, Math.round(state.style.highlightOpacity * 100) / 100);
  } else if (["pen", "marker", "rect", "ellipse", "line", "arrow"].includes(t)) {
    html += swatches(INK_COLORS, state.style.ink, "style-ink");
    html += slider("Stroke", "style-stroke", 1, 16, 0.5, state.style.stroke, "px");
    html += slider("Opacity", "style-opacity", 0.1, 1, 0.02, Math.round(state.style.opacity * 100) / 100);
    if (["rect", "ellipse"].includes(t)) {
      html += `<div class="insp-row"><label>Fill</label><button class="toggle${state.style.fill ? " is-on" : ""}" data-toggle="style-fill"><span></span></button></div>`;
    }
  } else if (t === "text") {
    html += swatches(INK_COLORS, state.style.ink, "style-ink");
    html += `<div class="insp-row"><label>Size</label><input class="insp-num" type="number" data-prop="style-fontSize" min="6" max="72" step="1" value="${state.style.fontSize}"></div>`;
    html += `<div class="insp-row"><label>Format</label><div class="insp-format"><button class="toggle${state.style.bold ? " is-on" : ""}" data-toggle="style-bold" title="Bold"><b>B</b></button><button class="toggle${state.style.italic ? " is-on" : ""}" data-toggle="style-italic" title="Italic"><i>I</i></button></div></div>`;
  } else if (t === "note") {
    html += swatches(NOTE_COLORS, state.style.note, "style-note");
  } else if (t === "signature") {
    html += `<div class="insp-hint">Click on the page to place your signature. Draw it first if you haven't.</div><button class="btn btn-ghost insp-wide" data-act="redraw-sig">Redraw signature</button>`;
  } else if (t === "stamp") {
    html += `<div class="insp-hint">Click on the page, then pick an image file to stamp.</div>`;
  } else if (t === "eraser") {
    html += `<div class="insp-hint">Click or drag over pen or marker strokes to erase them. Text and shapes stay put.</div>`;
  } else if (t === "select") {
    html += `<div class="insp-hint">Click an annotation to edit it. Drag to move, use the corner handles to resize, double-click text or notes to rewrite.</div>`;
  }
  html += `</div>`;
  const doc = state.doc;
  if (doc) {
    html += `<div class="insp-card"><div class="insp-card-title">Document</div>
      <div class="insp-kv"><span>Name</span><b>${escapeHtml(doc.name)}</b></div>
      <div class="insp-kv"><span>Pages</span><b>${state.pageCount}</b></div>
      <div class="insp-kv"><span>Size</span><b>${formatBytes(doc.bytes?.byteLength || 0)}</b></div>
      <div class="insp-kv"><span>Marks</span><b>${state.annotations.length}</b></div>
    </div>`;
  }
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function forSelection(ann) {
  const box = annBBox(ann);
  let html = `<div class="insp-card"><div class="insp-card-title">${typeLabel(ann)}</div>`;
  if (["highlight", "underline", "strike", "ink", "marker", "rect", "ellipse", "line", "arrow", "text", "note"].includes(ann.type)) {
    const palette = ann.type === "highlight" ? HIGHLIGHT_COLORS : ann.type === "note" ? NOTE_COLORS : INK_COLORS;
    const cur = ann.color;
    html += swatches(palette, cur, "ann-color");
  }
  if (["highlight", "ink", "marker", "rect", "ellipse", "line", "arrow"].includes(ann.type)) {
    html += slider("Opacity", "ann-opacity", 0.05, 1, 0.02, Math.round((ann.opacity ?? 1) * 100) / 100);
  }
  if (["ink", "marker", "rect", "ellipse", "line", "arrow"].includes(ann.type)) {
    html += slider("Stroke", "ann-width", 0.5, 40, 0.5, ann.width, "px");
  }
  if (["rect", "ellipse"].includes(ann.type)) {
    html += `<div class="insp-row"><label>Fill</label><button class="toggle${ann.fill ? " is-on" : ""}" data-toggle="ann-fill"><span></span></button></div>`;
  }
  if (ann.type === "text") {
    html += `<div class="insp-row"><label>Size</label><input class="insp-num" type="number" data-prop="ann-fontSize" min="6" max="72" step="1" value="${ann.fontSize}"></div>`;
    html += `<div class="insp-row"><label>Format</label><div class="insp-format"><button class="toggle${ann.bold ? " is-on" : ""}" data-toggle="ann-bold" title="Bold"><b>B</b></button><button class="toggle${ann.italic ? " is-on" : ""}" data-toggle="ann-italic" title="Italic"><i>I</i></button></div></div>`;
    html += `<div class="insp-row"><label>Text</label><textarea class="insp-text" data-prop="ann-text" rows="3">${escapeHtml(ann.text)}</textarea></div>`;
  }
  if (ann.type === "note") {
    html += `<div class="insp-row"><label>Note</label><textarea class="insp-text" data-prop="ann-text" rows="4">${escapeHtml(ann.text || "")}</textarea></div>`;
  }
  if (ann.type === "signature" || ann.type === "stamp") {
    html += numRow("Width", "ann-w", 10, 2000, 5, ann.w);
  }
  html += `<div class="insp-kv"><span>Page</span><b>${ann.page + 1}</b></div>
    <div class="insp-kv"><span>Position</span><b>${Math.round(box.x)}, ${Math.round(box.y)}</b></div>
    <div class="insp-kv"><span>Size</span><b>${Math.round(box.w)} × ${Math.round(box.h)}</b></div>
    <div class="insp-actions">
      <button class="btn btn-ghost" data-act="duplicate">Duplicate</button>
      <button class="btn btn-ghost btn-danger" data-act="delete">Delete</button>
    </div></div>`;
  return html;
}

function currentAnn() {
  if (!state.selection) return null;
  return state.annotations.find((a) => a.id === state.selection) || null;
}

let pendingBefore = null;

function ensureBefore() {
  if (!pendingBefore) pendingBefore = history.begin();
}

function commitBefore() {
  if (!pendingBefore) return;
  history.commit(pendingBefore);
  pendingBefore = null;
}

export function refreshInspector() {
  const root = INSP();
  if (!root) return;
  const ann = currentAnn();
  document.getElementById("inspTitle").textContent = ann ? typeLabel(ann) : "Properties";
  document.getElementById("inspBody").innerHTML = ann ? forSelection(ann) : forToolDefaults();
}

function setProp(path, value) {
  const ann = currentAnn();
  if (path.startsWith("style-")) {
    const key = path.slice(6);
    state.style[key] = value;
    savePrefs();
    if (key === "highlight" || key === "ink" || key === "note") {
      document.getElementById("chipSwatch").style.background = value;
    }
    emit("style");
    return;
  }
  if (!ann) return;
  ensureBefore();
  const key = path.slice(4);
  if (key === "w") {
    const aspect = ann.h / ann.w || 0.4;
    ann.w = value;
    ann.h = value * aspect;
  } else {
    ann[key] = value;
  }
  if (ann.type === "text" && ["fontSize", "text", "bold", "italic"].includes(key)) {
    ann.h = textBoxHeight(ann);
    renderOverlay(ann.page);
  }
  renderOverlay(ann.page);
  emit("changed-light");
}

function bindInspector() {
  const root = INSP();
  root.addEventListener("click", (e) => {
    const colorBtn = e.target.closest("[data-ann-color],[data-style-highlight],[data-style-ink],[data-style-note]");
    if (colorBtn) {
      const ann = currentAnn();
      if (colorBtn.dataset.annColor) {
        ensureBefore();
        ann.color = colorBtn.dataset.annColor;
        commitBefore();
        renderOverlay(ann.page);
        emit("changed");
      } else if (colorBtn.dataset.styleHighlight) {
        state.style.highlight = colorBtn.dataset.styleHighlight;
        savePrefs();
        emit("style");
      } else if (colorBtn.dataset.styleInk) {
        state.style.ink = colorBtn.dataset.styleInk;
        savePrefs();
        emit("style");
      } else if (colorBtn.dataset.styleNote) {
        state.style.note = colorBtn.dataset.styleNote;
        savePrefs();
        emit("style");
      }
      document.getElementById("chipSwatch").style.background = state.style.highlight;
      refreshInspector();
      return;
    }
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const path = toggle.dataset.toggle;
      if (path.startsWith("style-")) {
        const key = path.slice(6);
        state.style[key] = !state.style[key];
        savePrefs();
        emit("style");
        refreshInspector();
      } else {
        const ann = currentAnn();
        if (!ann) return;
        ensureBefore();
        const key = path.slice(4);
        ann[key] = !ann[key];
        if (ann.type === "text") {
          ann.h = textBoxHeight(ann);
          renderOverlay(ann.page);
        }
        commitBefore();
        renderOverlay(ann.page);
        emit("changed");
      }
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      if (act.dataset.act === "delete") {
        const ann = currentAnn();
        if (ann) {
          history.push();
          removeAnn(ann.id);
        }
      } else if (act.dataset.act === "duplicate") {
        const ann = currentAnn();
        if (ann) {
          history.push();
          const copy = JSON.parse(JSON.stringify(ann));
          copy.id = `an_${Math.random().toString(36).slice(2, 10)}`;
          copy.page = ann.page;
          if (copy.rects) {
            for (const r of copy.rects) {
              r.x += 14;
              r.y -= 14;
            }
          } else if (copy.points) {
            for (let i = 0; i < copy.points.length; i += 2) {
              copy.points[i] += 14;
              copy.points[i + 1] -= 14;
            }
          } else if (copy.type === "line" || copy.type === "arrow") {
            copy.x += 14;
            copy.y -= 14;
            copy.x2 += 14;
            copy.y2 -= 14;
          } else {
            copy.x += 14;
            copy.y -= 14;
          }
          state.annotations.push(copy);
          state.selection = copy.id;
          emit("changed");
          emit("selection");
        }
      } else if (act.dataset.act === "redraw-sig") {
        localStorage.removeItem("stepnotate.sig");
        signaturePad().then((url) => {
          if (url) {
            localStorage.setItem("stepnotate.sig", url);
            toast("Signature saved — click the page to place it", "ok");
          }
        });
      }
    }
  });

  root.addEventListener("input", (e) => {
    const input = e.target.closest("[data-prop]");
    if (!input) return;
    const path = input.dataset.prop;
    const val = input.type === "range" || input.type === "number" ? parseFloat(input.value) : input.value;
    if (input.type === "range") {
      const label = root.querySelector(`[data-val="${path}"]`);
      if (label) label.textContent = `${val}${path.includes("stroke") || path.includes("width") ? "px" : ""}`;
    }
    setProp(path, val);
  });

  root.addEventListener("change", (e) => {
    if (e.target.closest("[data-prop]")) {
      commitBefore();
      refreshInspector();
    }
  });

  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-prop]")) ensureBefore();
  });
}

export function initInspector() {
  bindInspector();
  refreshInspector();
}

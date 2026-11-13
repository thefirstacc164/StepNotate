import { state, emit, NOTE_COLORS } from "./state.js";
import { engine } from "./engine.js";
import { history } from "./history.js";
import {
  newAnn,
  hitTest,
  handleAt,
  selectAnn,
  translateAnn,
  applyResize,
  renderOverlay,
  textBoxHeight,
} from "./annotations.js";
import { signaturePad } from "./dialogs.js";
import { clamp } from "./util.js";

const TEXT_MARK_TOOLS = new Set(["highlight", "underline", "strike"]);

let pagesRoot = null;
let gesture = null;
let selBar = null;
let editingAnn = null;
let notePop = null;
let pendingStamp = null;
let pendingSigPoint = null;

function localPoint(index, ev) {
  const el = engine.pages[index]?.el;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function pageCoords(index, ev) {
  const local = localPoint(index, ev);
  if (!local) return null;
  return engine.toPage(index, local.x, local.y);
}

function rectsToPage(rects, pageIndex) {
  const el = engine.pages[pageIndex]?.el;
  if (!el) return [];
  const pr = el.getBoundingClientRect();
  const out = [];
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue;
    const a = engine.toPage(pageIndex, rect.left - pr.left, rect.top - pr.top);
    const b = engine.toPage(pageIndex, rect.right - pr.left, rect.bottom - pr.top);
    out.push({
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      w: Math.abs(b[0] - a[0]),
      h: Math.abs(b[1] - a[1]),
    });
  }
  return out;
}

function selectionRectsByPage() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const client = Array.from(range.getClientRects());
  const byPage = new Map();
  for (const rect of client) {
    for (let i = 0; i < engine.pages.length; i += 1) {
      const el = engine.pages[i].el;
      const pr = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
        if (!byPage.has(i)) byPage.set(i, []);
        byPage.get(i).push(rect);
        break;
      }
    }
  }
  if (!byPage.size) return null;
  return byPage;
}

function markFromSelection(type) {
  const byPage = selectionRectsByPage();
  if (!byPage) return false;
  const before = history.begin();
  let count = 0;
  for (const [pageIndex, rects] of byPage) {
    const pageRects = rectsToPage(rects, pageIndex);
    if (!pageRects.length) continue;
    state.annotations.push(
      newAnn(pageIndex, {
        type,
        rects: pageRects,
        color: type === "highlight" ? state.style.highlight : state.style.ink,
        opacity: type === "highlight" ? state.style.highlightOpacity : 1,
      })
    );
    count += 1;
  }
  if (!count) {
    history.discard();
    return false;
  }
  window.getSelection()?.removeAllRanges();
  hideSelBar();
  history.commit(before);
  emit("changed");
  return true;
}

function showSelBar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || state.tool !== "select") {
    hideSelBar();
    return;
  }
  const rect = sel.getRangeAt(0).boundingClientRect;
  if (!rect || (!rect.width && !rect.height)) {
    hideSelBar();
    return;
  }
  if (!selBar) {
    selBar = document.createElement("div");
    selBar.className = "text-sel-bar";
    selBar.innerHTML = `<button data-mark="highlight" title="Highlight selection"><span class="tsb-chip" data-chip="highlight"></span>Highlight</button><button data-mark="underline" title="Underline selection"><svg class="ic"><use href="#i-underline"></use></svg></button><button data-mark="strike" title="Strikethrough selection"><svg class="ic"><use href="#i-strike"></use></svg></button>`;
    selBar.addEventListener("pointerdown", (e) => e.preventDefault());
    selBar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mark]");
      if (!btn) return;
      const type = btn.dataset.mark;
      state.style.textMark = type;
      markFromSelection(type);
    });
    document.body.append(selBar);
  }
  const chip = selBar.querySelector('[data-chip="highlight"]');
  if (chip) chip.style.background = state.style.highlight;
  selBar.style.display = "flex";
  const top = Math.max(8, rect.top - 44);
  const left = clamp(rect.left + rect.width / 2 - 70, 8, window.innerWidth - 160);
  selBar.style.top = `${top}px`;
  selBar.style.left = `${left}px`;
}

function hideSelBar() {
  if (selBar) selBar.style.display = "none";
}

function closeEditor(commit) {
  if (!editingAnn) return;
  const ann = editingAnn;
  editingAnn = null;
  state.editing = false;
  const editor = pagesRoot.querySelector(".text-editor");
  if (editor) editor.remove();
  if (commit && !ann.text.trim()) {
    const i = state.annotations.indexOf(ann);
    if (i >= 0) state.annotations.splice(i, 1);
    history.commit();
  } else if (commit) {
    history.commit();
  } else {
    history.rollback();
  }
  renderOverlay(ann.page);
  emit("changed");
}

function openTextEditor(ann) {
  closeEditor(true);
  editingAnn = ann;
  state.editing = true;
  if (!history.pending) history.begin();
  const pageEl = engine.pages[ann.page]?.el;
  if (!pageEl) return;
  const vp = engine.viewport(ann.page);
  const tl = vp.convertToViewportPoint(ann.x, ann.y + ann.h);
  const ta = document.createElement("textarea");
  ta.className = "text-editor";
  ta.value = ann.text;
  ta.style.left = `${tl[0]}px`;
  ta.style.top = `${tl[1]}px`;
  ta.style.width = `${Math.max(ann.w * vp.scale, 60)}px`;
  ta.style.minHeight = `${ann.h * vp.scale}px`;
  ta.style.fontSize = `${ann.fontSize * vp.scale}px`;
  ta.style.fontFamily = ann.font;
  ta.style.fontWeight = ann.bold ? "600" : "400";
  ta.style.fontStyle = ann.italic ? "italic" : "normal";
  ta.style.color = ann.color;
  if (ann.fill) ta.style.background = `${ann.color}24`;
  if (vp.rotation) ta.style.transform = `rotate(${vp.rotation}deg)`;
  ta.style.transformOrigin = "0 0";
  ta.addEventListener("input", () => {
    ann.text = ta.value;
    ann.h = textBoxHeight(ann);
    const tl2 = engine.viewport(ann.page).convertToViewportPoint(ann.x, ann.y + ann.h);
    ta.style.top = `${tl2[1]}px`;
    ta.style.minHeight = `${ann.h * engine.viewport(ann.page).scale}px`;
    renderOverlay(ann.page);
  });
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      closeEditor(true);
    }
  });
  ta.addEventListener("blur", () => closeEditor(true));
  pageEl.append(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function openNotePop(ann) {
  closeNotePop(true);
  editingNote = ann;
  const pageEl = engine.pages[ann.page]?.el;
  if (!pageEl) return;
  if (!history.pending) history.begin();
  notePop = document.createElement("div");
  notePop.className = "note-pop";
  notePop.innerHTML = `
    <div class="note-pop-head"><span>Note</span></div>
    <textarea placeholder="Write a note…"></textarea>
    <div class="note-pop-colors">${NOTE_COLORS.map((c) => `<button class="color-btn${c === ann.color ? " is-on" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>
    <div class="note-pop-foot">
      <button class="btn-quiet" data-note="delete">Delete</button>
      <button class="btn btn-primary" data-note="done">Done</button>
    </div>`;
  const ta = notePop.querySelector("textarea");
  ta.value = ann.text || "";
  document.body.append(notePop);
  positionNotePop(ann);
  ta.focus();
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeNotePop(false);
    }
  });
  ta.addEventListener("input", () => {
    ann.text = ta.value;
    renderOverlay(ann.page);
  });
  notePop.addEventListener("click", (e) => {
    const colorBtn = e.target.closest("[data-color]");
    if (colorBtn) {
      ann.color = colorBtn.dataset.color;
      notePop.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("is-on", b === colorBtn));
      renderOverlay(ann.page);
      return;
    }
    const act = e.target.closest("[data-note]");
    if (!act) return;
    if (act.dataset.note === "delete") {
      const i = state.annotations.indexOf(ann);
      if (i >= 0) state.annotations.splice(i, 1);
      closeNotePop(true);
      state.selection = null;
      emit("changed");
    } else {
      closeNotePop(true);
    }
  });
}

function positionNotePop(ann) {
  if (!notePop) return;
  const pageEl = engine.pages[ann.page]?.el;
  if (!pageEl) return;
  const vp = engine.viewport(ann.page);
  const p = vp.convertToViewportPoint(ann.x + 28, ann.y + 26);
  const pr = pageEl.getBoundingClientRect();
  let left = pr.left + p[0] + 8;
  let top = pr.top + p[1] - 8;
  const w = 280;
  const h = notePop.offsetHeight || 220;
  if (left + w > window.innerWidth - 12) left = pr.left + p[0] - w - 34;
  if (top + h > window.innerHeight - 12) top = window.innerHeight - h - 12;
  if (top < 12) top = 12;
  notePop.style.left = `${left}px`;
  notePop.style.top = `${top}px`;
}

function closeNotePop(commit) {
  if (!notePop) return;
  const ann = editingNote;
  notePop.remove();
  notePop = null;
  editingNote = null;
  if (!ann) return;
  if (commit && !(ann.text || "").trim()) {
    const i = state.annotations.indexOf(ann);
    if (i >= 0) state.annotations.splice(i, 1);
  }
  if (commit) history.commit();
  else history.rollback();
  emit("changed");
}

let editingNote = null;

export function finishEditing() {
  closeEditor(true);
  if (notePop) closeNotePop(true);
}

export function openNoteFor(ann) {
  openNotePop(ann);
}

export function isEditing() {
  return !!editingAnn || !!notePop;
}

function snapAngle(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const a = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(a / step) * step;
  const len = Math.hypot(dx, dy);
  return [x0 + len * Math.cos(snapped), y0 + len * Math.sin(snapped)];
}

function startStroke(index, ev, type) {
  const p = pageCoords(index, ev);
  if (!p) return;
  history.begin();
  const ann = newAnn(index, {
    type,
    points: [p[0], p[1]],
    color: state.style.ink,
    width: type === "marker" ? state.style.stroke * 3.4 : state.style.stroke,
    opacity: type === "marker" ? 0.34 : state.style.opacity,
  });
  state.annotations.push(ann);
  gesture = { kind: "stroke", index, ann, shift: ev.shiftKey };
}

function startShape(index, ev, type) {
  const p = pageCoords(index, ev);
  if (!p) return;
  history.begin();
  const ann = newAnn(index, {
    type,
    x: p[0],
    y: p[1],
    w: 0,
    h: 0,
    x2: p[0],
    y2: p[1],
    color: state.style.ink,
    width: state.style.stroke,
    opacity: state.style.opacity,
    fill: state.style.fill,
  });
  state.annotations.push(ann);
  gesture = { kind: "shape", index, ann, ox: p[0], oy: p[1], shift: ev.shiftKey };
}

function placeImage(index, ev, src, aspect, type) {
  const p = pageCoords(index, ev);
  if (!p) return;
  history.begin();
  const w = 130;
  const h = w / aspect;
  state.annotations.push(
    newAnn(index, {
      type,
      src,
      x: p[0] - w / 2,
      y: p[1] - h / 2,
      w,
      h,
      color: state.style.ink,
      opacity: 1,
      width: state.style.stroke,
    })
  );
  history.commit();
  selectAnn(state.annotations[state.annotations.length - 1].id);
  emit("changed");
}

function startTool(index, ev, tool) {
  const p = pageCoords(index, ev);
  if (!p) return;
  if (tool === "pen" || tool === "marker") {
    startStroke(index, ev, tool);
    return;
  }
  if (["rect", "ellipse", "line", "arrow"].includes(tool)) {
    startShape(index, ev, tool);
    return;
  }
  if (tool === "eraser") {
    history.begin();
    gesture = { kind: "erase", index, removed: false };
    eraseAt(index, ev);
    return;
  }
  if (tool === "text") {
    history.begin();
    const fontSize = state.style.fontSize;
    const h = fontSize * 1.4;
    const ann = newAnn(index, {
      type: "text",
      x: p[0],
      y: p[1] - h,
      w: 210,
      h,
      text: "",
      fontSize,
      font: state.style.font,
      bold: state.style.bold,
      italic: state.style.italic,
      color: state.style.ink,
      fill: false,
      opacity: 1,
      width: state.style.stroke,
    });
    state.annotations.push(ann);
    renderOverlay(index);
    openTextEditor(ann);
    return;
  }
  if (tool === "note") {
    history.begin();
    const ann = newAnn(index, {
      type: "note",
      x: p[0] - 13,
      y: p[1] - 13,
      text: "",
      color: state.style.note,
      opacity: 1,
      width: state.style.stroke,
    });
    state.annotations.push(ann);
    openNotePop(ann);
    renderOverlay(index);
    emit("changed");
    return;
  }
  if (tool === "signature") {
    const saved = localStorage.getItem("stepnotate.sig");
    if (saved) {
      placeImage(index, ev, saved, 1000 / 360, "signature");
    } else {
      pendingSigPoint = { index, ev: { clientX: ev.clientX, clientY: ev.clientY } };
      signaturePad().then((dataUrl) => {
        if (dataUrl) {
          localStorage.setItem("stepnotate.sig", dataUrl);
          const fake = { clientX: pendingSigPoint.ev.clientX, clientY: pendingSigPoint.ev.clientY };
          placeImage(pendingSigPoint.index, fake, dataUrl, 1000 / 360, "signature");
        }
        pendingSigPoint = null;
      });
    }
    return;
  }
  if (tool === "stamp") {
    pendingStamp = { index, clientX: ev.clientX, clientY: ev.clientY };
    const input = document.getElementById("stampInput");
    input.value = "";
    input.click();
  }
}

export function placeStampFromInput(dataUrl, aspect) {
  if (!pendingStamp) return;
  const { index, clientX, clientY } = pendingStamp;
  pendingStamp = null;
  placeImage(index, { clientX, clientY }, dataUrl, aspect, "stamp");
}

function eraseAt(index, ev) {
  const p = pageCoords(index, ev);
  if (!p) return;
  const vp = engine.viewport(index);
  const tol = 8 / vp.scale;
  for (let i = state.annotations.length - 1; i >= 0; i -= 1) {
    const ann = state.annotations[i];
    if (ann.page !== index) continue;
    if (!["ink", "marker"].includes(ann.type)) continue;
    const half = ann.width / 2 + tol;
    let hit = false;
    if (ann.points.length === 2) {
      hit = Math.hypot(p[0] - ann.points[0], p[1] - ann.points[1]) <= half;
    } else {
      for (let j = 0; j < ann.points.length - 2; j += 2) {
        const d = distSeg(p[0], p[1], ann.points[j], ann.points[j + 1], ann.points[j + 2], ann.points[j + 3]);
        if (d <= half) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      state.annotations.splice(i, 1);
      if (state.selection === ann.id) state.selection = null;
      gesture.removed = true;
      renderOverlay(index);
      return;
    }
  }
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pageIndexFrom(ev) {
  const info = engine.pageFromEvent(ev);
  return info ? info.index : -1;
}

function onPointerDown(ev) {
  if (ev.button !== 0) return;
  if (state.editing && editingAnn) {
    const editor = pagesRoot.querySelector(".text-editor");
    if (editor && editor.contains(ev.target)) return;
    closeEditor(true);
  }
  if (notePop && !notePop.contains(ev.target)) closeNotePop(true);
  const index = pageIndexFrom(ev);
  if (index < 0) {
    if (state.selection) selectAnn(null);
    return;
  }
  const tool = state.tool;
  if (TEXT_MARK_TOOLS.has(tool)) return;
  if (tool === "select") {
    const info = engine.pageFromEvent(ev);
    const hit = handleAt(index, info.x, info.y);
    if (hit) {
      history.begin();
      gesture = { kind: "resize", index, ann: hit.ann, handle: hit.handle };
      selectAnn(hit.ann.id);
      ev.preventDefault();
      return;
    }
    const p = engine.toPage(index, info.x, info.y);
    const ann = hitTest(index, p[0], p[1]);
    if (ann) {
      history.begin();
      selectAnn(ann.id);
      gesture = { kind: "move", index, ann, ox: p[0], oy: p[1], moved: false };
      ev.preventDefault();
      return;
    }
    selectAnn(null);
    return;
  }
  ev.preventDefault();
  startTool(index, ev, tool);
}

function onPointerMove(ev) {
  if (!gesture) return;
  if (gesture.kind === "stroke") {
    const p = pageCoords(gesture.index, ev);
    if (!p) return;
    const pts = gesture.ann.points;
    if (gesture.shift && pts.length >= 2) {
      const [sx, sy] = [pts[0], pts[1]];
      const [ex, ey] = snapAngle(sx, sy, p[0], p[1]);
      pts.length = 2;
      pts.push(ex, ey);
    } else {
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (Math.hypot(p[0] - lx, p[1] - ly) * engine.viewport(gesture.index).scale < 1.6) return;
      pts.push(p[0], p[1]);
    }
    renderOverlay(gesture.index);
    return;
  }
  if (gesture.kind === "shape") {
    const p = pageCoords(gesture.index, ev);
    if (!p) return;
    const a = gesture.ann;
    let ex = p[0];
    let ey = p[1];
    if (gesture.shift) {
      if (a.type === "rect" || a.type === "ellipse") {
        const d = Math.max(Math.abs(ex - gesture.ox), Math.abs(ey - gesture.oy));
        ex = gesture.ox + (ex >= gesture.ox ? d : -d);
        ey = gesture.oy + (ey >= gesture.oy ? d : -d);
      } else {
        [ex, ey] = snapAngle(gesture.ox, gesture.oy, ex, ey);
      }
    }
    if (a.type === "rect" || a.type === "ellipse") {
      a.x = Math.min(gesture.ox, ex);
      a.y = Math.min(gesture.oy, ey);
      a.w = Math.abs(ex - gesture.ox);
      a.h = Math.abs(ey - gesture.oy);
    } else {
      a.x2 = ex;
      a.y2 = ey;
    }
    renderOverlay(gesture.index);
    return;
  }
  if (gesture.kind === "erase") {
    eraseAt(gesture.index, ev);
    return;
  }
  if (gesture.kind === "move") {
    const p = pageCoords(gesture.index, ev);
    if (!p) return;
    const dx = p[0] - gesture.ox;
    const dy = p[1] - gesture.oy;
    if (!gesture.moved && Math.hypot(dx, dy) * engine.viewport(gesture.index).scale < 2) return;
    gesture.moved = true;
    translateAnn(gesture.ann, dx, dy);
    gesture.ox = p[0];
    gesture.oy = p[1];
    renderOverlay(gesture.index);
    if (notePop) positionNotePop(gesture.ann);
    return;
  }
  if (gesture.kind === "resize") {
    const p = pageCoords(gesture.index, ev);
    if (!p) return;
    applyResize(gesture.ann, gesture.handle, p[0], p[1]);
    renderOverlay(gesture.index);
  }
}

function onPointerUp() {
  if (!gesture) {
    if (state.tool && TEXT_MARK_TOOLS.has(state.tool)) {
      setTimeout(() => markFromSelection(state.tool), 0);
    }
    return;
  }
  const g = gesture;
  gesture = null;
  if (g.kind === "stroke") {
    const pts = g.ann.points;
    if (pts.length < 4) {
      const i = state.annotations.indexOf(g.ann);
      if (i >= 0) state.annotations.splice(i, 1);
      history.rollback();
      renderOverlay(g.index);
      return;
    }
    history.commit();
    emit("changed");
    return;
  }
  if (g.kind === "shape") {
    const a = g.ann;
    const tiny = a.type === "rect" || a.type === "ellipse" ? a.w < 3 || a.h < 3 : Math.hypot(a.x2 - a.x, a.y2 - a.y) < 4;
    if (tiny) {
      const i = state.annotations.indexOf(a);
      if (i >= 0) state.annotations.splice(i, 1);
      history.rollback();
      renderOverlay(g.index);
      return;
    }
    history.commit();
    emit("changed");
    return;
  }
  if (g.kind === "erase") {
    if (g.removed) {
      history.commit();
      emit("changed");
    } else {
      history.discard();
    }
    return;
  }
  if (g.kind === "move") {
    if (g.moved) {
      history.commit();
      emit("changed");
    } else {
      history.discard();
    }
    return;
  }
  if (g.kind === "resize") {
    history.commit();
    emit("changed");
  }
}

function onDblClick(ev) {
  const index = pageIndexFrom(ev);
  if (index < 0) return;
  const local = localPoint(index, ev);
  if (!local) return;
  const p = engine.toPage(index, local.x, local.y);
  const ann = hitTest(index, p[0], p[1]);
  if (!ann) return;
  if (ann.type === "text") {
    selectAnn(ann.id);
    openTextEditor(ann);
  } else if (ann.type === "note") {
    selectAnn(ann.id);
    openNotePop(ann);
  }
}

function onKeyUp(ev) {
  if (gesture && (ev.key === "Shift")) {
    if (gesture.kind === "stroke" || gesture.kind === "shape") {
      gesture.shift = ev.shiftKey;
    }
  }
}

function onKeyDownShift(ev) {
  if (gesture && ev.key === "Shift") {
    if (gesture.kind === "stroke" || gesture.kind === "shape") gesture.shift = ev.shiftKey;
  }
}

export function initTools() {
  pagesRoot = document.getElementById("pages");
  pagesRoot.addEventListener("pointerdown", onPointerDown);
  pagesRoot.addEventListener("dblclick", onDblClick);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDownShift);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("selectionchange", () => {
    if (state.tool !== "select") return;
    clearTimeout(document.__selBarTimer);
    document.__selBarTimer = setTimeout(() => {
      if (state.tool === "select" && !state.editing) showSelBar();
      else hideSelBar();
    }, 120);
  });
  window.addEventListener("scroll", hideSelBar, true);
  const stampInput = document.getElementById("stampInput");
  stampInput.addEventListener("change", () => {
    const file = stampInput.files?.[0];
    if (!file || !pendingStamp) {
      pendingStamp = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => placeStampFromInput(reader.result, img.naturalWidth / img.naturalHeight || 1);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function refreshSelBar() {
  if (selBar && selBar.style.display !== "none") showSelBar();
}

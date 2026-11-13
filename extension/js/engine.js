import { BASE_SCALE, createViewport } from "./loader.js";
import { state, emit } from "./state.js";

const engine = {
  doc: null,
  container: null,
  scroll: null,
  pages: [],
  tasks: new Map(),
  textLayers: new Map(),
  observer: null,
  current: 1,
};

function totalRotation(index) {
  const base = engine.doc.meta(index).rotation || 0;
  return (((base + state.rotation) % 360) + 360) % 360;
}

function docScale() {
  return engine.doc.kind === "pdf" ? state.zoom * BASE_SCALE : state.zoom;
}

engine.viewport = function (index) {
  const meta = engine.doc.meta(index);
  const scale = docScale();
  const rotation = totalRotation(index);
  if (engine.doc.kind === "pdf") {
    const page = engine.doc.pageCache.get(index);
    if (page) return page.getViewport({ scale, rotation });
  }
  return createViewport(meta.width, meta.height, scale, rotation);
};

engine.toPage = function (index, cssX, cssY) {
  return engine.viewport(index).convertToPdfPoint(cssX, cssY);
};

engine.toCss = function (index, x, y) {
  return engine.viewport(index).convertToViewportPoint(x, y);
};

function pageStructure(index) {
  const el = document.createElement("div");
  el.className = "page";
  el.dataset.index = String(index);
  el.innerHTML =
    '<div class="page-surface">' +
    '<div class="page-placeholder"></div>' +
    '<canvas class="page-canvas" hidden></canvas>' +
    '<div class="text-layer"></div>' +
    '<svg class="ink-layer" xmlns="http://www.w3.org/2000/svg"></svg>' +
    "</div>";
  return el;
}

engine.build = function (container, scroll, doc) {
  engine.destroy();
  engine.container = container;
  engine.scroll = scroll;
  engine.doc = doc;
  engine.current = 1;
  container.replaceChildren();
  engine.pages = [];
  for (let i = 0; i < doc.pageCount; i += 1) {
    const el = pageStructure(i);
    container.append(el);
    engine.pages.push({
      el,
      canvas: el.querySelector(".page-canvas"),
      placeholder: el.querySelector(".page-placeholder"),
      textEl: el.querySelector(".text-layer"),
      svg: el.querySelector(".ink-layer"),
      rendered: false,
      textMounted: false,
      vp: null,
    });
  }
  engine.relayout();
  engine.observe();
  return engine;
};

const TOOL_CLASSES = [
  "select",
  "pen",
  "marker",
  "eraser",
  "note",
  "text",
  "is-shape",
];

engine.setToolClass = function (tool) {
  const textTools = new Set(["select", "highlight", "underline", "strike"]);
  const shapeTools = ["rect", "ellipse", "line", "arrow"];
  for (const page of engine.pages) {
    let cls = "page";
    if (textTools.has(tool)) cls += " as-text-tool";
    if (tool === "select") cls += " is-select";
    else if (tool === "pen") cls += " is-pen";
    else if (tool === "marker") cls += " is-marker";
    else if (tool === "eraser") cls += " is-eraser";
    else if (tool === "note") cls += " is-note";
    else if (tool === "text") cls += " is-text";
    else if (tool === "stamp") cls += " is-stamp";
    else if (tool === "signature") cls += " is-signature";
    else if (shapeTools.includes(tool)) cls += " is-shape";
    page.el.className = cls;
  }
  void TOOL_CLASSES;
};

engine.relayout = function () {
  for (let i = 0; i < engine.pages.length; i += 1) {
    const page = engine.pages[i];
    const vp = engine.viewport(i);
    page.vp = vp;
    page.el.style.width = `${Math.floor(vp.width)}px`;
    page.el.style.height = `${Math.floor(vp.height)}px`;
    page.el.style.setProperty("--scale-factor", String(vp.scale));
    page.textEl.style.setProperty("--scale-factor", String(vp.scale));
    page.textEl.setAttribute("data-main-rotation", String(totalRotation(i)));
    if (page.rendered && page.renderedKey !== viewKey(i)) {
      page.rendered = false;
    }
  }
};

function viewKey(index) {
  const vp = engine.viewport(index);
  return `${vp.scale}|${vp.rotation}`;
}

engine.renderNear = async function () {
  const rect = engine.scroll.getBoundingClientRect();
  const pad = Math.max(rect.height, 900);
  const jobs = [];
  for (let i = 0; i < engine.pages.length; i += 1) {
    const page = engine.pages[i];
    const box = page.el.getBoundingClientRect();
    if (box.bottom > rect.top - pad && box.top < rect.bottom + pad) {
      jobs.push(engine.renderPage(i));
      if (engine.doc.kind === "pdf") jobs.push(engine.mountTextLayer(i));
    }
  }
  await Promise.allSettled(jobs);
  emit("pages-rendered");
};

engine.renderPage = async function (index) {
  const page = engine.pages[index];
  if (!page) return;
  const key = viewKey(index);
  if (page.rendered && page.renderedKey === key) return;
  const old = engine.tasks.get(index);
  if (old) old.cancelled = true;
  const task = { cancelled: false, cancel() { this.cancelled = true; } };
  engine.tasks.set(index, task);
  page.placeholder.hidden = false;
  const vp = engine.viewport(index);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  try {
    await engine.doc.render(index, page.canvas, vp.scale, totalRotation(index), dpr);
  } catch {
    return;
  }
  if (task.cancelled) return;
  engine.tasks.delete(index);
  page.rendered = true;
  page.renderedKey = key;
  page.placeholder.hidden = true;
  page.canvas.hidden = false;
  emit("page-rendered", index);
};

engine.mountTextLayer = async function (index) {
  if (engine.doc.kind !== "pdf") return;
  const page = engine.pages[index];
  if (!page || page.textMounted) return;
  page.textMounted = true;
  const vp = engine.viewport(index);
  try {
    engine.textLayers.set(index, await engine.doc.mountTextLayer(index, page.textEl, vp));
  } catch {
    page.textMounted = false;
  }
};

engine.resetTextLayers = function () {
  for (const page of engine.pages) {
    page.textEl.replaceChildren();
    page.textMounted = false;
  }
  engine.textLayers.clear();
};

engine.observe = function () {
  engine.observer?.disconnect();
  engine.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number(entry.target.dataset.index);
        engine.renderPage(index);
        if (engine.doc.kind === "pdf") engine.mountTextLayer(index);
      }
    },
    { root: engine.scroll, rootMargin: "900px 0px" }
  );
  for (const page of engine.pages) engine.observer.observe(page.el);
};

engine.updateView = function () {
  engine.relayout();
  engine.renderNear();
  emit("view-changed");
};

engine.pageFromEvent = function (event) {
  const el = event.target.closest?.(".page");
  if (!el) return null;
  const index = Number(el.dataset.index);
  const box = el.getBoundingClientRect();
  return { index, el, x: event.clientX - box.left, y: event.clientY - box.top };
};

engine.scrollToPage = function (number, smooth = false) {
  const index = Math.max(0, Math.min(engine.pages.length - 1, number - 1));
  const page = engine.pages[index];
  if (!page) return;
  page.el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  engine.current = index + 1;
  emit("page-changed", engine.current);
};

engine.trackCurrent = function () {
  const rect = engine.scroll.getBoundingClientRect();
  const mid = rect.top + rect.height * 0.4;
  let best = engine.current;
  let bestDist = Infinity;
  for (let i = 0; i < engine.pages.length; i += 1) {
    const box = engine.pages[i].el.getBoundingClientRect();
    if (box.bottom < rect.top || box.top > rect.bottom) continue;
    const d = Math.abs((box.top + box.bottom) / 2 - mid) / Math.max(box.bottom - box.top, 1);
    if (d < bestDist) {
      bestDist = d;
      best = i + 1;
    }
  }
  if (best !== engine.current) {
    engine.current = best;
    emit("page-changed", best);
  }
};

engine.thumbInto = async function (index, canvas, width) {
  const meta = engine.doc.meta(index);
  const scale = width / meta.width;
  await engine.doc.render(index, canvas, scale, 0, 2);
};

engine.fit = function (mode, stageW, stageH) {
  const meta = engine.doc.meta(0);
  const rot = totalRotation(0);
  const swapped = rot === 90 || rot === 270;
  const unit = engine.doc.kind === "pdf" ? BASE_SCALE : 1;
  const w1 = (swapped ? meta.height : meta.width) * unit;
  const h1 = (swapped ? meta.width : meta.height) * unit;
  if (mode === "page") {
    return Math.max(0.05, Math.min((stageW - 56) / w1, (stageH - 56) / h1));
  }
  return Math.max(0.05, (stageW - 56) / w1);
};

engine.destroy = function () {
  engine.observer?.disconnect();
  engine.observer = null;
  for (const task of engine.tasks.values()) task.cancelled = true;
  engine.tasks.clear();
  engine.textLayers.clear();
  engine.pages = [];
  engine.doc = null;
};

export { engine };

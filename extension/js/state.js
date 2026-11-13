export const HIGHLIGHT_COLORS = ["#f2c14e", "#7cc9a0", "#6fb2f0", "#f08ca8", "#b9a4ee"];
export const INK_COLORS = ["#1a1e23", "#d8482a", "#2563d9", "#1f796a", "#8a4bd1", "#e0a100", "#ffffff"];
export const NOTE_COLORS = ["#fbe6a2", "#f7c6bc", "#cbe6d9", "#cfe0f6", "#e3d6f5"];

export const TOOL_LABELS = {
  select: "Select",
  highlight: "Highlight",
  underline: "Underline",
  strike: "Strikethrough",
  pen: "Pen",
  marker: "Marker",
  eraser: "Eraser",
  text: "Text box",
  note: "Sticky note",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  signature: "Signature",
  stamp: "Image stamp",
};

export const TOOL_HINTS = {
  select: "Click an annotation to edit it. Drag across text to select and copy.",
  highlight: "Drag across text to highlight it.",
  underline: "Drag across text to underline it.",
  strike: "Drag across text to strike it out.",
  pen: "Draw with the pen. Hold Shift for a straight line.",
  marker: "Drag to mark up. Layers over text like a real highlighter.",
  eraser: "Click or drag over ink to remove it.",
  text: "Click anywhere to type. Esc finishes.",
  note: "Click anywhere to pin a comment.",
  rect: "Drag to draw a rectangle. Hold Shift for a square.",
  ellipse: "Drag to draw an ellipse. Hold Shift for a circle.",
  line: "Drag to draw a line. Hold Shift to snap the angle.",
  arrow: "Drag to draw an arrow. Hold Shift to snap the angle.",
  signature: "Click the page to place your signature.",
  stamp: "Click the page, then pick an image to place.",
};

const DEFAULT_STYLE = {
  highlight: HIGHLIGHT_COLORS[0],
  ink: INK_COLORS[0],
  note: NOTE_COLORS[0],
  stroke: 2,
  opacity: 1,
  highlightOpacity: 0.42,
  fontSize: 14,
  font: "sans",
  bold: false,
  italic: false,
  fill: false,
  textMark: "highlight",
};

export const state = {
  doc: null,
  annotations: [],
  tool: "select",
  toolOptions: { textMark: "highlight", shape: "rect" },
  selection: null,
  zoom: 1,
  fit: "width",
  rotation: 0,
  night: false,
  theme: "light",
  style: { ...DEFAULT_STYLE },
  history: { past: [], future: [] },
  dirty: false,
  editing: null,
  pageCount: 0,
  currentPage: 1,
};

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, detail) {
  listeners.get(event)?.forEach((handler) => handler(detail));
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem("stepnotate.style");
    if (raw) state.style = { ...DEFAULT_STYLE, ...JSON.parse(raw) };
    const theme = localStorage.getItem("stepnotate.theme");
    if (theme === "light" || theme === "dark") state.theme = theme;
    else state.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    state.theme = "light";
  }
  document.documentElement.dataset.theme = state.theme;
}

export function savePrefs() {
  try {
    localStorage.setItem("stepnotate.style", JSON.stringify(state.style));
    localStorage.setItem("stepnotate.theme", state.theme);
  } catch {
    return;
  }
}

export function resetStyle() {
  state.style = { ...DEFAULT_STYLE };
  savePrefs();
}

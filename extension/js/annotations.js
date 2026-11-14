import { state, emit } from "./state.js";
import { uid, escapeHtml, parseFontStack } from "./util.js";
import { history } from "./history.js";
import { engine } from "./engine.js";

let measureCtx = null;
function measure() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

export function wrapText(text, maxWidth, ann) {
  const ctx = measure();
  ctx.font = `${ann.italic ? "italic " : ""}${ann.bold ? "600 " : ""}${ann.fontSize}px ${parseFontStack(ann.font)}`;
  const out = [];
  for (const para of String(text || "").split("\n")) {
    if (!para) {
      out.push("");
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      const test = line + word;
      if (line && ctx.measureText(test.trimEnd()).width > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = test;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function textBoxHeight(ann) {
  const lines = wrapText(ann.text, ann.w, ann);
  return Math.max(ann.fontSize * 1.4, lines.length * ann.fontSize * 1.35 + ann.fontSize * 0.4);
}

export function annBBox(ann) {
  switch (ann.type) {
    case "highlight":
    case "underline":
    case "strike": {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const r of ann.rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.w);
        y1 = Math.max(y1, r.y + r.h);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case "ink":
    case "marker": {
      const pts = ann.points;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]);
        y1 = Math.max(y1, pts[i + 1]);
        x1 = Math.max(x1, pts[i]);
        y0 = Math.min(y0, pts[i + 1]);
      }
      const pad = ann.width;
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    case "line":
    case "arrow": {
      const x0 = Math.min(ann.x, ann.x2);
      const y0 = Math.min(ann.y, ann.y2);
      return { x: x0, y: y0, w: Math.abs(ann.x2 - ann.x), h: Math.abs(ann.y2 - ann.y) };
    }
    case "text": {
      ann.h = textBoxHeight(ann);
      return { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
    }
    case "note":
      return { x: ann.x, y: ann.y, w: 26, h: 26 };
    default:
      return { x: ann.x, y: ann.y, w: ann.w, h: ann.h };
  }
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function svgFor(ann) {
  const color = escapeAttr(ann.color || "#d8482a");
  const op = ann.opacity ?? 1;
  switch (ann.type) {
    case "highlight":
    case "underline":
    case "strike": {
      let out = "";
      for (const r of ann.rects) {
        if (ann.type === "highlight") {
          out += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${color}" opacity="${op}" style="mix-blend-mode:multiply"/>`;
        } else if (ann.type === "underline") {
          const t = Math.max(1.1, r.h * 0.075);
          out += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${t}" fill="${color}" opacity="${op}"/>`;
        } else {
          const t = Math.max(1.1, r.h * 0.065);
          const mid = r.y + r.h / 2 - t / 2;
          out += `<rect x="${r.x}" y="${mid}" width="${r.w}" height="${t}" fill="${color}" opacity="${op}"/>`;
        }
      }
      return out;
    }
    case "ink":
    case "marker": {
      const pts = [];
      for (let i = 0; i < ann.points.length; i += 2) pts.push(`${ann.points[i]},${ann.points[i + 1]}`);
      if (pts.length === 1) pts.push(`${ann.points[0] + 0.1},${ann.points[1]}`);
      return `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="${ann.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${ann.type === "marker" ? ' style="mix-blend-mode:multiply"' : ""}/>`;
    }
    case "rect": {
      const fill = ann.fill ? color : "none";
      const fop = ann.fill ? Math.min(op, 0.3) : 1;
      return `<rect x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" fill="${fill}" fill-opacity="${fop}" stroke="${color}" stroke-width="${ann.width}" opacity="${op}"/>`;
    }
    case "ellipse": {
      const fill = ann.fill ? color : "none";
      const fop = ann.fill ? Math.min(op, 0.3) : 1;
      return `<ellipse cx="${ann.x + ann.w / 2}" cy="${ann.y + ann.h / 2}" rx="${Math.abs(ann.w / 2)}" ry="${Math.abs(ann.h / 2)}" fill="${fill}" fill-opacity="${fop}" stroke="${color}" stroke-width="${ann.width}" opacity="${op}"/>`;
    }
    case "line":
      return `<line x1="${ann.x}" y1="${ann.y}" x2="${ann.x2}" y2="${ann.y2}" stroke="${color}" stroke-width="${ann.width}" stroke-linecap="round" opacity="${op}"/>`;
    case "arrow": {
      const dx = ann.x2 - ann.x;
      const dy = ann.y2 - ann.y;
      const a = Math.atan2(dy, dx);
      const len = Math.max(9, ann.width * 5);
      const spread = 0.42;
      const ax = ann.x2 - len * Math.cos(a - spread);
      const ay = ann.y2 - len * Math.sin(a - spread);
      const bx = ann.x2 - len * Math.cos(a + spread);
      const by = ann.y2 - len * Math.sin(a + spread);
      return `<line x1="${ann.x}" y1="${ann.y}" x2="${ann.x2}" y2="${ann.y2}" stroke="${color}" stroke-width="${ann.width}" stroke-linecap="round" opacity="${op}"/><polyline points="${ax},${ay} ${ann.x2},${ann.y2} ${bx},${by}" fill="none" stroke="${color}" stroke-width="${ann.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
    }
    case "text": {
      const lines = wrapText(ann.text, ann.w, ann);
      const lh = ann.fontSize * 1.35;
      const top = ann.y + ann.h;
      let out = "";
      if (ann.fill) out += `<rect x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" fill="${color}" opacity="0.14"/>`;
      const family = parseFontStack(ann.font);
      lines.forEach((line, i) => {
        const baseline = top - ann.fontSize * 0.85 - i * lh;
        out += `<g transform="translate(${ann.x},${baseline}) scale(1,-1)"><text x="0" y="0" font-family='${escapeAttr(family)}' font-size="${ann.fontSize}" fill="${ann.color}" font-weight="${ann.bold ? 600 : 400}" font-style="${ann.italic ? "italic" : "normal"}">${escapeHtml(line)}</text></g>`;
      });
      return out;
    }
    case "note": {
      return `<g><rect x="${ann.x}" y="${ann.y}" width="26" height="26" rx="3.5" fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="0.8"/><path d="M${ann.x + 18.5} ${ann.y + 26} L${ann.x + 26} ${ann.y + 18.5} L${ann.x + 26} ${ann.y + 26} Z" fill="rgba(0,0,0,0.16)"/><path d="M${ann.x + 6} ${ann.y + 10} h11 M${ann.x + 6} ${ann.y + 15} h8" stroke="rgba(0,0,0,0.55)" stroke-width="1.6" stroke-linecap="round"/></g>`;
    }
    case "signature":
    case "stamp":
      return `<image x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" href="${escapeAttr(ann.src)}" preserveAspectRatio="none"/>`;
    default:
      return "";
  }
}

function cssRectFromPageBox(index, box) {
  const vp = engine.viewport(index);
  const c1 = vp.convertToViewportPoint(box.x, box.y);
  const c2 = vp.convertToViewportPoint(box.x + box.w, box.y + box.h);
  const x = Math.min(c1[0], c2[0]);
  const y = Math.min(c1[1], c2[1]);
  return { x, y, w: Math.abs(c2[0] - c1[0]), h: Math.abs(c2[1] - c1[1]) };
}

function selectionOverlay(index, ann) {
  const vp = engine.viewport(index);
  const box = annBBox(ann);
  const c = cssRectFromPageBox(index, box);
  const handles = [];
  if (ann.type === "line" || ann.type === "arrow") {
    for (const [px, py] of [
      [ann.x, ann.y],
      [ann.x2, ann.y2],
    ]) {
      const p = vp.convertToViewportPoint(px, py);
      handles.push(`<circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="#fff" stroke="#d8482a" stroke-width="2"/>`);
    }
  } else if (!["stamp", "signature", "rect", "ellipse", "text"].includes(ann.type)) {
    return `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#d8482a" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  } else {
    for (const hx of [c.x, c.x + c.w]) {
      for (const hy of [c.y, c.y + c.h]) {
        handles.push(`<rect x="${hx - 5}" y="${hy - 5}" width="10" height="10" rx="2" fill="#fff" stroke="#d8482a" stroke-width="2"/>`);
      }
    }
  }
  return `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#d8482a" stroke-width="1.4" stroke-dasharray="5 4"/>${handles.join("")}`;
}

export function renderOverlay(index) {
  const page = engine.pages[index];
  if (!page) return;
  const vp = engine.viewport(index);
  const svg = page.svg;
  svg.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
  svg.setAttribute("width", vp.width);
  svg.setAttribute("height", vp.height);
  const m = vp.transform;
  let body = `<g transform="matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})">`;
  for (const ann of state.annotations) {
    if (ann.page !== index) continue;
    body += svgFor(ann);
  }
  body += "</g>";
  const sel = state.selection ? state.annotations.find((a) => a.id === state.selection) : null;
  if (sel && sel.page === index) body += selectionOverlay(index, sel);
  svg.innerHTML = body;
}

export function renderAllOverlays() {
  for (let i = 0; i < engine.pages.length; i += 1) renderOverlay(i);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideBox(px, py, box, pad) {
  return px >= box.x - pad && px <= box.x + box.w + pad && py >= box.y - pad && py <= box.y + box.h + pad;
}

export function hitTest(index, px, py) {
  const vp = engine.viewport(index);
  const tol = 7 / vp.scale;
  for (let i = state.annotations.length - 1; i >= 0; i -= 1) {
    const ann = state.annotations[i];
    if (ann.page !== index) continue;
    switch (ann.type) {
      case "highlight":
      case "underline":
      case "strike": {
        for (const r of ann.rects) {
          if (insideBox(px, py, r, tol)) return ann;
        }
        break;
      }
      case "ink":
      case "marker": {
        const half = ann.width / 2 + tol;
        for (let j = 0; j < ann.points.length - 2; j += 2) {
          if (distToSegment(px, py, ann.points[j], ann.points[j + 1], ann.points[j + 2], ann.points[j + 3]) <= half) return ann;
        }
        if (ann.points.length === 2 && Math.hypot(px - ann.points[0], py - ann.points[1]) <= half) return ann;
        break;
      }
      case "line":
      case "arrow": {
        if (distToSegment(px, py, ann.x, ann.y, ann.x2, ann.y2) <= ann.width / 2 + tol) return ann;
        break;
      }
      case "ellipse": {
        const cx = ann.x + ann.w / 2;
        const cy = ann.y + ann.h / 2;
        const rx = Math.abs(ann.w / 2) + tol;
        const ry = Math.abs(ann.h / 2) + tol;
        const nx = (px - cx) / Math.max(rx, 0.01);
        const ny = (py - cy) / Math.max(ry, 0.01);
        const d = nx * nx + ny * ny;
        if (d <= 1 && (ann.fill || d >= 0.62)) return ann;
        break;
      }
      case "note": {
        if (insideBox(px, py, annBBox(ann), tol)) return ann;
        break;
      }
      default: {
        if (insideBox(px, py, annBBox(ann), tol)) return ann;
      }
    }
  }
  return null;
}

export function handleAt(index, cssX, cssY) {
  if (!state.selection) return null;
  const ann = state.annotations.find((a) => a.id === state.selection);
  if (!ann || ann.page !== index) return null;
  const vp = engine.viewport(index);
  const box = annBBox(ann);
  if (ann.type === "line" || ann.type === "arrow") {
    const p1 = vp.convertToViewportPoint(ann.x, ann.y);
    const p2 = vp.convertToViewportPoint(ann.x2, ann.y2);
    if (Math.hypot(cssX - p1[0], cssY - p1[1]) <= 9) return { ann, handle: "p1" };
    if (Math.hypot(cssX - p2[0], cssY - p2[1]) <= 9) return { ann, handle: "p2" };
    return null;
  }
  if (!["stamp", "signature", "rect", "ellipse", "text"].includes(ann.type)) return null;
  const corners = [
    { name: "nw", x: box.x, y: box.y + box.h },
    { name: "ne", x: box.x + box.w, y: box.y + box.h },
    { name: "se", x: box.x + box.w, y: box.y },
    { name: "sw", x: box.x, y: box.y },
  ];
  for (const corner of corners) {
    const p = vp.convertToViewportPoint(corner.x, corner.y);
    if (Math.hypot(cssX - p[0], cssY - p[1]) <= 9) return { ann, handle: corner.name };
  }
  return null;
}

export function selectAnn(id) {
  if (state.selection === id) return;
  state.selection = id;
  emit("selection");
}

export function addAnn(ann) {
  state.annotations.push(ann);
  emit("changed");
}

export function removeAnn(id) {
  const i = state.annotations.findIndex((a) => a.id === id);
  if (i < 0) return;
  state.annotations.splice(i, 1);
  if (state.selection === id) state.selection = null;
  emit("changed");
}

export function newAnn(page, patch) {
  return { id: uid("an"), page, ...patch };
}

export function translateAnn(ann, dx, dy) {
  if (ann.rects) {
    for (const r of ann.rects) {
      r.x += dx;
      r.y += dy;
    }
  } else if (ann.points) {
    for (let i = 0; i < ann.points.length; i += 2) {
      ann.points[i] += dx;
      ann.points[i + 1] += dy;
    }
  } else if (ann.type === "line" || ann.type === "arrow") {
    ann.x += dx;
    ann.y += dy;
    ann.x2 += dx;
    ann.y2 += dy;
  } else {
    ann.x += dx;
    ann.y += dy;
  }
}

export function applyResize(ann, handle, px, py) {
  if (ann.type === "line" || ann.type === "arrow") {
    if (handle === "p1") {
      ann.x = px;
      ann.y = py;
    } else {
      ann.x2 = px;
      ann.y2 = py;
    }
    return;
  }
  const box = annBBox(ann);
  const left = box.x;
  const right = box.x + box.w;
  const bottom = box.y;
  const top = box.y + box.h;
  let x0 = left;
  let x1 = right;
  let y0 = bottom;
  let y1 = top;
  if (handle.includes("w")) x0 = px;
  else x1 = px;
  if (handle.includes("s")) y0 = py;
  else y1 = py;
  const nx = Math.min(x0, x1);
  const ny = Math.min(y0, y1);
  const nw = Math.max(Math.abs(x1 - x0), 8);
  const nh = Math.max(Math.abs(y1 - y0), 8);
  if (ann.type === "text") {
    ann.x = nx;
    ann.y = ny;
    ann.w = nw;
    ann.h = textBoxHeight(ann);
  } else {
    ann.x = nx;
    ann.y = ny;
    ann.w = nw;
    ann.h = nh;
  }
}

export function clearAll() {
  history.push();
  state.annotations = [];
  state.selection = null;
  emit("changed");
}

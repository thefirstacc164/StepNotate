import { state, emit } from "./state.js";
import { BASE_SCALE } from "./loader.js";
import { history } from "./history.js";
import { toast, confirmDialog } from "./dialogs.js";
import { downloadBlob, downloadName } from "./util.js";
import { wrapText, renderAllOverlays } from "./annotations.js";

const PDFLib = window.PDFLib;

function hexToRgb01(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function rgbOf(hex) {
  const { r, g, b } = hexToRgb01(hex);
  return new PDFLib.rgb(r, g, b);
}

function fontKey(ann) {
  const serif = /serif/i.test(ann.font) && !/sans/i.test(ann.font);
  const mono = /mono|courier/i.test(ann.font);
  const S = PDFLib.StandardFonts;
  if (mono) {
    if (ann.bold && ann.italic) return S.CourierBoldOblique;
    if (ann.bold) return S.CourierBold;
    if (ann.italic) return S.CourierOblique;
    return S.Courier;
  }
  if (serif) {
    if (ann.bold && ann.italic) return S.TimesRomanBoldItalic;
    if (ann.bold) return S.TimesRomanBold;
    if (ann.italic) return S.TimesRomanItalic;
    return S.TimesRoman;
  }
  if (ann.bold && ann.italic) return S.HelveticaBoldOblique;
  if (ann.bold) return S.HelveticaBold;
  if (ann.italic) return S.HelveticaOblique;
  return S.Helvetica;
}

function blendOf(hex, opacity) {
  return { color: rgbOf(hex), opacity, blendMode: PDFLib.BlendMode.Multiply };
}

function drawTextMarks(page, ann) {
  const color = rgbOf(ann.color);
  for (const r of ann.rects) {
    if (ann.type === "highlight") {
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, ...blendOf(ann.color, ann.opacity ?? 1) });
    } else if (ann.type === "underline") {
      const t = Math.max(1.1, r.h * 0.075);
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: t, color, opacity: ann.opacity ?? 1 });
    } else {
      const t = Math.max(1.1, r.h * 0.065);
      page.drawRectangle({ x: r.x, y: r.y + r.h / 2 - t / 2, width: r.w, height: t, color, opacity: ann.opacity ?? 1 });
    }
  }
}

function drawStroke(page, ann) {
  const pts = ann.points;
  const color = rgbOf(ann.color);
  const opts = ann.type === "marker" ? blendOf(ann.color, ann.opacity ?? 1) : { color, opacity: ann.opacity ?? 1 };
  for (let i = 0; i < pts.length - 2; i += 2) {
    page.drawLine({
      start: { x: pts[i], y: pts[i + 1] },
      end: { x: pts[i + 2], y: pts[i + 3] },
      thickness: ann.width,
      ...opts,
    });
  }
}

function drawShape(page, ann) {
  const color = rgbOf(ann.color);
  const op = ann.opacity ?? 1;
  if (ann.type === "rect") {
    const opts = {
      x: ann.x,
      y: ann.y,
      width: ann.w,
      height: ann.h,
      borderColor: color,
      borderWidth: ann.width,
      borderOpacity: op,
    };
    if (ann.fill) {
      opts.color = color;
      opts.opacity = Math.min(op, 0.3);
    }
    page.drawRectangle(opts);
  } else if (ann.type === "ellipse") {
    const opts = {
      x: ann.x + ann.w / 2,
      y: ann.y + ann.h / 2,
      xScale: Math.abs(ann.w / 2),
      yScale: Math.abs(ann.h / 2),
      borderColor: color,
      borderWidth: ann.width,
      borderOpacity: op,
    };
    if (ann.fill) {
      opts.color = color;
      opts.opacity = Math.min(op, 0.3);
    }
    page.drawEllipse(opts);
  } else {
    page.drawLine({
      start: { x: ann.x, y: ann.y },
      end: { x: ann.x2, y: ann.y2 },
      thickness: ann.width,
      color,
      opacity: op,
    });
    if (ann.type === "arrow") {
      const dx = ann.x2 - ann.x;
      const dy = ann.y2 - ann.y;
      const a = Math.atan2(dy, dx);
      const len = Math.max(9, ann.width * 5);
      const spread = 0.42;
      page.drawLine({
        start: { x: ann.x2, y: ann.y2 },
        end: { x: ann.x2 - len * Math.cos(a - spread), y: ann.y2 - len * Math.sin(a - spread) },
        thickness: ann.width,
        color,
        opacity: op,
      });
      page.drawLine({
        start: { x: ann.x2, y: ann.y2 },
        end: { x: ann.x2 - len * Math.cos(a + spread), y: ann.y2 - len * Math.sin(a + spread) },
        thickness: ann.width,
        color,
        opacity: op,
      });
    }
  }
}

async function embedFromDataUrl(pdfDoc, dataUrl) {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  if (meta.includes("image/png")) return pdfDoc.embedPng(bytes);
  return pdfDoc.embedJpg(bytes);
}

async function drawOnPdfPage(pdfDoc, page, anns) {
  const fonts = new Map();
  const getFont = async (ann) => {
    const key = fontKey(ann);
    if (!fonts.has(key)) fonts.set(key, await pdfDoc.embedFont(key));
    return fonts.get(key);
  };
  const images = new Map();
  const getImage = async (src) => {
    if (!images.has(src)) images.set(src, await embedFromDataUrl(pdfDoc, src));
    return images.get(src);
  };
  for (const ann of anns) {
    try {
      switch (ann.type) {
        case "highlight":
        case "underline":
        case "strike":
          drawTextMarks(page, ann);
          break;
        case "ink":
        case "marker":
          drawStroke(page, ann);
          break;
        case "rect":
        case "ellipse":
        case "line":
        case "arrow":
          drawShape(page, ann);
          break;
        case "text": {
          const font = await getFont(ann);
          const color = rgbOf(ann.color);
          const lines = wrapText(ann.text, ann.w, ann);
          const lh = ann.fontSize * 1.35;
          const top = ann.y + ann.h;
          if (ann.fill) {
            page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color, opacity: 0.14 });
          }
          lines.forEach((line, i) => {
            if (!line) return;
            page.drawText(line, {
              x: ann.x,
              y: top - ann.fontSize * 0.85 - i * lh,
              size: ann.fontSize,
              font,
              color,
            });
          });
          break;
        }
        case "note": {
          const color = rgbOf(ann.color);
          page.drawRectangle({ x: ann.x, y: ann.y, width: 26, height: 26, color, opacity: 1, borderColor: rgbOf("#000000"), borderWidth: 0.6, borderOpacity: 0.3 });
          const font = await getFont({ font: "sans", bold: false, italic: false });
          const lines = wrapText(ann.text || "", 150, { fontSize: 9, font: "sans", bold: false, italic: false });
          lines.slice(0, 6).forEach((line, i) => {
            if (!line) return;
            page.drawText(line, {
              x: ann.x + 32,
              y: ann.y + 20 - i * 11,
              size: 9,
              font,
              color: rgbOf("#1b1f24"),
            });
          });
          break;
        }
        case "signature":
        case "stamp": {
          const img = await getImage(ann.src);
          page.drawImage(img, { x: ann.x, y: ann.y, width: ann.w, height: ann.h, opacity: ann.opacity ?? 1 });
          break;
        }
      }
    } catch (err) {
      console.warn("draw failed", ann.type, err);
    }
  }
}

export async function exportPdf() {
  const doc = state.doc;
  if (!doc) return;
  if (!state.annotations.length) {
    toast("Nothing to export yet — add some marks first");
    return;
  }
  toast("Building PDF…");
  try {
    let pdfDoc;
    let pageMapping = [];
    if (doc.kind === "pdf") {
      const raw = doc.bytes instanceof Uint8Array ? doc.bytes : new Uint8Array(doc.bytes);
      pdfDoc = await PDFLib.PDFDocument.load(raw, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      pageMapping = pages.map((p, i) => ({ page: p, index: i }));
    } else {
      pdfDoc = await PDFLib.PDFDocument.create();
      const mime = doc.mime || "image/png";
      const raw = doc.bytes instanceof Uint8Array ? doc.bytes : new Uint8Array(doc.bytes);
      const img = mime.includes("png") ? await pdfDoc.embedPng(raw) : await pdfDoc.embedJpg(raw);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      pageMapping = [{ page, index: 0 }];
    }
    for (const { page, index } of pageMapping) {
      const anns = state.annotations.filter((a) => a.page === index);
      if (anns.length) await drawOnPdfPage(pdfDoc, page, anns);
    }
    const bytes = await pdfDoc.save();
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), downloadName(doc.name, "-marked", "pdf"));
    toast("PDF exported", "ok");
  } catch (err) {
    console.error(err);
    toast("Export failed — the file may be encrypted or damaged", "bad");
  }
}

export async function exportPng(pageIndex) {
  const doc = state.doc;
  if (!doc) return;
  const idx = pageIndex ?? Math.max(0, state.currentPage - 1);
  try {
    const canvas = document.createElement("canvas");
    const scale = (state.zoom || 1) * (doc.kind === "pdf" ? BASE_SCALE : 1) * 2;
    await doc.render(idx, canvas, scale, state.rotation, 1);
    const ctx = canvas.getContext("2d");
    const anns = state.annotations.filter((a) => a.page === idx);
    if (anns.length) {
      const vp = await doc.viewport(idx, scale, state.rotation);
      const overlaySvg = buildOverlaySvg(idx, vp);
      const blob = new Blob([overlaySvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      ctx.drawImage(img, 0, 0, vp.width, vp.height);
      URL.revokeObjectURL(url);
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob) {
      const name = downloadName(doc.name, `-page${idx + 1}`, "png");
      downloadBlob(blob, name);
      toast("Page exported as PNG", "ok");
    }
  } catch (err) {
    console.error(err);
    toast("PNG export failed", "bad");
  }
}

function buildOverlaySvg(index, vp) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${vp.width}" height="${vp.height}" viewBox="0 0 ${vp.width} ${vp.height}">`];
  const m = vp.transform;
  parts.push(`<g transform="matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})">`);
  for (const ann of state.annotations) {
    if (ann.page !== index) continue;
    parts.push(annSvgString(ann));
  }
  parts.push("</g></svg>");
  return parts.join("");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function annSvgString(ann) {
  const color = esc(ann.color || "#d8482a");
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
          out += `<rect x="${r.x}" y="${r.y + r.h / 2 - t / 2}" width="${r.w}" height="${t}" fill="${color}" opacity="${op}"/>`;
        }
      }
      return out;
    }
    case "ink":
    case "marker": {
      const pts = [];
      for (let i = 0; i < ann.points.length; i += 2) pts.push(`${ann.points[i]},${ann.points[i + 1]}`);
      if (pts.length === 1) pts.push(`${ann.points[0] + 0.1},${ann.points[1]}`);
      return `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="${ann.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
    }
    case "rect":
      return `<rect x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" fill="${ann.fill ? color : "none"}" fill-opacity="${ann.fill ? Math.min(op, 0.3) : 0}" stroke="${color}" stroke-width="${ann.width}" opacity="${op}"/>`;
    case "ellipse":
      return `<ellipse cx="${ann.x + ann.w / 2}" cy="${ann.y + ann.h / 2}" rx="${Math.abs(ann.w / 2)}" ry="${Math.abs(ann.h / 2)}" fill="${ann.fill ? color : "none"}" fill-opacity="${ann.fill ? Math.min(op, 0.3) : 0}" stroke="${color}" stroke-width="${ann.width}" opacity="${op}"/>`;
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
      const family = /mono|courier/i.test(ann.font) ? "monospace" : /serif/i.test(ann.font) && !/sans/i.test(ann.font) ? "serif" : "sans-serif";
      lines.forEach((line, i) => {
        const baseline = top - ann.fontSize * 0.85 - i * lh;
        out += `<g transform="translate(${ann.x},${baseline}) scale(1,-1)"><text x="0" y="0" font-family="${family}" font-size="${ann.fontSize}" fill="${esc(ann.color)}" font-weight="${ann.bold ? 600 : 400}" font-style="${ann.italic ? "italic" : "normal"}">${esc(line)}</text></g>`;
      });
      return out;
    }
    case "note":
      return `<g><rect x="${ann.x}" y="${ann.y}" width="26" height="26" rx="3.5" fill="${color}" stroke="rgba(0,0,0,0.28)" stroke-width="0.8"/><path d="M${ann.x + 18.5} ${ann.y + 26} L${ann.x + 26} ${ann.y + 18.5} L${ann.x + 26} ${ann.y + 26} Z" fill="rgba(0,0,0,0.16)"/><path d="M${ann.x + 6} ${ann.y + 10} h11 M${ann.x + 6} ${ann.y + 15} h8" stroke="rgba(0,0,0,0.55)" stroke-width="1.6" stroke-linecap="round"/></g>`;
    case "signature":
    case "stamp":
      return `<image x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" href="${esc(ann.src)}" preserveAspectRatio="none"/>`;
    default:
      return "";
  }
}

export function exportProject() {
  const doc = state.doc;
  if (!doc) {
    toast("Open a document first");
    return;
  }
  const project = {
    format: "stepnotate-project",
    version: 1,
    doc: {
      name: doc.name,
      mime: doc.mime,
      size: doc.bytes?.byteLength || 0,
      pageCount: state.pageCount,
    },
    annotations: state.annotations,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  downloadBlob(blob, downloadName(doc.name, ".stepnotate", "json"));
  toast("Project exported", "ok");
}

export async function importProject() {
  const input = document.getElementById("projectInput");
  input.value = "";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      if (project.format !== "stepnotate-project") {
        toast("That doesn't look like a StepNotate project", "bad");
        return;
      }
      if (!state.doc) {
        toast("Open the original document first, then import", "bad");
        return;
      }
      const same = project.doc?.name === state.doc.name;
      const ok = await confirmDialog(
        "Import project",
        same
          ? `Replace current marks with ${project.annotations?.length || 0} imported from “${project.doc.name}”?`
          : `The project was made from “${project.doc?.name || "another file"}”. Import its ${project.annotations?.length || 0} marks onto the open document anyway?`,
        "Import"
      );
      if (!ok) return;
      history.push();
      state.annotations = Array.isArray(project.annotations) ? project.annotations : [];
      state.selection = null;
      state.__searchText = null;
      renderAllOverlays();
      emit("changed");
      toast(`Imported ${state.annotations.length} marks`, "ok");
    } catch (err) {
      console.error(err);
      toast("Could not read that file", "bad");
    }
  };
  input.click();
}

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "extension");

let failures = 0;
let passed = 0;
function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`ok    ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
  }
}

class StubClassList {
  constructor() {
    this.set = new Set();
  }
  add(...v) {
    v.forEach((x) => this.set.add(x));
  }
  remove(...v) {
    v.forEach((x) => this.set.delete(x));
  }
  toggle(v, force) {
    const on = force === undefined ? !this.set.has(v) : !!force;
    if (on) this.set.add(v);
    else this.set.delete(v);
    return on;
  }
  contains(v) {
    return this.set.has(v);
  }
}

const created = [];

class StubElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = new Proxy({}, { get: (t, p) => (p === "setProperty" ? () => {} : t[p] ?? ""), set: (t, p, v) => ((t[p] = v), true) });
    this.dataset = {};
    this.classList = new StubClassList();
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    created.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  append(...c) {
    this.children.push(...c);
  }
  remove() {}
  replaceChildren(...c) {
    this.children = c;
  }
  contains() {
    return false;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0 };
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
  removeAttribute() {}
  focus() {}
  blur() {}
  click() {
    this.clicked = true;
  }
  scrollIntoView() {}
  setSelectionRange() {}
  getContext() {
    return {
      font: "",
      measureText: (t) => ({ width: String(t).length * 6.2 }),
      setTransform() {},
      fillRect() {},
      clearRect() {},
      drawImage() {},
      save() {},
      restore() {},
      scale() {},
      translate() {},
      rotate() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      closePath() {},
      arc() {},
      quadraticCurveTo() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {},
    };
  }
  toDataURL() {
    return "data:image/png;base64,";
  }
}

function installGlobals() {
  const byId = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new StubElement());
      return byId.get(id);
    },
    createElement: (tag) => new StubElement(tag),
    createElementNS: (_ns, tag) => new StubElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    documentElement: new StubElement("html"),
    body: new StubElement("body"),
    activeElement: null,
  };
  globalThis.window = globalThis;
  globalThis.location = { search: "", href: "", pathname: "/viewer.html" };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.devicePixelRatio = 1;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getSelection = () => ({ isCollapsed: true, rangeCount: 0, removeAllRanges() {}, getRangeAt: () => ({ getClientRects: () => [], boundingClientRect: {} }) });
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLTextAreaElement = class {};

  const captured = [];
  globalThis.__downloads = captured;
  globalThis.URL.createObjectURL = (blob) => {
    captured.push({ blob, url: "" });
    return `blob:e2e-${captured.length}`;
  };
  globalThis.URL.revokeObjectURL = () => {};
}

const require = createRequire(import.meta.url);
installGlobals();
globalThis.PDFLib = require(join(ext, "vendor/pdf-lib/pdf-lib.min.js"));

const imp = (p) => import(pathToFileURL(join(ext, p)).href);

const [loader, stateMod, annMod, exporter] = await Promise.all([
  imp("js/loader.js"),
  imp("js/state.js"),
  imp("js/annotations.js"),
  imp("js/exporter.js"),
]);

const { buildDocument, pdfjsLib } = loader;
const { state } = stateMod;
const { newAnn } = annMod;

const sampleBytes = readFileSync(join(ext, "samples/sample.pdf"));
const sampleAb = sampleBytes.buffer.slice(sampleBytes.byteOffset, sampleBytes.byteOffset + sampleBytes.byteLength);

const doc = await buildDocument({ bytes: sampleAb, name: "sample.pdf", mime: "application/pdf" });
ok(doc.kind === "pdf" && doc.pageCount === 3, `sample loaded (${doc.kind}, ${doc.pageCount} pages)`);

const vp = await doc.viewport(0, 1.5, 0);
ok(vp && vp.width > 400 && vp.height > 400, `viewport(0,1.5) = ${Math.round(vp.width)}×${Math.round(vp.height)}`);

const pageText = await doc.textContent(0);
ok(typeof pageText === "string" && pageText.split(/\s+/).filter(Boolean).length > 5, `text extraction (${pageText.split(/\s+/).filter(Boolean).length} words)`);

state.doc = doc;
state.pageCount = doc.pageCount;

const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

state.annotations = [
  newAnn(0, { type: "highlight", rects: [{ x: 72, y: 640, w: 180, h: 14 }, { x: 72, y: 620, w: 90, h: 14 }], color: "#ffe066", opacity: 0.55 }),
  newAnn(0, { type: "underline", rects: [{ x: 72, y: 600, w: 140, h: 14 }], color: "#d8482a", opacity: 1 }),
  newAnn(0, { type: "strike", rects: [{ x: 260, y: 600, w: 120, h: 14 }], color: "#1b1f24", opacity: 1 }),
  newAnn(0, { type: "ink", points: [72, 560, 120, 520, 180, 550, 240, 500], width: 2.6, color: "#1d4ed8", opacity: 1 }),
  newAnn(0, { type: "marker", points: [72, 470, 200, 470], width: 14, color: "#ff9f1c", opacity: 0.45 }),
  newAnn(1, { type: "text", text: "Exported text box with a wrapping sentence to exercise the layout path.", x: 72, y: 560, w: 240, h: 70, fontSize: 13, font: "serif", bold: false, italic: false, color: "#1b1f24", fill: false }),
  newAnn(1, { type: "note", text: "Remember the deadline", x: 400, y: 560, color: "#ffd43b" }),
  newAnn(1, { type: "rect", x: 72, y: 420, w: 160, h: 90, width: 2, color: "#d8482a", fill: false, opacity: 1 }),
  newAnn(1, { type: "ellipse", x: 280, y: 420, w: 160, h: 90, width: 2, color: "#0ca678", fill: true, opacity: 0.9 }),
  newAnn(2, { type: "line", x: 72, y: 500, x2: 300, y2: 560, width: 2, color: "#1b1f24", opacity: 1 }),
  newAnn(2, { type: "arrow", x: 72, y: 300, x2: 320, y2: 360, width: 2.4, color: "#d8482a", opacity: 1 }),
  newAnn(2, { type: "signature", src: PNG1, x: 72, y: 160, w: 130, h: 49, opacity: 1 }),
  newAnn(2, { type: "stamp", src: PNG1, x: 300, y: 160, w: 64, h: 64, opacity: 0.8 }),
];

await exporter.exportPdf();
ok(__downloads.length === 1, `pdf download triggered (${__downloads.length})`);
const pdfDownload = __downloads[0];
ok(pdfDownload && pdfDownload.blob?.type === "application/pdf", "download blob is a pdf");

const outBytes = new Uint8Array(await pdfDownload.blob.arrayBuffer());
writeFileSync("/tmp/e2e-out.pdf", outBytes);
ok(outBytes[0] === 0x25 && outBytes[1] === 0x50 && outBytes[2] === 0x44 && outBytes[3] === 0x46, "output starts with %PDF");
ok(outBytes.length > sampleBytes.length, `output grew with marks (${sampleBytes.length} → ${outBytes.length})`);

const anchors = created.filter((el) => el.tagName === "A" && el.download);
const pdfAnchor = anchors.find((a) => a.download.endsWith(".pdf"));
ok(pdfAnchor && pdfAnchor.download === "sample-marked.pdf", `pdf filename = ${pdfAnchor?.download}`);

const rt = await pdfjsLib.getDocument({ data: outBytes.slice() }).promise;
ok(rt.numPages === 3, `round-trip opens in pdf.js (${rt.numPages} pages)`);
const rtPage = await rt.getPage(1);
ok(rtPage && Math.round(rtPage.getViewport({ scale: 1 }).width) > 0, "round-trip page viewport ok");
await rt.destroy();

exporter.exportProject();
const projDownload = __downloads.find((d) => d.blob?.type === "application/json");
ok(!!projDownload, "project export triggered");
if (projDownload) {
  const project = JSON.parse(await projDownload.blob.text());
  ok(project.format === "stepnotate-project" && project.version === 1, "project format header");
  ok(Array.isArray(project.annotations) && project.annotations.length === 13, `project holds ${project.annotations?.length} annotations`);
}
const projAnchor = created.filter((el) => el.tagName === "A" && el.download).find((a) => a.download.includes("stepnotate"));
ok(projAnchor && projAnchor.download === "sample.stepnotate.json", `project filename = ${projAnchor?.download}`);

state.doc = null;
state.annotations = [];
await doc.destroy();

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

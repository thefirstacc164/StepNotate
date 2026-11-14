import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "extension");
let failures = 0;
let passed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
  }
}

function read(path) {
  return readFileSync(path, "utf8");
}

function extractIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

function extractUses(...sources) {
  const uses = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/href="#([^"]+)"/g)) uses.add(m[1]);
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) uses.add(m[1]);
    for (const m of src.matchAll(/\$\("([^"]+)"\)/g)) uses.add(m[1]);
  }
  return uses;
}

function checkManifest() {
  const manifest = JSON.parse(read(join(ext, "manifest.json")));
  ok(manifest.manifest_version === 3, "manifest v3");
  ok(Array.isArray(manifest.permissions), "permissions present");
  const bg = manifest.background?.service_worker;
  ok(bg && existsSync(join(ext, bg)), `background ${bg} exists`);
  const popup = manifest.action?.default_popup;
  ok(popup && existsSync(join(ext, popup)), `popup ${popup} exists`);
  const icons = manifest.icons || {};
  for (const [size, path] of Object.entries(icons)) {
    ok(existsSync(join(ext, path)), `icon ${size} → ${path}`);
  }
  const war = (manifest.web_accessible_resources || []).flatMap((r) => r.resources || []);
  for (const pattern of war) {
    if (pattern.includes("*")) {
      const dir = pattern.replace(/\/\*$/, "");
      ok(existsSync(join(ext, dir)), `war dir ${dir}`);
    } else {
      ok(existsSync(join(ext, pattern)), `war ${pattern}`);
    }
  }
  const content = manifest.content_scripts || [];
  ok(Array.isArray(content), "content_scripts key valid");
}

function checkPages() {
  const pages = [
    ["viewer.html", ["js/app.js", "vendor/pdf-lib/pdf-lib.min.js"]],
    ["popup.html", ["js/popup.js"]],
    ["welcome.html", ["js/welcome.js"]],
  ];
  for (const [page, scripts] of pages) {
    const html = read(join(ext, page));
    for (const script of scripts) {
      ok(html.includes(script), `${page} references ${script}`);
      ok(existsSync(join(ext, script)), `${script} exists`);
    }
    const ids = extractIds(html);
    const jsDir = join(ext, "js");
    const related = {
      "viewer.html": ["app.js", "tools.js", "inspector.js", "sidebar.js", "exporter.js", "dialogs.js", "annotations.js"],
      "popup.html": ["popup.js"],
      "welcome.html": ["welcome.js"],
    }[page];
    const sources = related.map((f) => read(join(jsDir, f))).join("\n");
    const uses = extractUses(sources);
    const missing = [...uses].filter((id) => !ids.has(id));
    ok(missing.length === 0, `${page} ids resolved (missing: ${missing.join(", ") || "none"})`);
    const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]));
    const iconUses = new Set();
    for (const m of html.matchAll(/href="#(i-[^"]+)"/g)) iconUses.add(m[1]);
    for (const m of sources.matchAll(/href="#(i-[^"]+)"/g)) iconUses.add(m[1]);
    const missingIcons = [...iconUses].filter((i) => !symbols.has(i));
    ok(missingIcons.length === 0, `${page} icons resolved (missing: ${missingIcons.join(", ") || "none"})`);
  }
}

function checkFiles() {
  const required = [
    "styles/base.css",
    "styles/app.css",
    "styles/popup.css",
    "styles/welcome.css",
    "js/state.js",
    "js/util.js",
    "js/db.js",
    "js/loader.js",
    "js/history.js",
    "js/annotations.js",
    "js/engine.js",
    "js/dialogs.js",
    "js/tools.js",
    "js/inspector.js",
    "js/sidebar.js",
    "js/exporter.js",
    "js/app.js",
    "vendor/pdfjs/pdf.min.mjs",
    "vendor/pdfjs/pdf.worker.min.mjs",
    "vendor/pdf-lib/pdf-lib.min.js",
    "samples/sample.pdf",
    "icons/icon128.png",
  ];
  for (const f of required) ok(existsSync(join(ext, f)), `file ${f}`);
  const sample = join(ext, "samples/sample.pdf");
  if (existsSync(sample)) {
    const head = readFileSync(sample).subarray(0, 5).toString("latin1");
    ok(head === "%PDF-", "sample.pdf is a PDF");
  }
}

function checkNoCommentsInSource() {
  const files = readdirSync(join(ext, "js")).filter((f) => f.endsWith(".js"));
  const offenders = [];
  for (const f of files) {
    const src = read(join(ext, "js", f));
    const lines = src.split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) offenders.push(`${f}: ${t.slice(0, 60)}`);
    }
  }
  ok(offenders.length === 0, `no source comments (found ${offenders.length}${offenders.length ? `: ${offenders[0]}` : ""})`);
}

function checkWelcomeKeys() {
  const welcome = read(join(ext, "js/welcome.js"));
  const app = read(join(ext, "js/app.js"));
  const keys = [...welcome.matchAll(/\["[^"]+", "([A-Za-z +/−Z]+)"\]/g)].map((m) => m[1]);
  ok(keys.length >= 12, `welcome lists shortcuts (${keys.length})`);
  for (const [label, key] of [
    ["Ctrl S", "s"],
    ["Ctrl F", "f"],
    ["Ctrl Z", "z"],
  ]) {
    ok(welcome.includes(label) && app.includes(`"${key}"`), `shortcut ${label} wired in app`);
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

class StubElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = new Proxy(
      {},
      {
        get: (t, p) => (p === "setProperty" ? () => {} : t[p] ?? ""),
        set: (t, p, v) => {
          t[p] = v;
          return true;
        },
      }
    );
    this.dataset = {};
    this.classList = new StubClassList();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.offsetWidth = 200;
    this.offsetHeight = 200;
    this.files = [];
    this.scrollTop = 0;
    this.scrollHeight = 1000;
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
  prepend(...c) {
    this.children.unshift(...c);
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
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
  removeAttribute() {}
  focus() {}
  blur() {}
  click() {}
  scrollIntoView() {}
  setSelectionRange() {}
  getContext() {
    return {
      font: "",
      measureText: (t) => ({ width: t.length * 6 }),
      setTransform() {},
      fillRect() {},
      drawImage() {},
      save() {},
      restore() {},
      scale() {},
      translate() {},
      rotate() {},
    };
  }
  toDataURL() {
    return "data:image/png;base64,";
  }
  toBlob(cb) {
    cb(new Blob([]));
  }
}

function installGlobals() {
  const byId = new Map();
  const doc = {
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
    title: "",
  };
  globalThis.document = doc;
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
  globalThis.Blob = globalThis.Blob || class {};
  globalThis.FileReader = class {
    readAsDataURL() {}
    readAsText() {}
  };
  globalThis.Image = class {
    set src(v) {
      setTimeout(() => this.onerror?.(), 0);
    }
  };
}

async function checkModuleGraph() {
  installGlobals();
  const jsDir = join(ext, "js");
  const files = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
  const loaded = new Map();
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(jsDir, f)).href);
      loaded.set(f, mod);
      passed += 1;
    } catch (err) {
      failures += 1;
      console.log(`FAIL  import ${f}: ${err.message}`);
    }
  }
  const expect = {
    "state.js": ["state", "on", "emit", "loadPrefs", "savePrefs", "HIGHLIGHT_COLORS", "INK_COLORS", "NOTE_COLORS", "TOOL_LABELS", "TOOL_HINTS"],
    "history.js": ["history"],
    "engine.js": ["engine"],
    "dialogs.js": ["openModal", "toast", "confirmDialog", "colorPop", "signaturePad"],
    "tools.js": ["initTools", "finishEditing", "isEditing", "refreshSelBar", "openNoteFor"],
    "inspector.js": ["initInspector", "refreshInspector"],
    "sidebar.js": ["initSidebar", "focusSearch", "refreshSidebar"],
    "exporter.js": ["exportPdf", "exportPng", "exportProject", "importProject"],
    "annotations.js": ["renderAllOverlays", "selectAnn", "clearAll", "removeAnn", "hitTest", "annBBox", "wrapText", "textBoxHeight"],
    "loader.js": ["buildDocument", "fetchDocumentBytes", "hashBytes", "BASE_SCALE", "DocModel"],
    "db.js": ["saveDocument", "getDocumentMeta", "listDocuments", "getDocumentBytes", "removeDocument", "saveMarks", "getMarks", "setPending", "takePending", "saveThumb"],
    "util.js": ["uid", "clamp", "deepCopy", "formatBytes", "timeAgo", "escapeHtml", "debounce", "downloadBlob", "stripExtension", "fileNameFromUrl", "downloadName", "isWebUrl"],
  };
  for (const [file, names] of Object.entries(expect)) {
    const mod = loaded.get(file);
    if (!mod) continue;
    const missing = names.filter((n) => !(n in mod));
    ok(missing.length === 0, `${file} exports (missing: ${missing.join(", ") || "none"})`);
  }
  return loaded;
}

async function checkBehavior(loaded) {
  const util = loaded.get("util.js");
  if (util) {
    ok(util.stripExtension("report.final.pdf") === "report.final", "stripExtension");
    ok(util.downloadName("report.pdf", "-marked", "pdf") === "report-marked.pdf", "downloadName");
    ok(util.formatBytes(2048) === "2.0 KB", "formatBytes KB");
    ok(util.escapeHtml('<a href="x">') === "&lt;a href=&quot;x&quot;&gt;", "escapeHtml");
    ok(util.clamp(5, 0, 3) === 3, "clamp");
    ok(util.isWebUrl("https://a.b/c.pdf") && !util.isWebUrl("notaurl"), "isWebUrl");
    ok(util.fileNameFromUrl("https://x.y/docs/paper.pdf?x=1") === "paper.pdf", "fileNameFromUrl");
  }
  const historyMod = loaded.get("history.js");
  const stateMod = loaded.get("state.js");
  if (historyMod && stateMod) {
    const h = historyMod.history;
    const state = stateMod.state;
    state.annotations = [];
    h.past = [];
    h.future = [];
    h.pending = null;
    state.annotations.push({ id: "a1", page: 0, type: "note", text: "one" });
    h.push();
    state.annotations.push({ id: "a2", page: 0, type: "note", text: "two" });
    ok(h.canUndo(), "history canUndo after push");
    h.undo();
    ok(state.annotations.length === 1, "undo removes second note");
    h.redo();
    ok(state.annotations.length === 2, "redo restores");
    const snap = h.begin();
    state.annotations[0].text = "changed";
    h.commit();
    ok(h.canUndo(), "commit records gesture");
    h.undo();
    ok(state.annotations[0].text === "one", "undo reverts gesture");
    const before = h.begin();
    state.annotations.push({ id: "a3", page: 0, type: "note", text: "" });
    h.rollback();
    ok(state.annotations.length === 2 && !h.canUndo() === false, "rollback restores snapshot");
    void before;
    void snap;
    h.discard();
    state.annotations = [];
    h.past = [];
    h.future = [];
  }
  const engine = loaded.get("engine.js")?.engine;
  if (engine) {
    for (const fn of ["build", "viewport", "toPage", "toCss", "setToolClass", "relayout", "renderNear", "renderPage", "observe", "updateView", "pageFromEvent", "scrollToPage", "trackCurrent", "thumbInto", "fit", "destroy"]) {
      ok(typeof engine[fn] === "function", `engine.${fn}`);
    }
  }
}

function checkStyles() {
  const css = read(join(ext, "styles/app.css"));
  const base = read(join(ext, "styles/base.css"));
  for (const cls of [
    "text-sel-bar",
    "note-pop",
    "text-editor",
    "tool-palette",
    "insp-card",
    "insp-row",
    "color-btn",
    "toggle",
    "recent-item",
    "note-card",
    "find-hit",
    "thumb",
    "drop-overlay",
    "stage-loading",
    "error-card",
    "menu-pop",
    "shortcut-table",
  ]) {
    ok(css.includes(`.${cls}`) || base.includes(`.${cls}`), `css .${cls}`);
  }
  const bad = [...css.matchAll(/[^-a-z]mid\(/g)];
  ok(bad.length === 0, "no invalid mid() in app.css");
  const braces = (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length;
  ok(braces, "app.css braces balanced");
}

function checkEngineContracts() {
  const engineSrc = read(join(ext, "js/engine.js"));
  ok(engineSrc.includes("getXfaPageViewport") === false, "engine uses loader viewport helper");
  const loaderSrc = read(join(ext, "js/loader.js"));
  ok(loaderSrc.includes("getXfaPageViewport"), "loader patched to getXfaPageViewport");
  ok(loaderSrc.includes("pdf.worker.min.mjs"), "worker wired");
  const viewer = read(join(ext, "viewer.html"));
  ok(viewer.includes('data-tool="select"') && viewer.includes('data-tool="eraser"'), "tool palette present");
  ok(viewer.includes('id="shapeFlyout"'), "shape flyout present");
  const app = read(join(ext, "js/app.js"));
  for (const q of ["pending", "url", "doc", "sample"]) {
    ok(app.includes(`"${q}"`), `route param ${q}`);
  }
}

async function main() {
  checkManifest();
  checkFiles();
  checkPages();
  checkNoCommentsInSource();
  checkWelcomeKeys();
  checkStyles();
  checkEngineContracts();
  const loaded = await checkModuleGraph();
  await checkBehavior(loaded);
  console.log(`\n${passed} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

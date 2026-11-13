import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

export const BASE_SCALE = 96 / 72;
export { pdfjsLib };

const CMAP_URL = new URL("../vendor/pdfjs/cmaps/", import.meta.url).href;
const FONT_URL = new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href;

export function createViewport(width, height, scale, rotation) {
  return pdfjsLib.getXfaPageViewport(
    { attributes: { style: { width: String(width), height: String(height) } } },
    { scale, rotation }
  );
}

export async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 10))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function looksLikePdf(bytes) {
  const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return String.fromCharCode(...head) === "%PDF-";
}

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    image.src = url;
  });
}

export class DocModel {
  constructor({ bytes, name, mime }) {
    this.bytes = bytes;
    this.name = name || "Document";
    this.mime = mime || "";
    this.kind = "pdf";
    this.pageCount = 0;
    this.metas = [];
    this.pdf = null;
    this.bitmap = null;
    this.image = null;
    this.pageCache = new Map();
  }

  async init(onProgress) {
    if (looksLikePdf(this.bytes)) {
      this.kind = "pdf";
      const task = pdfjsLib.getDocument({
        data: new Uint8Array(this.bytes.slice(0)),
        cMapUrl: CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: FONT_URL,
        isEvalSupported: false,
        useSystemFonts: true,
      });
      task.onProgress = ({ loaded, total }) => {
        if (onProgress && total) onProgress(loaded / total);
      };
      this.pdf = await task.promise;
      this.pageCount = this.pdf.numPages;
      for (let index = 0; index < this.pageCount; index += 1) {
        const page = await this.pdf.getPage(index + 1);
        const box = page.view;
        this.metas.push({
          width: box[2] - box[0],
          height: box[3] - box[1],
          rotation: page.rotate || 0,
        });
        this.pageCache.set(index, page);
      }
      return this;
    }

    this.kind = "image";
    const blob = new Blob([this.bytes], { type: this.mime || "image/png" });
    try {
        this.bitmap = await createImageBitmap(blob);
      this.metas = [{ width: this.bitmap.width, height: this.bitmap.height, rotation: 0 }];
    } catch {
      this.image = await imageFromBlob(blob);
      this.metas = [{ width: this.image.naturalWidth, height: this.image.naturalHeight, rotation: 0 }];
    }
    this.pageCount = 1;
    if (onProgress) onProgress(1);
    return this;
  }

  async getPage(index) {
    if (this.kind !== "pdf") return null;
    if (this.pageCache.has(index)) return this.pageCache.get(index);
    const page = await this.pdf.getPage(index + 1);
    this.pageCache.set(index, page);
    return page;
  }

  meta(index) {
    return this.metas[index] || { width: 612, height: 792, rotation: 0 };
  }

  async viewport(index, scale, extraRotation = 0) {
    const meta = this.meta(index);
    if (this.kind === "image") {
      return createViewport(meta.width, meta.height, scale, extraRotation);
    }
    const page = await this.getPage(index);
    return page.getViewport({ scale, rotation: (page.rotate || 0) + extraRotation });
  }

  async render(index, canvas, scale, extraRotation = 0, dpr = 1) {
    const viewport = await this.viewport(index, scale, extraRotation);
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.kind === "pdf") {
      const page = await this.getPage(index);
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      });
      await task.promise;
    } else {
      const source = this.bitmap || this.image;
      const width = this.meta(index).width;
      const height = this.meta(index).height;
      ctx.save();
      ctx.scale(dpr, dpr);
      const rotation = ((extraRotation % 360) + 360) % 360;
      if (rotation === 90) {
        ctx.translate(viewport.width, 0);
        ctx.rotate(Math.PI / 2);
      } else if (rotation === 180) {
        ctx.translate(viewport.width, viewport.height);
        ctx.rotate(Math.PI);
      } else if (rotation === 270) {
        ctx.translate(0, viewport.height);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, width * scale, height * scale);
      ctx.restore();
    }
    return viewport;
  }

  async mountTextLayer(index, container, viewport) {
    if (this.kind !== "pdf") return null;
    container.replaceChildren();
    const page = await this.getPage(index);
    const source = page.streamTextContent({ includeMarkedContent: true, disableNormalization: true });
    const layer = new pdfjsLib.TextLayer({ textContentSource: source, container, viewport });
    await layer.render();
    const end = document.createElement("div");
    end.className = "endOfContent";
    container.append(end);
    return layer;
  }

  async textContent(index) {
    if (this.kind !== "pdf") return "";
    if (!this.textCache) this.textCache = new Map();
    if (this.textCache.has(index)) return this.textCache.get(index);
    const page = await this.getPage(index);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    this.textCache.set(index, text);
    return text;
  }

  async destroy() {
    this.pageCache.clear();
    if (this.pdf) await this.pdf.destroy();
    this.pdf = null;
    this.pageCache = new Map();
  }
}

export async function fetchDocumentBytes(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) throw new Error("Empty file");
  return buffer;
}

export async function buildDocument({ bytes, name, mime, onProgress }) {
  const model = new DocModel({ bytes, name, mime });
  await model.init(onProgress);
  return model;
}

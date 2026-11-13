export function uid(prefix = "a") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}${Date.now().toString(36).slice(-4)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function deepCopy(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)} d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function stripExtension(name) {
  return String(name || "document").replace(/\.[a-z0-9]{1,5}$/i, "");
}

export function fileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || parsed.hostname || "document");
  } catch {
    return "document";
  }
}

export function extensionOf(target) {
  const clean = String(target || "").split(/[?#]/)[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : "";
}

export function isPdfTarget(target) {
  return extensionOf(target) === "pdf";
}

export function isImageTarget(target) {
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(extensionOf(target));
}

export function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const number = parseInt(full, 16);
  return {
    r: ((number >> 16) & 255) / 255,
    g: ((number >> 8) & 255) / 255,
    b: (number & 255) / 255,
    hex: `#${full}`,
  };
}

export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

export function parseFontStack(font) {
  const map = {
    sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"SF Mono", Menlo, Consolas, monospace',
  };
  return map[font] || map.sans;
}

export function downloadName(name, suffix, extension) {
  return `${stripExtension(name)}${suffix}.${extension}`;
}

export function isWebUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "file:", "data:", "blob:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

import { escapeHtml } from "./util.js";

const hasExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;

function viewerUrl(query = "") {
  const base = hasExtension ? chrome.runtime.getURL("viewer.html") : "viewer.html";
  return query ? `${base}?${query}` : base;
}

function navigate(query = "") {
  const url = viewerUrl(query);
  if (hasExtension) chrome.tabs.create({ url });
  else window.location.href = url;
}

document.getElementById("openApp").addEventListener("click", () => navigate());
document.getElementById("openAppTwo").addEventListener("click", () => navigate());
document.getElementById("openSample").addEventListener("click", () => navigate("sample=1"));

const modal = document.getElementById("infoModal");
const modalBody = document.getElementById("modalBody");

const shortcuts = [
  ["Select tool", "V"],
  ["Text highlight", "H"],
  ["Pen", "P"],
  ["Marker", "M"],
  ["Text box", "T"],
  ["Sticky note", "N"],
  ["Rectangle", "R"],
  ["Escape / back to select", "Esc"],
  ["Undo", "Ctrl Z"],
  ["Redo", "Ctrl Shift Z"],
  ["Save annotated PDF", "Ctrl S"],
  ["Find in document", "Ctrl F"],
  ["Zoom in / out", "Ctrl + / −"],
  ["Fit width", "Ctrl 0"],
  ["Delete selection", "Del"],
  ["Next / previous page", "PgDn / PgUp"],
];

function showModal(html) {
  modalBody.innerHTML = html;
  modal.hidden = false;
}

document.getElementById("showShortcuts").addEventListener("click", () => {
  showModal(`
    <h2>Keyboard shortcuts</h2>
    <table class="shortcut-table">
      ${shortcuts
        .map(
          ([label, keys]) =>
            `<tr><td>${escapeHtml(label)}</td><td><kbd>${escapeHtml(keys)}</kbd></td></tr>`
        )
        .join("")}
    </table>
  `);
});

document.getElementById("showAbout").addEventListener("click", () => {
  showModal(`
    <div class="mark about-mark">
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <rect width="128" height="128" rx="30" fill="#1b1f24"/>
        <path d="M29 96V55h22V35h22V15h26v81H29Z" fill="#faf8f3"/>
        <rect x="29" y="100" width="70" height="10" rx="5" fill="#d8482a"/>
      </svg>
    </div>
    <h2>About StepNotate</h2>
    <p>Version 1.0.0 · Made by St3p.</p>
    <p>StepNotate opens PDFs and images in a full markup workspace. Files are read in the browser, annotations are stored in this browser's local database, and exports happen on your machine. There is no account, no tracking and no server to talk to.</p>
    <p>Shared documents and live collaboration are on the way. For now, a project file can be handed to someone else and reopened with Import project.</p>
  `);
});

document.getElementById("closeModal").addEventListener("click", () => (modal.hidden = true));
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") modal.hidden = true;
});

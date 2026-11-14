import { listDocuments, setPending } from "./db.js";
import { escapeHtml, timeAgo, fileNameFromUrl, isPdfTarget, isImageTarget, isWebUrl } from "./util.js";

const hasExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;

const fileInput = document.getElementById("fileInput");
const pickFile = document.getElementById("pickFile");
const toggleLink = document.getElementById("toggleLink");
const linkForm = document.getElementById("linkForm");
const linkInput = document.getElementById("linkInput");
const tabCard = document.getElementById("tabCard");
const tabName = document.getElementById("tabName");
const openTab = document.getElementById("openTab");
const recentList = document.getElementById("recentList");
const recentEmpty = document.getElementById("recentEmpty");
const openLibrary = document.getElementById("openLibrary");
const viewAll = document.getElementById("viewAll");

let tabTarget = "";

function openViewer(query = "") {
  const base = hasExtension ? chrome.runtime.getURL("viewer.html") : "viewer.html";
  const url = query ? `${base}?${query}` : base;
  if (hasExtension) {
    chrome.tabs.create({ url });
    window.close();
  } else {
    window.location.href = url;
  }
}

async function handleFile(file) {
  if (!file) return;
  const bytes = await file.arrayBuffer();
  await setPending({
    id: "pending",
    name: file.name,
    mime: file.type || "application/octet-stream",
    bytes,
    at: Date.now(),
  });
  openViewer("pending=1");
}

pickFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]).catch(() => {}));

toggleLink.addEventListener("click", () => {
  linkForm.hidden = !linkForm.hidden;
  if (!linkForm.hidden) linkInput.focus();
});

linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = linkInput.value.trim();
  if (!isWebUrl(value)) {
    linkInput.focus();
    linkInput.select();
    return;
  }
  openViewer(`url=${encodeURIComponent(value)}`);
});

openTab.addEventListener("click", () => {
  if (tabTarget) openViewer(`url=${encodeURIComponent(tabTarget)}`);
});

openLibrary.addEventListener("click", () => openViewer());
viewAll.addEventListener("click", () => openViewer());

function renderRecent(docs) {
  const items = docs.slice(0, 4);
  recentEmpty.hidden = items.length > 0;
  recentList.innerHTML = items
    .map(
      (doc) => `
      <button class="recent-row" data-id="${escapeHtml(doc.id)}">
        <span class="recent-thumb">${
          doc.thumb
            ? `<img src="${doc.thumb}" alt="">`
            : `${doc.pageCount || 1}p`
        }</span>
        <span class="recent-meta">
          <span class="recent-name">${escapeHtml(doc.name || "Untitled")}</span>
          <span class="recent-sub">${doc.pageCount ? `${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}` : "Document"} · ${timeAgo(doc.openedAt)}</span>
        </span>
      </button>`
    )
    .join("");
  recentList.querySelectorAll(".recent-row").forEach((row) => {
    row.addEventListener("click", () => openViewer(`doc=${encodeURIComponent(row.dataset.id)}`));
  });
}

async function findActiveTab() {
  if (!hasExtension || !chrome.tabs) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  let url = tab.url;
  if (url.startsWith("chrome-extension://") && url.includes("file=")) {
    try {
      url = new URL(url).searchParams.get("file") || "";
    } catch {
      url = "";
    }
  }
  if (!url || (!isPdfTarget(url) && !isImageTarget(url))) return;
  tabTarget = url;
  tabName.textContent = fileNameFromUrl(url);
  tabCard.hidden = false;
}

async function init() {
  try {
    const docs = await listDocuments();
    renderRecent(docs);
  } catch {
    recentEmpty.hidden = false;
  }
  findActiveTab().catch(() => {});
}

init();

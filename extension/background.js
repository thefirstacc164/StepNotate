const LINK_MENU = "stepnotate-link";
const IMAGE_MENU = "stepnotate-image";

function viewerUrl(target) {
  const base = chrome.runtime.getURL("viewer.html");
  return target ? `${base}?url=${encodeURIComponent(target)}` : base;
}

function openViewer(target) {
  chrome.tabs.create({ url: viewerUrl(target) });
}

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LINK_MENU,
      title: "Open link in StepNotate",
      contexts: ["link"],
      targetUrlPatterns: [
        "*://*/*.pdf*",
        "*://*/*.PDF*",
        "*://*/*.png*",
        "*://*/*.jpg*",
        "*://*/*.jpeg*",
        "*://*/*.webp*",
        "*://*/*.gif*"
      ]
    });
    chrome.contextMenus.create({
      id: IMAGE_MENU,
      title: "Open image in StepNotate",
      contexts: ["image"]
    });
    chrome.contextMenus.create({
      id: "stepnotate-open",
      title: "Open StepNotate",
      contexts: ["action"]
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  buildMenus();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === LINK_MENU && info.linkUrl) openViewer(info.linkUrl);
  if (info.menuItemId === IMAGE_MENU && info.srcUrl) openViewer(info.srcUrl);
  if (info.menuItemId === "stepnotate-open") openViewer();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-stepnotate") openViewer();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "open-viewer") {
    openViewer(message.url);
    respond({ ok: true });
  }
  return false;
});

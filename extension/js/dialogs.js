import { escapeHtml } from "./util.js";

const els = {
  root: document.getElementById("modalRoot"),
  veil: document.getElementById("modalVeil"),
  card: document.getElementById("modalCard"),
  title: document.getElementById("modalTitle"),
  body: document.getElementById("modalBody"),
  foot: document.getElementById("modalFoot"),
  close: document.getElementById("modalClose"),
  toasts: document.getElementById("toasts"),
};

let activeClose = null;

function closeModal() {
  els.root.hidden = true;
  els.body.replaceChildren();
  els.foot.replaceChildren();
  els.card.classList.remove("wide");
  activeClose = null;
}

export function openModal({ title, body, actions = [], wide = false, onClose = null }) {
  els.title.textContent = title;
  els.body.innerHTML = typeof body === "string" ? body : "";
  if (body instanceof Node) els.body.append(body);
  els.card.classList.toggle("wide", wide);
  els.foot.replaceChildren();
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = `btn ${action.primary ? "btn-primary" : "btn-ghost"}`;
    btn.textContent = action.label;
    btn.addEventListener("click", async () => {
      const keep = await action.onClick?.();
      if (!keep) closeModal();
    });
    els.foot.append(btn);
  }
  els.root.hidden = false;
  activeClose = onClose;
  return { close: closeModal, body: els.body };
}

els.close.addEventListener("click", () => {
  activeClose?.();
  closeModal();
});
els.veil.addEventListener("click", () => {
  activeClose?.();
  closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.root.hidden) {
    activeClose?.();
    closeModal();
  }
});

export function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind ? `is-${kind}` : ""}`;
  el.innerHTML = `<span class="toast-dot"></span>${escapeHtml(message)}`;
  els.toasts.append(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 300ms ease";
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

export function confirmDialog(title, message, confirmLabel = "Yes") {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      actions: [
        { label: "Cancel", onClick: () => done(false) },
        { label: confirmLabel, primary: true, onClick: () => done(true) },
      ],
      onClose: () => done(false),
    });
    void modal;
  });
}

export function colorPop(anchor, colors, current, onPick) {
  document.querySelectorAll(".color-pop").forEach((el) => el.remove());
  const pop = document.createElement("div");
  pop.className = "color-pop";
  for (const color of colors) {
    const swatch = document.createElement("button");
    swatch.style.background = color;
    swatch.className = color.toLowerCase() === String(current).toLowerCase() ? "is-on" : "";
    if (color.toLowerCase() === "#ffffff" || color.toLowerCase() === "#fff") swatch.style.border = "1px solid var(--line-2)";
    swatch.addEventListener("click", () => {
      pop.remove();
      onPick(color);
    });
    pop.append(swatch);
  }
  document.body.append(pop);
  const box = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = box.left + box.width / 2 - pw / 2;
  let top = box.bottom + 8;
  if (top + ph > window.innerHeight - 8) top = box.top - ph - 8;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  setTimeout(() => {
    const dismiss = (event) => {
      if (!pop.contains(event.target)) {
        pop.remove();
        document.removeEventListener("pointerdown", dismiss, true);
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
  }, 0);
}

export function signaturePad() {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="signature-pad-wrap"><canvas class="signature-pad" width="1000" height="360"></canvas></div>
      <p class="signature-hint">Draw your signature with the mouse. It stays on this device.</p>`;
    const canvas = wrap.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1b1f24";
    let drawing = false;
    let empty = true;
    const point = (event) => {
      const box = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) / box.width) * canvas.width,
        y: ((event.clientY - box.top) / box.height) * canvas.height,
      };
    };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      empty = false;
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      const p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    canvas.addEventListener("pointerup", () => (drawing = false));
    canvas.addEventListener("pointercancel", () => (drawing = false));

    const actions = [
      {
        label: "Clear",
        onClick: () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          empty = true;
          return true;
        },
      },
      {
        label: "Use signature",
        primary: true,
        onClick: () => {
          if (empty) return true;
          resolve(canvas.toDataURL("image/png"));
          return false;
        },
      },
    ];
    openModal({ title: "Draw your signature", body: wrap, actions, onClose: () => resolve(null) });
  });
}

export const $ = (id) => document.getElementById(id);

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

export const formatTime = (value) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString();
}

let previousFocus = null;

export function openModal(title, body) {
  const modal = $("modal");
  previousFocus = document.activeElement;
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  modal.classList.remove("hidden");
  const firstControl = modal.querySelector("input, textarea, select, button:not(.close)");
  (firstControl || modal.querySelector(".close"))?.focus();
}

export function closeModal() {
  $("modal").classList.add("hidden");
  previousFocus?.focus?.();
}

export function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

export function installDialogAccessibility() {
  const modal = $("modal");
  modal.querySelector(".close").addEventListener("click", closeModal);
  modal.addEventListener("mousedown", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (modal.classList.contains("hidden")) return;
    if (event.key === "Escape") closeModal();
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll("button:not([disabled]), input, textarea, select")];
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

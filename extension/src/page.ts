import { applyFill, loginFields, loginMenu, passwordInputs, savePayload } from "./fill";
import type { LoginSummary } from "./protocol";

export type SaveRequest = { url: string; username: string; password: string };

export type Ask = {
  findLogins(url: string): Promise<LoginSummary[]>;
  getLogin(id: string, url: string): Promise<{ username: string; password: string } | null>;
  save(payload: SaveRequest): Promise<void>;
};

const STYLE = `
.quietkeys-fill {
  all: initial;
  position: fixed;
  z-index: 2147483646;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: #45c4ae;
  color: #06201c;
  font: 600 11px/22px system-ui, sans-serif;
  text-align: center;
  cursor: pointer;
}
.quietkeys-menu {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  min-width: 180px;
  max-width: 280px;
  margin: 0;
  padding: 4px;
  border: 1px solid rgba(15, 23, 26, 0.12);
  border-radius: 10px;
  background: #ffffff;
  color: #15191b;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font: 13px/1.3 system-ui, sans-serif;
}
.quietkeys-menu button {
  all: initial;
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  color: #15191b;
  font: 13px/1.3 system-ui, sans-serif;
  text-align: left;
  cursor: pointer;
}
`;

export function mount(
  doc: Document,
  pageUrl: () => string,
  ask: Ask,
  topFrame: boolean,
): () => void {
  if (!topFrame) return () => {};
  ensureStyle(doc);
  const pins: { input: HTMLInputElement; button: HTMLButtonElement }[] = [];
  const seen = new WeakSet<HTMLInputElement>();

  const placeAll = () => {
    for (const pin of pins) {
      if (!pin.input.isConnected) continue;
      place(pin.button, pin.input);
    }
  };

  const scan = () => {
    for (let index = pins.length - 1; index >= 0; index -= 1) {
      const pin = pins[index];
      if (pin.input.isConnected) continue;
      pin.button.remove();
      pins.splice(index, 1);
    }
    for (const input of passwordInputs(doc)) {
      if (seen.has(input)) continue;
      seen.add(input);
      const button = iconButton();
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openMenu(doc, input, button, pageUrl, ask);
      });
      doc.documentElement.append(button);
      pins.push({ input, button });
    }
    placeAll();
  };

  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const payload = savePayload(form, pageUrl());
    if (!payload) return;
    void ask.save(payload);
  };

  const onClick = (event: Event) => {
    const menu = doc.querySelector(".quietkeys-menu");
    if (!menu) return;
    if (event.target instanceof Node && menu.contains(event.target)) return;
    menu.remove();
  };

  scan();
  doc.addEventListener("submit", onSubmit, true);
  doc.addEventListener("click", onClick);
  const view = doc.defaultView;
  view?.addEventListener("scroll", placeAll, true);
  view?.addEventListener("resize", placeAll);
  const observer = new MutationObserver(scan);
  observer.observe(doc.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    doc.removeEventListener("submit", onSubmit, true);
    doc.removeEventListener("click", onClick);
    view?.removeEventListener("scroll", placeAll, true);
    view?.removeEventListener("resize", placeAll);
    for (const pin of pins) pin.button.remove();
    doc.getElementById("quietkeys-style")?.remove();
    doc.querySelector(".quietkeys-menu")?.remove();
  };
}

async function openMenu(
  doc: Document,
  input: HTMLInputElement,
  button: HTMLButtonElement,
  pageUrl: () => string,
  ask: Ask,
) {
  const url = pageUrl();
  doc.querySelector(".quietkeys-menu")?.remove();
  const logins = await ask.findLogins(url);
  if (logins.length === 0) return;
  const menu = loginMenu(logins, (id) => {
    menu.remove();
    void fillChoice(doc, input, url, id, ask);
  });
  doc.documentElement.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 200)}px`;
}

async function fillChoice(
  doc: Document,
  input: HTMLInputElement,
  url: string,
  id: string,
  ask: Ask,
) {
  const secret = await ask.getLogin(id, url);
  if (!secret) return;
  applyFill(url, true, loginFields(doc, input), {
    username: secret.username,
    password: secret.password,
    url,
  });
}

function ensureStyle(doc: Document) {
  if (doc.getElementById("quietkeys-style")) return;
  const style = doc.createElement("style");
  style.id = "quietkeys-style";
  style.textContent = STYLE;
  doc.documentElement.append(style);
}

function iconButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quietkeys-fill";
  button.setAttribute("aria-label", "Fill from quietkeys");
  button.textContent = "qk";
  return button;
}

function place(button: HTMLButtonElement, input: HTMLInputElement) {
  const rect = input.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.style.top = `${rect.top + Math.max(0, (rect.height - 22) / 2)}px`;
  button.style.left = `${rect.right - 26}px`;
}

import { isRecord, type LoginSummary } from "./protocol";

export type FillRequest = { username: string; password: string; url: string };
export type SavePayload = { url: string; username: string; password: string };
export type LoginFields = { username: HTMLInputElement | null; password: HTMLInputElement | null };

const USERNAME_TYPES = new Set(["text", "email", "tel", ""]);

export function pageAcceptsFill(pageHref: string, authorizedUrl: string): boolean {
  const page = httpOrigin(pageHref);
  const authorized = httpOrigin(authorizedUrl);
  return page !== null && page === authorized;
}

export function passwordInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll("input")].filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && element.type === "password" && !element.disabled,
  );
}

export function loginFields(
  root: ParentNode,
  password: HTMLInputElement | null = null,
): LoginFields {
  const chosen = password ?? choosePassword(root);
  if (!chosen) return { username: null, password: null };
  const scope: ParentNode = chosen.form ?? root;
  const candidates = [...scope.querySelectorAll("input")].filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && isUsernameField(element) && element !== chosen,
  );
  const preferred = candidates.find((element) =>
    /username|email/.test(element.autocomplete.toLowerCase()),
  );
  return { username: preferred ?? candidates[0] ?? null, password: chosen };
}

export function applyFill(
  pageHref: string,
  topFrame: boolean,
  fields: LoginFields,
  request: FillRequest,
): boolean {
  if (!topFrame || !pageAcceptsFill(pageHref, request.url)) return false;
  if (!fields.password?.isConnected) return false;
  writeInput(fields.password, request.password);
  if (fields.username?.isConnected) writeInput(fields.username, request.username);
  return true;
}

export function savePayload(form: HTMLFormElement, pageUrl: string): SavePayload | null {
  const fields = loginFields(form);
  if (!fields.password || fields.password.value.length === 0) return null;
  if (!httpOrigin(pageUrl)) return null;
  return {
    url: pageUrl,
    username: fields.username?.value ?? "",
    password: fields.password.value,
  };
}

export function loginMenu(logins: LoginSummary[], onChoose: (id: string) => void): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "quietkeys-menu";
  menu.setAttribute("role", "menu");
  for (const login of logins) {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.textContent = loginLabel(login);
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onChoose(login.id);
    });
    menu.append(item);
  }
  return menu;
}

export function fillMessage(message: unknown): FillRequest | null {
  if (!isRecord(message) || message.type !== "fill") return null;
  if (
    typeof message.username !== "string" ||
    typeof message.password !== "string" ||
    typeof message.url !== "string"
  ) {
    return null;
  }
  return { username: message.username, password: message.password, url: message.url };
}

function choosePassword(root: ParentNode): HTMLInputElement | null {
  const fields = passwordInputs(root);
  return (
    fields.find((element) => element.autocomplete.toLowerCase() === "new-password") ??
    fields[0] ??
    null
  );
}

function isUsernameField(element: HTMLInputElement): boolean {
  if (element.disabled || element.readOnly || !USERNAME_TYPES.has(element.type)) return false;
  const hint = `${element.autocomplete} ${element.name} ${element.id} ${element.getAttribute("aria-label") ?? ""}`;
  return !/search|otp|totp|one-time|captcha/i.test(hint);
}

function writeInput(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function httpOrigin(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function loginLabel(login: LoginSummary): string {
  const title = login.title.slice(0, 200);
  const username = login.username.slice(0, 200);
  return username ? `${title} — ${username}` : title;
}

import { pageAcceptsFill } from "./fill";
import {
  explain,
  isRecord,
  pairRequest,
  type ConnectionState,
  type LoginSummary,
} from "./protocol";

export type PopupModel =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "unsupported" }
  | { kind: "pair"; message: string | null }
  | { kind: "locked" }
  | { kind: "logins"; host: string; logins: LoginSummary[] };

export type PopupActions = {
  pair: (code: string) => void;
  fill: (id: string) => void;
  forget: () => void;
};

export function viewModel(input: {
  status: ConnectionState;
  url: string | null;
  logins: LoginSummary[];
  pairMessage: string | null;
}): PopupModel {
  if (input.status === "unavailable") return { kind: "unavailable" };
  if (input.status === "not_paired") return { kind: "pair", message: input.pairMessage };
  if (input.status === "locked") return { kind: "locked" };
  if (!input.url || !pageAcceptsFill(input.url, input.url)) return { kind: "unsupported" };
  return { kind: "logins", host: new URL(input.url).host, logins: input.logins };
}

export function renderPopup(root: HTMLElement, model: PopupModel, actions: PopupActions) {
  const main = document.createElement("main");
  const title = document.createElement("h1");
  title.textContent = "quietkeys";
  main.append(title);

  if (model.kind === "loading") {
    main.append(paragraph("Checking quietkeys…"));
  } else if (model.kind === "unavailable") {
    main.append(paragraph("Open quietkeys on this computer."));
  } else if (model.kind === "pair") {
    main.append(pairForm(model.message, actions));
  } else if (model.kind === "locked") {
    main.append(paragraph("Unlock quietkeys on this computer."));
    main.append(forgetButton(actions));
  } else if (model.kind === "unsupported") {
    main.append(paragraph("Open a login page to fill it."));
    main.append(forgetButton(actions));
  } else {
    main.append(loginList(model.host, model.logins, actions));
    main.append(paragraph("New logins are confirmed in the app."));
    main.append(forgetButton(actions));
  }

  root.replaceChildren(main);
}

function pairForm(message: string | null, actions: PopupActions): HTMLElement {
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Pairing code";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 7;
  input.setAttribute("aria-label", "Pairing code");
  label.append(input);
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Pair";
  form.append(label, button);
  if (message) form.append(paragraph(message));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    actions.pair(input.value);
  });
  return form;
}

function loginList(host: string, logins: LoginSummary[], actions: PopupActions): HTMLElement {
  const section = document.createElement("section");
  if (logins.length === 0) {
    section.append(paragraph(`No logins for ${host}`));
    return section;
  }
  const list = document.createElement("ul");
  for (const login of logins) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = login.username ? `${login.title} — ${login.username}` : login.title;
    button.addEventListener("click", () => actions.fill(login.id));
    item.append(button);
    list.append(item);
  }
  section.append(list);
  return section;
}

function forgetButton(actions: PopupActions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiet";
  button.textContent = "Forget this browser";
  button.addEventListener("click", () => actions.forget());
  return button;
}

function paragraph(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

async function startPopup(root: HTMLElement) {
  let pairMessage: string | null = null;
  const redraw = (model: PopupModel) => renderPopup(root, model, actions);
  const actions: PopupActions = {
    pair(code) {
      const request = pairRequest(code);
      if (!request) {
        pairMessage = "Enter the 6-digit code from quietkeys.";
        void refresh();
        return;
      }
      void chrome.runtime.sendMessage({ type: "pair", code: request.code }).then((response) => {
        pairMessage = errorText(response);
        void refresh();
      });
    },
    fill(id) {
      void fillLogin(id);
    },
    forget() {
      void chrome.runtime.sendMessage({ type: "forget" }).then(() => {
        pairMessage = null;
        void refresh();
      });
    },
  };

  async function refresh() {
    redraw({ kind: "loading" });
    let status: ConnectionState = "unavailable";
    try {
      const response = await chrome.runtime.sendMessage({ type: "status" });
      if (isStatus(response)) status = response.status;
    } catch {
      status = "unavailable";
    }
    const url = await activeUrl();
    let logins: LoginSummary[] = [];
    if (status === "unlocked" && url && pageAcceptsFill(url, url)) {
      try {
        const response = await chrome.runtime.sendMessage({ type: "find_logins", url });
        if (isLogins(response)) logins = response.logins;
        else if (isError(response, "locked")) status = "locked";
      } catch {
        status = "unavailable";
      }
    }
    redraw(viewModel({ status, url, logins, pairMessage }));
  }

  async function fillLogin(id: string) {
    const tab = await activeTab();
    if (!tab?.id || !tab.url) return;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "get_login",
        id,
        url: tab.url,
      });
      if (!isSecret(response)) return;
      await chrome.tabs.sendMessage(tab.id, {
        type: "fill",
        username: response.username,
        password: response.password,
        url: tab.url,
      });
      window.close();
    } catch {
      redraw({ kind: "unavailable" });
    }
  }

  redraw({ kind: "loading" });
  await refresh();
}

async function activeTab(): Promise<{ id?: number; url?: string } | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function activeUrl(): Promise<string | null> {
  const tab = await activeTab();
  return tab?.url ?? null;
}

function isStatus(value: unknown): value is { status: ConnectionState } {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  const status = value.status;
  return (
    status === "locked" ||
    status === "unlocked" ||
    status === "not_paired" ||
    status === "unavailable"
  );
}

function isLogins(value: unknown): value is { logins: LoginSummary[] } {
  if (!isRecord(value) || !Array.isArray(value.logins)) return false;
  return value.logins.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.username === "string",
  );
}

function isSecret(value: unknown): value is { username: string; password: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "username" in value &&
    "password" in value &&
    typeof value.username === "string" &&
    typeof value.password === "string"
  );
}

function isError(value: unknown, kind: string): boolean {
  return !!value && typeof value === "object" && "error" in value && value.error === kind;
}

function errorText(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" ? explain(value.error) : null;
}

if (typeof chrome !== "undefined") {
  const root = document.querySelector("#app");
  if (root instanceof HTMLElement) void startPopup(root);
}

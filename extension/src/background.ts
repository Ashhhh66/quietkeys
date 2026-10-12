import {
  connectionState,
  errorKind,
  findLoginsRequest,
  fitsHostMessage,
  getLoginRequest,
  isRecord,
  loginsFrom,
  NATIVE_HOST_NAME,
  pairingToken,
  pairRequest,
  saveLoginRequest,
  secretFrom,
  statusRequest,
  usableToken,
  type HostRequest,
} from "./protocol";

export const TOKEN_KEY = "pairingToken";

export type HostTransport = (message: HostRequest) => Promise<unknown>;

export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
};

export async function handleExtensionMessage(
  message: unknown,
  host: HostTransport,
  tokens: TokenStore,
): Promise<unknown> {
  if (!isMessage(message)) return { error: "rejected" };
  const raw = await tokens.get();
  const stored = usableToken(raw);
  if (raw && !stored) await tokens.set(null);

  switch (message.type) {
    case "status":
      return reportStatus(stored, host, tokens);
    case "pair":
      return pair(message.code, host, tokens);
    case "forget":
      await tokens.set(null);
      return { status: "not_paired" };
    case "find_logins":
      return findLogins(stored, message.url, host, tokens);
    case "get_login":
      return getLogin(stored, message.id, message.url, host, tokens);
    case "save":
      return save(stored, message, host, tokens);
    default:
      return { error: "rejected" };
  }
}

async function reportStatus(token: string | null, host: HostTransport, tokens: TokenStore) {
  const request = statusRequest(token);
  if (!fitsHostMessage(request)) return { status: "unavailable" };
  const response = await host(request);
  const state = connectionState(response) ?? "unavailable";
  if (state === "not_paired" && token) await tokens.set(null);
  return { status: state };
}

async function pair(code: unknown, host: HostTransport, tokens: TokenStore) {
  if (typeof code !== "string") return { error: "rejected" };
  const request = pairRequest(code);
  if (!request || !fitsHostMessage(request)) return { error: "rejected" };
  const response = await host(request);
  const token = pairingToken(response);
  if (!token) return { error: errorKind(response) ?? "rejected" };
  await tokens.set(token);
  return { status: "unlocked" };
}

async function findLogins(
  token: string | null,
  url: unknown,
  host: HostTransport,
  tokens: TokenStore,
) {
  if (!token) return { error: "not_paired" };
  if (typeof url !== "string") return { error: "rejected" };
  const request = findLoginsRequest(token, url);
  if (!fitsHostMessage(request)) return { error: "rejected" };
  const response = await host(request);
  const error = errorKind(response);
  if (error === "not_paired") await tokens.set(null);
  if (error) return { error };
  return { logins: loginsFrom(response) };
}

async function getLogin(
  token: string | null,
  id: unknown,
  url: unknown,
  host: HostTransport,
  tokens: TokenStore,
) {
  if (!token) return { error: "not_paired" };
  if (typeof id !== "string" || typeof url !== "string") return { error: "rejected" };
  const request = getLoginRequest(token, id, url);
  if (!fitsHostMessage(request)) return { error: "rejected" };
  const response = await host(request);
  const error = errorKind(response);
  if (error === "not_paired") await tokens.set(null);
  if (error) return { error };
  const secret = secretFrom(response);
  if (!secret) return { error: "rejected" };
  return secret;
}

async function save(
  token: string | null,
  message: Record<string, unknown>,
  host: HostTransport,
  tokens: TokenStore,
) {
  if (!token) return { error: "not_paired" };
  const { url, username, password } = message;
  if (typeof url !== "string" || typeof username !== "string" || typeof password !== "string") {
    return { error: "rejected" };
  }
  if (username.length > 512 || password.length > 4096) return { error: "rejected" };
  const request = saveLoginRequest(token, url, username, password);
  if (!fitsHostMessage(request)) return { error: "rejected" };
  const response = await host(request);
  const error = errorKind(response);
  if (error === "not_paired") await tokens.set(null);
  if (error) return { error };
  if (isRecord(response) && response.status === "pending") return { status: "pending" };
  return { error: "rejected" };
}

function isMessage(value: unknown): value is Record<string, unknown> & { type: string } {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

function hostTransport(message: HostRequest): Promise<unknown> {
  return new Promise((resolve) => {
    let port: ReturnType<typeof chrome.runtime.connectNative> | null = null;
    let settled = false;
    let timer = 0;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
      try {
        port?.disconnect();
      } catch {
        // The host has already gone.
      }
    };
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch {
      resolve({ error: "unavailable" });
      return;
    }
    timer = setTimeout(() => finish({ error: "unavailable" }), 8000);
    port.onMessage.addListener((response) => finish(response));
    port.onDisconnect.addListener(() => finish({ error: "unavailable" }));
    try {
      port.postMessage(message);
    } catch {
      finish({ error: "unavailable" });
    }
  });
}

const chromeTokens: TokenStore = {
  async get() {
    const stored = await chrome.storage.local.get(TOKEN_KEY);
    const value = stored[TOKEN_KEY];
    return typeof value === "string" ? value : null;
  },
  async set(token) {
    if (token) await chrome.storage.local.set({ [TOKEN_KEY]: token });
    else await chrome.storage.local.remove(TOKEN_KEY);
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void sender;
    void handleExtensionMessage(message, hostTransport, chromeTokens).then(sendResponse);
    return true;
  });
}

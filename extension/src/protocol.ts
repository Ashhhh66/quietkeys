export const NATIVE_HOST_NAME = "com.quietkeys.native_host";
export const MAX_HOST_MESSAGE = 64 * 1024;

export type HostRequest =
  | { type: "status"; token?: string }
  | { type: "pair"; code: string }
  | { type: "find_logins"; token: string; url: string }
  | { type: "get_login"; token: string; id: string; url: string }
  | { type: "save_login"; token: string; url: string; username: string; password: string };

export type LoginSummary = { id: string; title: string; username: string };

export type ConnectionState = "locked" | "unlocked" | "not_paired" | "unavailable";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fitsHostMessage(message: HostRequest): boolean {
  return new TextEncoder().encode(JSON.stringify(message)).length <= MAX_HOST_MESSAGE;
}

export function usableToken(value: string | null): string | null {
  if (!value || value.length > 64 || !/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  return value;
}

export function pairRequest(code: string): Extract<HostRequest, { type: "pair" }> | null {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  return { type: "pair", code: digits };
}

export function statusRequest(token: string | null): HostRequest {
  return token ? { type: "status", token } : { type: "status" };
}

export function findLoginsRequest(token: string, url: string): HostRequest {
  return { type: "find_logins", token, url };
}

export function getLoginRequest(token: string, id: string, url: string): HostRequest {
  return { type: "get_login", token, id, url };
}

export function saveLoginRequest(
  token: string,
  url: string,
  username: string,
  password: string,
): HostRequest {
  return { type: "save_login", token, url, username, password };
}

export function connectionState(response: unknown): ConnectionState | null {
  if (!isRecord(response) || typeof response.status !== "string") return null;
  if (
    response.status === "locked" ||
    response.status === "unlocked" ||
    response.status === "not_paired"
  ) {
    return response.status;
  }
  return null;
}

export function errorKind(response: unknown): string | null {
  if (!isRecord(response) || typeof response.error !== "string") return null;
  return response.error;
}

export function explain(error: string | null): string | null {
  switch (error) {
    case "locked":
      return "Unlock quietkeys on this computer.";
    case "rejected":
      return "quietkeys refused that request.";
    case "unavailable":
      return "Open quietkeys on this computer.";
    default:
      return null;
  }
}

export function loginsFrom(response: unknown): LoginSummary[] {
  if (!isRecord(response) || !Array.isArray(response.logins)) return [];
  const logins: LoginSummary[] = [];
  for (const item of response.logins) {
    if (!isRecord(item)) continue;
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.username !== "string"
    ) {
      continue;
    }
    logins.push({ id: item.id, title: item.title, username: item.username });
  }
  return logins.slice(0, 50);
}

export function secretFrom(response: unknown): { username: string; password: string } | null {
  if (!isRecord(response) || typeof response.error === "string") return null;
  if (typeof response.username !== "string" || typeof response.password !== "string") return null;
  return { username: response.username, password: response.password };
}

export function pairingToken(response: unknown): string | null {
  if (!isRecord(response) || typeof response.token !== "string") return null;
  return usableToken(response.token);
}

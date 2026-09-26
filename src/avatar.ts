import type { Theme } from "./theme";

// Letter avatars are generated locally from the entry itself; nothing (favicons or
// otherwise) is ever fetched from the network.

export interface AvatarColors {
  bg: string;
  fg: string;
}

export const DARK_AVATAR_PALETTE: readonly AvatarColors[] = [
  { bg: "#24406A", fg: "#DCE8FA" },
  { bg: "#6E4318", fg: "#FBE6CF" },
  { bg: "#1D564E", fg: "#D2F2EC" },
  { bg: "#553670", fg: "#EEDDFB" },
  { bg: "#662C37", fg: "#FADDE2" },
  { bg: "#4A5320", fg: "#EEF3D2" },
];

export const LIGHT_AVATAR_PALETTE: readonly AvatarColors[] = [
  { bg: "#DCE7F8", fg: "#1E3A66" },
  { bg: "#F8E4CD", fg: "#6B3F10" },
  { bg: "#D3EFE9", fg: "#15524A" },
  { bg: "#EADDF7", fg: "#4A2C66" },
  { bg: "#F7DCE1", fg: "#6A2433" },
  { bg: "#E8EDCF", fg: "#434A16" },
];

export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** The host name of `url` without a leading "www.", or "" if it has none. */
export function domainOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const host = new URL(candidate).hostname;
      if (host) return host.replace(/^www\./, "");
    } catch {
      // Not a URL as written; try again with a scheme.
    }
  }
  return trimmed;
}

export function avatarLetter(title: string): string {
  const first = [...title.trim()][0];
  return first ? first.toUpperCase() : "?";
}

export function avatarIndex(title: string, url: string): number {
  return hashString(domainOf(url) || title) % 6;
}

export function avatarColors(title: string, url: string, theme: Theme): AvatarColors {
  const palette = theme === "light" ? LIGHT_AVATAR_PALETTE : DARK_AVATAR_PALETTE;
  return palette[avatarIndex(title, url)];
}

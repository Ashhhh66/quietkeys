import { describe, expect, it } from "vitest";
import {
  DARK_AVATAR_PALETTE,
  LIGHT_AVATAR_PALETTE,
  avatarColors,
  avatarIndex,
  avatarLetter,
  domainOf,
  hashString,
} from "./avatar";

describe("avatar", () => {
  it("hashes with h = (h * 31 + charCode) >>> 0", () => {
    expect(hashString("")).toBe(0);
    expect(hashString("a")).toBe(97);
    expect(hashString("ab")).toBe(97 * 31 + 98);
    // Same as Java's String.hashCode for "github.com", read as unsigned 32-bit.
    expect(hashString("github.com")).toBe(1985010934);
    expect(hashString("github.com") % 6).toBe(4);
  });

  it("stays within 32 bits for long input", () => {
    const h = hashString("x".repeat(1000));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it("hashes the domain when there is a URL, otherwise the title", () => {
    expect(domainOf("https://www.github.com/login")).toBe("github.com");
    expect(domainOf("bank.example.com")).toBe("bank.example.com");
    expect(domainOf("")).toBe("");
    expect(avatarIndex("GitHub", "https://github.com")).toBe(hashString("github.com") % 6);
    expect(avatarIndex("Some Title", "")).toBe(hashString("Some Title") % 6);
  });

  it("picks the palette for the current theme", () => {
    const index = avatarIndex("GitHub", "https://github.com");
    expect(avatarColors("GitHub", "https://github.com", "dark")).toBe(DARK_AVATAR_PALETTE[index]);
    expect(avatarColors("GitHub", "https://github.com", "light")).toBe(LIGHT_AVATAR_PALETTE[index]);
  });

  it("uses the first character of the title, uppercased", () => {
    expect(avatarLetter("github")).toBe("G");
    expect(avatarLetter("  émail")).toBe("É");
    expect(avatarLetter("")).toBe("?");
  });
});

import { describe, expect, it } from "vitest";
import { checkNewMasterPassword, countChars, normalizeMasterPassword } from "./masterPassword";

// These cases intentionally mirror the Rust tests in src-tauri/src/crypto.rs
// (composed_and_decomposed_accents_derive_the_same_key, every_space_separator_maps_to_ascii_space)
// and src-tauri/src/vault.rs (master_password_length_is_counted_after_normalization,
// new_master_password_with_control_character_is_rejected), so the two implementations
// are checked against the same examples.

describe("normalizeMasterPassword", () => {
  it("maps a composed accent and a decomposed accent to the same text", () => {
    // é as one code point (U+00E9) vs e + combining acute accent (U+0301).
    expect(normalizeMasterPassword("caf\u00e9")).toBe(normalizeMasterPassword("cafe\u0301"));
    expect(normalizeMasterPassword("cafe\u0301")).toBe("caf\u00e9");
  });

  it("maps a non-breaking space to a normal space, and vice versa", () => {
    expect(normalizeMasterPassword("a\u00a0b")).toBe("a b");
    expect(normalizeMasterPassword("a\u00a0b")).toBe(normalizeMasterPassword("a b"));
  });

  it("maps every Unicode space separator to a normal space", () => {
    const spaceSeparators = [
      "\u0020",
      "\u00a0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200a",
      "\u202f",
      "\u205f",
      "\u3000",
    ];
    for (const space of spaceSeparators) {
      expect(normalizeMasterPassword(`a${space}b`)).toBe("a b");
    }
  });

  it("does not touch other whitespace, such as tabs and newlines", () => {
    for (const c of ["\t", "\n", "\u2028", "\u200b"]) {
      expect(normalizeMasterPassword(`a${c}b`)).toBe(`a${c}b`);
    }
  });
});

describe("checkNewMasterPassword", () => {
  it("counts length after normalization, not before", () => {
    // 22 code points, but 11 characters once each e + accent is composed.
    const elevenDecomposed = "e\u0301".repeat(11);
    expect(checkNewMasterPassword(elevenDecomposed)).toEqual({
      ok: false,
      kind: "password_too_short",
      message: "The master password must be at least 12 characters long",
    });

    const twelveDecomposed = "e\u0301".repeat(12);
    expect(checkNewMasterPassword(twelveDecomposed)).toEqual({ ok: true });
  });

  it("rejects control characters", () => {
    const cases = [
      "correct horse\tbattery",
      "correct horse\nbattery",
      "correct horse battery\u007f",
      "\u0000correct horse battery",
      "correct horse\u0085battery",
    ];
    for (const password of cases) {
      expect(checkNewMasterPassword(password)).toEqual({
        ok: false,
        kind: "password_has_control_character",
        message:
          "The master password cannot contain control characters such as tabs or line breaks",
      });
    }
  });

  it("checks control characters before length", () => {
    // Short AND contains a control character: control-character error wins, matching
    // check_new_master_password's order in Rust.
    expect(checkNewMasterPassword("a\tb")).toEqual({
      ok: false,
      kind: "password_has_control_character",
      message: "The master password cannot contain control characters such as tabs or line breaks",
    });
  });

  it("accepts a normal password of at least 12 characters", () => {
    expect(checkNewMasterPassword("correct horse battery staple")).toEqual({
      ok: true,
    });
    expect(checkNewMasterPassword("a".repeat(12))).toEqual({ ok: true });
    expect(checkNewMasterPassword("a".repeat(11))).toEqual({
      ok: false,
      kind: "password_too_short",
      message: "The master password must be at least 12 characters long",
    });
  });
});

describe("countChars", () => {
  it("counts Unicode code points, not UTF-16 code units", () => {
    expect(countChars("é")).toBe(1);
    expect(countChars("🔑")).toBe(1); // outside the BMP: 2 UTF-16 units, 1 code point
    expect(countChars("abc")).toBe(3);
  });
});

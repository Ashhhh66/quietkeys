import { describe, expect, it } from "vitest";
import { handleExtensionMessage, type HostTransport, type TokenStore } from "./background";
import type { HostRequest } from "./protocol";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function store(initial: string | null): TokenStore & { writes: Array<string | null> } {
  let current = initial;
  const writes: Array<string | null> = [];
  return {
    writes,
    async get() {
      return current;
    },
    async set(token) {
      current = token;
      writes.push(token);
    },
  };
}

describe("the extension background", () => {
  it("stores the pairing token and does not return it", async () => {
    const tokens = store(null);
    let seen: HostRequest | null = null;
    const host: HostTransport = async (message) => {
      seen = message;
      return { token: TOKEN, password: "should-not-stick" };
    };
    const response = await handleExtensionMessage({ type: "pair", code: "482913" }, host, tokens);
    expect(seen).toEqual({ type: "pair", code: "482913" });
    expect(tokens.writes).toEqual([TOKEN]);
    expect(response).toEqual({ status: "unlocked" });
    expect(JSON.stringify(response)).not.toContain(TOKEN);
    expect(JSON.stringify(response)).not.toContain("should-not-stick");
  });

  it("does not call the app for a bad code", async () => {
    const tokens = store(null);
    const host: HostTransport = async () => {
      throw new Error("host should not be called");
    };
    expect(await handleExtensionMessage({ type: "pair", code: "nope" }, host, tokens)).toEqual({
      error: "rejected",
    });
    expect(tokens.writes).toEqual([]);
  });

  it("forwards a save without remembering the password", async () => {
    const tokens = store(TOKEN);
    let seen: HostRequest | null = null;
    const host: HostTransport = async (message) => {
      seen = message;
      return { status: "pending", password: "super-secret-password-value" };
    };
    const response = await handleExtensionMessage(
      {
        type: "save",
        url: "https://example.com/login",
        username: "ada",
        password: "super-secret-password-value",
        notes: "whole page dump",
      },
      host,
      tokens,
    );
    expect(seen).toEqual({
      type: "save_login",
      token: TOKEN,
      url: "https://example.com/login",
      username: "ada",
      password: "super-secret-password-value",
    });
    expect(response).toEqual({ status: "pending" });
    expect(JSON.stringify(response)).not.toContain("super-secret-password-value");
    expect(tokens.writes).toEqual([]);
  });

  it("does not send a save when the browser is not paired", async () => {
    const tokens = store(null);
    const host: HostTransport = async () => {
      throw new Error("host should not be called");
    };
    const response = await handleExtensionMessage(
      { type: "save", url: "https://example.com", username: "ada", password: "secret" },
      host,
      tokens,
    );
    expect(response).toEqual({ error: "not_paired" });
  });

  it("keeps an http url unchanged and strips passwords from the list", async () => {
    const tokens = store(TOKEN);
    let seen: HostRequest | null = null;
    const host: HostTransport = async (message) => {
      seen = message;
      return {
        logins: [{ id: "1", title: "Local", username: "root", password: "http-only-secret" }],
      };
    };
    const response = await handleExtensionMessage(
      { type: "find_logins", url: "http://127.0.0.1/login" },
      host,
      tokens,
    );
    expect(seen).toEqual({
      type: "find_logins",
      token: TOKEN,
      url: "http://127.0.0.1/login",
    });
    expect(response).toEqual({ logins: [{ id: "1", title: "Local", username: "root" }] });
    expect(JSON.stringify(response)).not.toContain("http-only-secret");
  });

  it("returns a password for one login and drops anything else", async () => {
    const tokens = store(TOKEN);
    const host: HostTransport = async () => ({
      username: "ada",
      password: "secret",
      notes: "page body",
    });
    const response = await handleExtensionMessage(
      { type: "get_login", id: "1", url: "https://example.com/login" },
      host,
      tokens,
    );
    expect(response).toEqual({ username: "ada", password: "secret" });
  });

  it("clears the token when the app says the browser is no longer paired", async () => {
    const tokens = store(TOKEN);
    const host: HostTransport = async () => ({ status: "not_paired" });
    expect(await handleExtensionMessage({ type: "status" }, host, tokens)).toEqual({
      status: "not_paired",
    });
    expect(tokens.writes).toEqual([null]);
  });

  it("keeps the token while the vault is locked", async () => {
    const tokens = store(TOKEN);
    const host: HostTransport = async () => ({ status: "locked" });
    expect(await handleExtensionMessage({ type: "status" }, host, tokens)).toEqual({
      status: "locked",
    });
    expect(tokens.writes).toEqual([]);
  });

  it("forgets the browser locally", async () => {
    const tokens = store(TOKEN);
    const host: HostTransport = async () => {
      throw new Error("host should not be called");
    };
    expect(await handleExtensionMessage({ type: "forget" }, host, tokens)).toEqual({
      status: "not_paired",
    });
    expect(tokens.writes).toEqual([null]);
  });
});

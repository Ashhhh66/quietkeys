import { describe, expect, it } from "vitest";
import {
  findLoginsRequest,
  fitsHostMessage,
  getLoginRequest,
  loginsFrom,
  pairRequest,
  pairingToken,
  saveLoginRequest,
  secretFrom,
  statusRequest,
} from "./protocol";

describe("host messages", () => {
  it("sends a 6-digit pairing code and nothing else", () => {
    expect(pairRequest("482 913")).toEqual({ type: "pair", code: "482913" });
    expect(pairRequest("12345")).toBeNull();
    expect(pairRequest("1234567")).toBeNull();
    expect(pairRequest("abcdef")).toBeNull();
  });

  it("omits the token from status until one exists", () => {
    expect(statusRequest(null)).toEqual({ type: "status" });
    expect(Object.keys(statusRequest("token"))).toEqual(["type", "token"]);
  });

  it("asks for logins with the page url and no password", () => {
    const message = findLoginsRequest("token", "http://example.com/login");
    expect(message).toEqual({
      type: "find_logins",
      token: "token",
      url: "http://example.com/login",
    });
    expect(Object.keys(message)).toEqual(["type", "token", "url"]);
  });

  it("saves only the url, username, and password", () => {
    const message = saveLoginRequest("token", "https://example.com/login", "ada", "from-the-field");
    expect(message).toEqual({
      type: "save_login",
      token: "token",
      url: "https://example.com/login",
      username: "ada",
      password: "from-the-field",
    });
    expect(Object.keys(message).sort()).toEqual(["password", "token", "type", "url", "username"]);
  });

  it("drops a password that arrived with the login list", () => {
    const logins = loginsFrom({
      logins: [
        { id: "1", title: "Mail", username: "ada", password: "fixture-mail-secret" },
        { id: "2", title: "Only title" },
      ],
    });
    expect(logins).toEqual([{ id: "1", title: "Mail", username: "ada" }]);
    expect(JSON.stringify(logins)).not.toContain("fixture-mail-secret");
  });

  it("reads a password only from a login response", () => {
    expect(secretFrom({ username: "ada", password: "secret", notes: "page body" })).toEqual({
      username: "ada",
      password: "secret",
    });
    expect(Object.keys(secretFrom({ username: "ada", password: "secret" }) ?? {})).toEqual([
      "username",
      "password",
    ]);
    expect(secretFrom({ error: "rejected", password: "secret" })).toBeNull();
  });

  it("stores a pairing token only when it looks like one", () => {
    const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(pairingToken({ token, password: "nope" })).toBe(token);
    expect(pairingToken({ token: "not a token" })).toBeNull();
    expect(pairingToken({ error: "rejected" })).toBeNull();
  });

  it("refuses a message bigger than the host accepts", () => {
    const message = getLoginRequest("token", "id", "https://example.com");
    expect(fitsHostMessage(message)).toBe(true);
    expect(
      fitsHostMessage(saveLoginRequest("token", "https://example.com", "ada", "x".repeat(70_000))),
    ).toBe(false);
  });
});

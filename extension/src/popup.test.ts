import { describe, expect, it } from "vitest";
import { renderPopup, viewModel, type PopupActions } from "./popup";

const actions: PopupActions = { pair() {}, fill() {}, forget() {} };

describe("the popup", () => {
  it("asks for a pairing code before it knows the browser", () => {
    expect(
      viewModel({
        status: "not_paired",
        url: "https://example.com",
        logins: [],
        pairMessage: null,
      }),
    ).toEqual({ kind: "pair", message: null });
    const root = document.createElement("div");
    renderPopup(root, { kind: "pair", message: null }, actions);
    expect(root.querySelector("[aria-label='Pairing code']")).toBeTruthy();
    expect(root.querySelector("input[type=password]")).toBeNull();
    expect(root.textContent).toContain("Pair");
  });

  it("shows matching logins and not a password", () => {
    const model = viewModel({
      status: "unlocked",
      url: "https://accounts.google.com/login",
      logins: [{ id: "1", title: "Mail", username: "ada" }],
      pairMessage: null,
    });
    expect(model).toEqual({
      kind: "logins",
      host: "accounts.google.com",
      logins: [{ id: "1", title: "Mail", username: "ada" }],
    });
    const root = document.createElement("div");
    renderPopup(root, model, actions);
    expect(root.textContent).toContain("Mail");
    expect(root.textContent).toContain("ada");
    expect(root.textContent).not.toContain("fixture-mail-secret");
    expect(root.querySelector("input[type=password]")).toBeNull();
  });

  it("tells the user to unlock, without a login list", () => {
    const root = document.createElement("div");
    renderPopup(root, { kind: "locked" }, actions);
    expect(root.textContent).toContain("Unlock quietkeys on this computer.");
    expect(root.querySelector("ul")).toBeNull();
    expect(root.querySelector("input")).toBeNull();
  });

  it("does not treat a browser page as a login page", () => {
    expect(
      viewModel({
        status: "unlocked",
        url: "chrome://extensions",
        logins: [{ id: "1", title: "Mail", username: "ada" }],
        pairMessage: null,
      }),
    ).toEqual({ kind: "unsupported" });
  });

  it("fills the login that was clicked", () => {
    const filled: string[] = [];
    const root = document.createElement("div");
    renderPopup(
      root,
      {
        kind: "logins",
        host: "example.com",
        logins: [{ id: "login-1", title: "Example", username: "ada" }],
      },
      { ...actions, fill: (id) => filled.push(id) },
    );
    const button = root.querySelector("ul button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing login");
    button.click();
    expect(filled).toEqual(["login-1"]);
  });
});

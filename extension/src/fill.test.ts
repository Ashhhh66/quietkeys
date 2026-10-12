import { describe, expect, it } from "vitest";
import { applyFill, loginFields, loginMenu, passwordInputs, savePayload } from "./fill";

function loginForm() {
  document.body.innerHTML = `
    <p>notes about the page secret-in-prose</p>
    <form>
      <input type="email" autocomplete="username" value="ada@example.com" />
      <input type="password" value="from-the-field" />
      <textarea>whole page dump</textarea>
      <input type="search" value="do-not-save" />
    </form>
  `;
  const form = document.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
  return form;
}

function field(selector: string): HTMLInputElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(selector);
  return element;
}

describe("filling a page", () => {
  it("does not write a field until a fill is requested", () => {
    loginForm();
    expect(passwordInputs(document)).toHaveLength(1);
    expect(field("input[type=password]").value).toBe("from-the-field");
  });

  it("fills the matching page after a request", () => {
    const form = loginForm();
    const fields = loginFields(form);
    if (!fields.password) throw new Error("missing password");
    fields.password.value = "";
    const filled = applyFill("https://example.com/login", true, fields, {
      username: "ada@example.com",
      password: "correct horse",
      url: "https://example.com/login",
    });
    expect(filled).toBe(true);
    expect(fields.password.value).toBe("correct horse");
    expect(fields.username?.value).toBe("ada@example.com");
  });

  it("does not fill a lookalike origin", () => {
    const fields = loginFields(loginForm());
    if (!fields.password) throw new Error("missing password");
    fields.password.value = "";
    const filled = applyFill("https://google.com.evil.io/login", true, fields, {
      username: "ada",
      password: "fixture-mail-secret",
      url: "https://accounts.google.com/login",
    });
    expect(filled).toBe(false);
    expect(fields.password.value).toBe("");
  });

  it("does not fill a subframe or an http page with an https login", () => {
    const fields = loginFields(loginForm());
    if (!fields.password) throw new Error("missing password");
    fields.password.value = "";
    expect(
      applyFill("https://example.com/login", false, fields, {
        username: "ada",
        password: "secret",
        url: "https://example.com/login",
      }),
    ).toBe(false);
    expect(
      applyFill("http://example.com/login", true, fields, {
        username: "ada",
        password: "secret",
        url: "https://example.com/login",
      }),
    ).toBe(false);
    expect(fields.password.value).toBe("");
  });

  it("saves the form's login fields and leaves the rest of the page out", () => {
    const payload = savePayload(loginForm(), "https://example.com/login");
    expect(payload).toEqual({
      url: "https://example.com/login",
      username: "ada@example.com",
      password: "from-the-field",
    });
    expect(Object.keys(payload ?? {}).sort()).toEqual(["password", "url", "username"]);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("secret-in-prose");
    expect(text).not.toContain("whole page dump");
    expect(text).not.toContain("do-not-save");
  });

  it("keeps an http url as http", () => {
    const payload = savePayload(loginForm(), "http://example.com/login");
    expect(payload?.url).toBe("http://example.com/login");
  });

  it("prefers the new password on a change form", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" autocomplete="current-password" value="old-secret" />
        <input type="password" autocomplete="new-password" value="new-secret" />
      </form>
    `;
    const form = document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
    expect(savePayload(form, "https://example.com/login")?.password).toBe("new-secret");
  });

  it("shows titles in the menu and not a password", () => {
    const menu = loginMenu([{ id: "1", title: "Example", username: "ada" }], () => {});
    expect(menu.textContent).toContain("Example");
    expect(menu.textContent).toContain("ada");
    expect(menu.textContent).not.toContain("fixture-mail-secret");
  });
});

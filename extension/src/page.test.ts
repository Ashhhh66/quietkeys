import { afterEach, describe, expect, it } from "vitest";
import { mount, type Ask } from "./page";

let stop = () => {};

afterEach(() => {
  stop();
  document.body.innerHTML = "";
  document.querySelector("#quietkeys-style")?.remove();
  document.querySelectorAll(".quietkeys-fill, .quietkeys-menu").forEach((node) => node.remove());
});

function ask(overrides: Partial<Ask> = {}): Ask & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findLogins(url) {
      calls.push(`find ${url}`);
      return overrides.findLogins ? overrides.findLogins(url) : [];
    },
    async getLogin(id, url) {
      calls.push(`get ${id} ${url}`);
      return overrides.getLogin ? overrides.getLogin(id, url) : null;
    },
    async save(payload) {
      calls.push(`save ${JSON.stringify(payload)}`);
      await overrides.save?.(payload);
    },
  };
}

function field(selector: string): HTMLInputElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(selector);
  return element;
}

describe("the field icon", () => {
  it("does not look up or fill a login when the page loads", () => {
    document.body.innerHTML = `<form><input type="password" value="" /></form>`;
    const bridge = ask();
    stop = mount(document, () => "https://example.com/login", bridge, true);
    expect(bridge.calls).toEqual([]);
    expect(field("input[type=password]").value).toBe("");
  });

  it("fills only after a login in the menu is clicked", async () => {
    document.body.innerHTML = `
      <form>
        <input type="email" value="" />
        <input type="password" value="" />
      </form>
    `;
    const bridge = ask({
      async findLogins() {
        return [{ id: "1", title: "Example", username: "ada@example.com" }];
      },
      async getLogin() {
        return { username: "ada@example.com", password: "correct horse" };
      },
    });
    stop = mount(document, () => "https://example.com/login", bridge, true);
    document
      .querySelector("button[aria-label='Fill from quietkeys']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const item = await findMenuItem();
    item.click();
    await waitFor(() => field("input[type=password]").value === "correct horse");
    expect(bridge.calls).toContain("find https://example.com/login");
    expect(bridge.calls).toContain("get 1 https://example.com/login");
    expect(field("input[type=email]").value).toBe("ada@example.com");
  });

  it("asks about the page it is on, including a lookalike", async () => {
    document.body.innerHTML = `<form><input type="password" value="" /></form>`;
    const bridge = ask();
    stop = mount(document, () => "https://google.com.evil.io/login", bridge, true);
    document
      .querySelector("button[aria-label='Fill from quietkeys']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(bridge.calls).toEqual(["find https://google.com.evil.io/login"]);
    expect(document.querySelector("[role=menuitem]")).toBeNull();
    expect(field("input[type=password]").value).toBe("");
  });

  it("sends a submitted form's login and not the rest of the page", () => {
    document.body.innerHTML = `
      <p>secret-in-prose</p>
      <form>
        <input type="email" value="ada@example.com" />
        <input type="password" value="from-the-field" />
        <textarea>whole page dump</textarea>
      </form>
    `;
    const bridge = ask();
    stop = mount(document, () => "https://example.com/login", bridge, true);
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(bridge.calls).toEqual([
      'save {"url":"https://example.com/login","username":"ada@example.com","password":"from-the-field"}',
    ]);
    expect(bridge.calls[0]).not.toContain("secret-in-prose");
    expect(bridge.calls[0]).not.toContain("whole page dump");
  });

  it("does nothing in a subframe", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" value="from-the-field" />
      </form>
    `;
    const bridge = ask();
    stop = mount(document, () => "https://example.com/login", bridge, false);
    expect(document.querySelector("button[aria-label='Fill from quietkeys']")).toBeNull();
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true }));
    expect(bridge.calls).toEqual([]);
  });
});

async function findMenuItem(): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const item = document.querySelector("[role=menuitem]");
    if (item instanceof HTMLButtonElement) return item;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("menu did not open");
}

async function waitFor(done: () => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out");
}

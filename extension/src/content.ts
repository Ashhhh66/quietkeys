import { applyFill, fillMessage, loginFields } from "./fill";
import { mount, type Ask } from "./page";
import { loginsFrom, secretFrom } from "./protocol";

function topFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

async function send(message: unknown): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { error: "unavailable" };
  }
}

const ask: Ask = {
  async findLogins(url) {
    return loginsFrom(await send({ type: "find_logins", url }));
  },
  async getLogin(id, url) {
    return secretFrom(await send({ type: "get_login", id, url }));
  },
  async save(payload) {
    await send({
      type: "save",
      url: payload.url,
      username: payload.username,
      password: payload.password,
    });
  },
};

function start() {
  mount(document, () => location.href, ask, topFrame());
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void sender;
    const request = fillMessage(message);
    if (!request) return;
    sendResponse({
      ok: applyFill(location.href, topFrame(), loginFields(document), request),
    });
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) start();

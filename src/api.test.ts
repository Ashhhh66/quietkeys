import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Imported after the mock is set up, per vi.mock's hoisting.
import {
  addEntry,
  createVault,
  deleteEntry,
  getEntry,
  getPassword,
  lock,
  onLocked,
  unlock,
  updateEntry,
} from "./api";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("command wrappers", () => {
  it("send the right command name and camelCase arguments", async () => {
    invokeMock.mockResolvedValue(undefined);

    await createVault("a very secret password");
    expect(invokeMock).toHaveBeenLastCalledWith("create_vault", {
      masterPassword: "a very secret password",
    });

    await unlock("a very secret password");
    expect(invokeMock).toHaveBeenLastCalledWith("unlock", {
      masterPassword: "a very secret password",
    });

    await lock();
    expect(invokeMock).toHaveBeenLastCalledWith("lock", undefined);

    await getEntry("entry-1");
    expect(invokeMock).toHaveBeenLastCalledWith("get_entry", { id: "entry-1" });

    await getPassword("entry-1");
    expect(invokeMock).toHaveBeenLastCalledWith("get_password", { id: "entry-1" });

    const entry = { title: "t", username: "u", password: "p", url: "x", notes: "n" };
    await addEntry(entry);
    expect(invokeMock).toHaveBeenLastCalledWith("add_entry", { entry });

    await updateEntry("entry-1", { title: "t", username: "u", url: "x", notes: "n" });
    expect(invokeMock).toHaveBeenLastCalledWith("update_entry", {
      id: "entry-1",
      entry: { title: "t", username: "u", url: "x", notes: "n" },
    });

    await deleteEntry("entry-1");
    expect(invokeMock).toHaveBeenLastCalledWith("delete_entry", { id: "entry-1" });
  });

  it("omits the password key from update_entry when left unset", async () => {
    invokeMock.mockResolvedValue(undefined);
    await updateEntry("entry-1", { title: "t", username: "u", url: "x", notes: "n" });
    const sentEntry = invokeMock.mock.calls[0][1].entry;
    expect("password" in sentEntry).toBe(false);
    // JSON.stringify drops undefined-valued keys, so this is what actually crosses IPC.
    expect(JSON.parse(JSON.stringify(sentEntry))).toEqual({
      title: "t",
      username: "u",
      url: "x",
      notes: "n",
    });
  });
});

describe("onLocked", () => {
  it('fires when any call rejects with kind "locked"', async () => {
    const listener = vi.fn();
    onLocked(listener);
    invokeMock.mockRejectedValue({ kind: "locked", message: "The vault is locked" });

    await expect(getEntry("entry-1")).rejects.toMatchObject({ kind: "locked" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not fire for other error kinds", async () => {
    const listener = vi.fn();
    onLocked(listener);
    invokeMock.mockRejectedValue({ kind: "decrypt_failed", message: "nope" });

    await expect(unlock("wrong")).rejects.toMatchObject({ kind: "decrypt_failed" });
    expect(listener).not.toHaveBeenCalled();
  });
});

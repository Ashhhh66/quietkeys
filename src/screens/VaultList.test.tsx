import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultList from "./VaultList";
import * as api from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return {
    ...actual,
    listEntries: vi.fn(),
    getEntry: vi.fn(),
    getPassword: vi.fn(),
    deleteEntry: vi.fn(),
    deleteForever: vi.fn(),
    restoreEntry: vi.fn(),
    setFavourite: vi.fn(),
    listDeletedEntries: vi.fn(),
    copyHistoryPassword: vi.fn(),
    lock: vi.fn(),
    copyPassword: vi.fn(),
    copyUsername: vi.fn(),
    clearClipboard: vi.fn(),
    openEntryWebsite: vi.fn(),
    generatePassword: vi.fn(),
    scorePassword: vi.fn(),
  };
});

const listEntries = api.listEntries as unknown as ReturnType<typeof vi.fn>;
const getEntry = api.getEntry as unknown as ReturnType<typeof vi.fn>;
const getPassword = api.getPassword as unknown as ReturnType<typeof vi.fn>;
const deleteEntry = api.deleteEntry as unknown as ReturnType<typeof vi.fn>;
const deleteForever = api.deleteForever as unknown as ReturnType<typeof vi.fn>;
const restoreEntry = api.restoreEntry as unknown as ReturnType<typeof vi.fn>;
const setFavourite = api.setFavourite as unknown as ReturnType<typeof vi.fn>;
const listDeletedEntries = api.listDeletedEntries as unknown as ReturnType<typeof vi.fn>;
const copyHistoryPassword = api.copyHistoryPassword as unknown as ReturnType<typeof vi.fn>;
const lockMock = api.lock as unknown as ReturnType<typeof vi.fn>;
const copyPassword = api.copyPassword as unknown as ReturnType<typeof vi.fn>;
const copyUsername = api.copyUsername as unknown as ReturnType<typeof vi.fn>;
const clearClipboard = api.clearClipboard as unknown as ReturnType<typeof vi.fn>;
const openEntryWebsite = api.openEntryWebsite as unknown as ReturnType<typeof vi.fn>;
const generatePassword = api.generatePassword as unknown as ReturnType<typeof vi.fn>;
const scorePassword = api.scorePassword as unknown as ReturnType<typeof vi.fn>;

const entries = [
  { id: "1", title: "GitHub", username: "octocat", url: "https://github.com" },
  { id: "2", title: "Example Bank", username: "someone", url: "https://bank.example.com" },
];

const MASK = "••••••••••••";

beforeEach(() => {
  listEntries.mockReset().mockResolvedValue(entries);
  getEntry.mockReset().mockImplementation(async (id: string) => ({
    ...entries.find((entry) => entry.id === id),
    notes: "",
    createdAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-25T10:00:00Z",
  }));
  getPassword.mockReset();
  deleteEntry.mockReset().mockResolvedValue(undefined);
  deleteForever.mockReset().mockResolvedValue(undefined);
  restoreEntry.mockReset().mockResolvedValue(undefined);
  setFavourite.mockReset().mockResolvedValue(undefined);
  listDeletedEntries.mockReset().mockResolvedValue([]);
  copyHistoryPassword.mockReset().mockResolvedValue(undefined);
  lockMock.mockReset().mockResolvedValue(undefined);
  copyPassword.mockReset().mockResolvedValue(undefined);
  copyUsername.mockReset().mockResolvedValue(undefined);
  clearClipboard.mockReset().mockResolvedValue(undefined);
  openEntryWebsite.mockReset().mockResolvedValue(undefined);
  generatePassword.mockReset().mockResolvedValue("generated-secret");
  scorePassword.mockReset().mockResolvedValue({ score: 3, warning: null, suggestions: [] });
});

function entryList(): Promise<HTMLElement> {
  return screen.findByRole("list");
}

function detailsPanel(): HTMLElement {
  return screen.getByRole("main", { name: "Login details" });
}

describe("VaultList", () => {
  it("lists every entry without ever showing a password", async () => {
    render(<VaultList onLocked={vi.fn()} />);
    expect(await within(await entryList()).findByText("GitHub")).toBeInTheDocument();
    expect(within(await entryList()).getByText("Example Bank")).toBeInTheDocument();
    expect(within(detailsPanel()).getByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    expect(within(await entryList()).queryByText(/•/)).not.toBeInTheDocument();
    expect(getPassword).not.toHaveBeenCalled();
  });

  it("filters the list by search text, including the URL", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");

    const search = screen.getByPlaceholderText("Search logins");
    await user.type(search, "bank");
    expect(within(await entryList()).queryByText("GitHub")).not.toBeInTheDocument();
    expect(within(await entryList()).getByText("Example Bank")).toBeInTheDocument();
    expect(
      within(detailsPanel()).getByRole("heading", { name: "Example Bank" }),
    ).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "bank.example");
    expect(within(await entryList()).queryByText("GitHub")).not.toBeInTheDocument();
    expect(within(await entryList()).getByText("Example Bank")).toBeInTheDocument();
  });

  it("reveals a password on demand and hides it again after 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getPassword.mockResolvedValue("hunter2");
      const user = userEvent.setup({ delay: null });
      render(<VaultList onLocked={vi.fn()} />);
      await within(await entryList()).findByText("GitHub");

      await user.click(within(await entryList()).getByRole("button", { name: /GitHub/ }));
      const details = detailsPanel();
      expect(within(details).getByText(MASK)).toBeInTheDocument();
      expect(getPassword).not.toHaveBeenCalled();

      await user.click(within(details).getByRole("button", { name: "Show password" }));
      expect(await within(details).findByText("hunter2")).toBeInTheDocument();
      expect(getPassword).toHaveBeenCalledWith("1");
      expect(within(details).getByRole("button", { name: "Hide password" })).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(within(details).getByText(MASK)).toBeInTheDocument());
      expect(within(details).queryByText("hunter2")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes immediately and can undo for a few seconds", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(within(await entryList()).getByRole("button", { name: /GitHub/ }));
    const details = detailsPanel();
    await user.click(within(details).getByRole("button", { name: "Delete login" }));
    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("1"));

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Deleted");
    expect(toast).toHaveTextContent("GitHub");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(restoreEntry).toHaveBeenCalledWith("1"));
  });

  it("stars a login without asking for the password again", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");
    const details = detailsPanel();
    await user.click(within(details).getByRole("button", { name: "Add to favourites" }));
    await waitFor(() => expect(setFavourite).toHaveBeenCalledWith("1", true));
  });

  it("copies a previous password by its id", async () => {
    getEntry.mockResolvedValue({
      ...entries[0],
      notes: "",
      createdAt: "2026-09-12T10:00:00Z",
      updatedAt: "2026-09-25T10:00:00Z",
      history: [{ id: "hist-1", replacedAt: "2026-06-12T00:00:00Z" }],
    });
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");
    const details = detailsPanel();
    await user.click(within(details).getByRole("button", { name: /Password history/ }));
    await user.click(within(details).getByRole("button", { name: /Copy previous password/ }));
    await waitFor(() => expect(copyHistoryPassword).toHaveBeenCalledWith("1", "hist-1"));
  });

  it("asks before deleting a login forever", async () => {
    listDeletedEntries.mockResolvedValue([
      {
        id: "9",
        title: "Old Bank",
        username: "ada",
        url: "",
        deletedAt: "2026-09-23T08:00:00Z",
      },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(screen.getByRole("button", { name: /Recently deleted/ }));
    expect(await screen.findByText("Old Bank")).toBeInTheDocument();
    expect(screen.getByText(/removed forever in/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteForever).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(deleteForever).toHaveBeenCalledWith("9"));
    confirmSpy.mockRestore();
  });

  it("locks and notifies the parent", async () => {
    const onLocked = vi.fn();
    const user = userEvent.setup();
    render(<VaultList onLocked={onLocked} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(screen.getByRole("button", { name: "Lock vault" }));
    await waitFor(() => expect(lockMock).toHaveBeenCalledTimes(1));
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("supports Ctrl+F to search, Esc to close the editor, and Ctrl+L to lock", async () => {
    const onLocked = vi.fn();
    const user = userEvent.setup();
    render(<VaultList onLocked={onLocked} />);
    await within(await entryList()).findByText("GitHub");

    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByPlaceholderText("Search logins")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Add login" }));
    expect(screen.getByRole("heading", { name: "Add login" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Add login" })).not.toBeInTheDocument();

    await user.keyboard("{Control>}l{/Control}");
    await waitFor(() => expect(lockMock).toHaveBeenCalledTimes(1));
    expect(onLocked).toHaveBeenCalledTimes(1);
  });

  it("keeps an unsaved title when a generated password is applied", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(within(detailsPanel()).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit login" })).toBeInTheDocument();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "GitHub draft");

    await user.click(screen.getByRole("button", { name: "Generate password" }));
    const usePassword = await screen.findByRole("button", { name: "Use this password" });
    await waitFor(() => expect(usePassword).toBeEnabled());
    await user.click(usePassword);

    expect(screen.getByRole("heading", { name: "Edit login" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("GitHub draft");
    expect(screen.getByLabelText("Password")).toHaveValue("generated-secret");
  });

  it("shows a clipboard toast that restarts, and hides it as soon as the vault locks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null });
      render(<VaultList onLocked={vi.fn()} />);
      await within(await entryList()).findByText("GitHub");

      const details = detailsPanel();
      await user.click(within(details).getByRole("button", { name: "Copy password" }));
      const status = () => screen.getByRole("status");
      expect(status()).toHaveTextContent("Password copied");
      expect(status()).toHaveTextContent("Clears from clipboard in 30s · not in history");
      expect(status().textContent).not.toContain("hunter2");
      expect(copyPassword).toHaveBeenCalledWith("1");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(status()).toHaveTextContent("Clears from clipboard in 20s");

      await user.click(within(details).getByRole("button", { name: "Copy username" }));
      expect(status()).toHaveTextContent("Username copied");
      expect(status()).toHaveTextContent("Clears from clipboard in 30s");
      expect(copyUsername).toHaveBeenCalledWith("1");

      await user.click(screen.getByRole("button", { name: "Lock vault" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sorts the list by name", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    const list = await entryList();
    await within(list).findByText("GitHub");

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    const titles = within(list)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(titles[0]).toContain("Example Bank");
    expect(titles[1]).toContain("GitHub");
  });

  it("sorts recently changed entries by updated_at, newest first", async () => {
    listEntries.mockResolvedValue([
      { ...entries[0], updatedAt: "2020-01-01T00:00:00Z" },
      { ...entries[1], updatedAt: "2026-06-01T00:00:00Z" },
    ]);
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    const list = await entryList();
    await within(list).findByText("GitHub");

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "changed");
    const titles = within(list)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(titles[0]).toContain("Example Bank");
    expect(titles[1]).toContain("GitHub");
  });

  it("shows the normalised host and opens the entry by id", async () => {
    listEntries.mockResolvedValue([
      {
        id: "1",
        title: "Stadt",
        username: "a",
        url: "https://münchen.de",
        host: "xn--mnchen-3ya.de",
      },
    ]);
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    const open = await within(detailsPanel()).findByRole("button", { name: "xn--mnchen-3ya.de" });
    expect(open).toHaveTextContent("xn--mnchen-3ya.de");
    await user.click(open);
    expect(openEntryWebsite).toHaveBeenCalledTimes(1);
    expect(openEntryWebsite).toHaveBeenCalledWith("1");
  });

  it("does nothing for Ctrl+C and Ctrl+B when text is selected", async () => {
    render(<VaultList onLocked={vi.fn()} />);
    const heading = await within(detailsPanel()).findByRole("heading", { name: "GitHub" });
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const copyEvent = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(false);
    expect(copyPassword).not.toHaveBeenCalled();

    const usernameEvent = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(usernameEvent);
    expect(usernameEvent.defaultPrevented).toBe(false);
    expect(copyUsername).not.toHaveBeenCalled();
    selection?.removeAllRanges();
  });

  it("clears the clipboard from the toast, and keeps the toast when that fails", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");
    await user.click(within(detailsPanel()).getByRole("button", { name: "Copy password" }));
    await user.click(screen.getByRole("button", { name: "Clear now" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(clearClipboard).toHaveBeenCalledTimes(1);

    clearClipboard.mockRejectedValue({ kind: "unsupported", message: "nope" });
    await user.click(within(detailsPanel()).getByRole("button", { name: "Copy password" }));
    await user.click(screen.getByRole("button", { name: "Clear now" }));
    expect(screen.getByRole("status")).toHaveTextContent("Copying isn't available on this system.");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

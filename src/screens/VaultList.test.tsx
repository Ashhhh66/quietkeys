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
    lock: vi.fn(),
    copyPassword: vi.fn(),
    copyUsername: vi.fn(),
    generatePassword: vi.fn(),
    scorePassword: vi.fn(),
  };
});

const listEntries = api.listEntries as unknown as ReturnType<typeof vi.fn>;
const getEntry = api.getEntry as unknown as ReturnType<typeof vi.fn>;
const getPassword = api.getPassword as unknown as ReturnType<typeof vi.fn>;
const deleteEntry = api.deleteEntry as unknown as ReturnType<typeof vi.fn>;
const lockMock = api.lock as unknown as ReturnType<typeof vi.fn>;
const copyPassword = api.copyPassword as unknown as ReturnType<typeof vi.fn>;
const copyUsername = api.copyUsername as unknown as ReturnType<typeof vi.fn>;
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
  lockMock.mockReset().mockResolvedValue(undefined);
  copyPassword.mockReset().mockResolvedValue(undefined);
  copyUsername.mockReset().mockResolvedValue(undefined);
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

  it("asks for confirmation before deleting, and only deletes if confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(within(await entryList()).getByRole("button", { name: /GitHub/ }));
    const details = detailsPanel();
    await user.click(within(details).getByRole("button", { name: "Delete login" }));
    expect(confirmSpy).toHaveBeenCalledWith('Delete "GitHub"? This cannot be undone.');
    expect(deleteEntry).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(within(details).getByRole("button", { name: "Delete login" }));
    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("1"));

    confirmSpy.mockRestore();
  });

  it("locks and notifies the parent", async () => {
    const onLocked = vi.fn();
    const user = userEvent.setup();
    render(<VaultList onLocked={onLocked} />);
    await within(await entryList()).findByText("GitHub");

    await user.click(screen.getByRole("button", { name: /Lock vault/ }));
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

      await user.click(screen.getByRole("button", { name: /Lock vault/ }));
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
});

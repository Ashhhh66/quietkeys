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
    getPassword: vi.fn(),
    deleteEntry: vi.fn(),
    lock: vi.fn(),
  };
});

const listEntries = api.listEntries as unknown as ReturnType<typeof vi.fn>;
const getPassword = api.getPassword as unknown as ReturnType<typeof vi.fn>;
const deleteEntry = api.deleteEntry as unknown as ReturnType<typeof vi.fn>;
const lockMock = api.lock as unknown as ReturnType<typeof vi.fn>;

const entries = [
  { id: "1", title: "GitHub", username: "octocat", url: "https://github.com" },
  { id: "2", title: "Example Bank", username: "someone", url: "https://bank.example.com" },
];

beforeEach(() => {
  listEntries.mockReset().mockResolvedValue(entries);
  getPassword.mockReset();
  deleteEntry.mockReset().mockResolvedValue(undefined);
  lockMock.mockReset().mockResolvedValue(undefined);
});

describe("VaultList", () => {
  it("lists every entry without ever showing a password", async () => {
    render(<VaultList onLocked={vi.fn()} />);
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Example Bank")).toBeInTheDocument();
    expect(screen.getAllByText("••••••••")).toHaveLength(2);
  });

  it("filters the list by search text", async () => {
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await screen.findByText("GitHub");

    await user.type(screen.getByPlaceholderText("Search…"), "bank");
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.getByText("Example Bank")).toBeInTheDocument();
  });

  it("reveals a password on demand and hides it again after 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getPassword.mockResolvedValue("hunter2");
      const user = userEvent.setup({ delay: null });
      render(<VaultList onLocked={vi.fn()} />);
      await screen.findByText("GitHub");

      const githubRow = screen.getByText("GitHub").closest("li") as HTMLElement;
      await user.click(within(githubRow).getByRole("button", { name: "Reveal" }));

      expect(await within(githubRow).findByText("hunter2")).toBeInTheDocument();
      expect(getPassword).toHaveBeenCalledWith("1");

      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(within(githubRow).getByText("••••••••")).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for confirmation before deleting, and only deletes if confirmed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<VaultList onLocked={vi.fn()} />);
    await screen.findByText("GitHub");

    const githubRow = screen.getByText("GitHub").closest("li") as HTMLElement;
    await user.click(within(githubRow).getByRole("button", { name: "Delete" }));
    expect(confirmSpy).toHaveBeenCalledWith('Delete "GitHub"? This cannot be undone.');
    expect(deleteEntry).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(within(githubRow).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("1"));

    confirmSpy.mockRestore();
  });

  it("locks and notifies the parent", async () => {
    const onLocked = vi.fn();
    const user = userEvent.setup();
    render(<VaultList onLocked={onLocked} />);
    await screen.findByText("GitHub");

    await user.click(screen.getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(lockMock).toHaveBeenCalledTimes(1));
    expect(onLocked).toHaveBeenCalledTimes(1);
  });
});

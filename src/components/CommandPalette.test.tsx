import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EntrySummary } from "../api";
import CommandPalette from "./CommandPalette";

const entries: EntrySummary[] = [
  { id: "1", title: "GitHub", username: "octocat", url: "https://github.com", host: "github.com" },
  {
    id: "2",
    title: "Example Bank",
    username: "someone",
    url: "https://bank.example.com",
    host: "bank.example.com",
  },
  { id: "3", title: "GitLab", username: "dev", url: "https://gitlab.com", host: "gitlab.com" },
  { id: "4", title: "Gitea", username: "dev", url: "https://gitea.example", host: "gitea.example" },
  {
    id: "5",
    title: "Gist",
    username: "dev",
    url: "https://gist.github.com",
    host: "gist.github.com",
  },
  { id: "6", title: "Gitbook", username: "dev", url: "https://gitbook.com", host: "gitbook.com" },
];

function renderPalette(
  props?: Partial<{
    onCopyPassword: (id: string) => void;
    onCopyUsername: (id: string) => void;
    onClose: () => void;
  }>,
) {
  const onCopyPassword = props?.onCopyPassword ?? vi.fn();
  const onCopyUsername = props?.onCopyUsername ?? vi.fn();
  const onClose = props?.onClose ?? vi.fn();
  render(
    <CommandPalette
      entries={entries}
      onCopyPassword={onCopyPassword}
      onCopyUsername={onCopyUsername}
      onGenerate={vi.fn()}
      onAdd={vi.fn()}
      onLock={vi.fn()}
      onClose={onClose}
    />,
  );
  return { onCopyPassword, onCopyUsername, onClose };
}

describe("CommandPalette", () => {
  it("shows at most five logins and filters by title", async () => {
    const user = userEvent.setup();
    renderPalette();
    const logins = screen.getByRole("list", { name: "Palette logins" });
    expect(within(logins).getAllByRole("button")).toHaveLength(5);
    expect(within(logins).queryByText("Gitbook")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Command palette search" }), "bank");
    expect(within(logins).getByText("Example Bank")).toBeInTheDocument();
    expect(within(logins).queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Palette actions" })).toBeInTheDocument();
  });

  it("copies the password on Enter and the username on Shift+Enter", async () => {
    const user = userEvent.setup();
    const { onCopyPassword, onCopyUsername } = renderPalette();
    await user.type(screen.getByRole("textbox", { name: "Command palette search" }), "git");
    await user.keyboard("{Enter}");
    expect(onCopyPassword).toHaveBeenCalledWith("1");
    expect(onCopyUsername).not.toHaveBeenCalled();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onCopyUsername).toHaveBeenCalledWith("3");
  });

  it("traps focus and returns it to the control that opened it", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open palette
          </button>
          {open && (
            <CommandPalette
              entries={entries.slice(0, 1)}
              onCopyPassword={vi.fn()}
              onCopyUsername={vi.fn()}
              onGenerate={vi.fn()}
              onAdd={vi.fn()}
              onLock={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open palette" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(within(dialog).getByRole("textbox")).toHaveFocus();

    const focusable = within(dialog).getAllByRole("button");
    for (let i = 0; i < focusable.length + 1; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

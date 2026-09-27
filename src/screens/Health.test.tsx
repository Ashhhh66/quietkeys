import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultHealth } from "../api";
import HealthScreen from "./Health";

const health: VaultHealth = {
  strong: 1,
  weak: 3,
  reused: 2,
  issues: [
    {
      kind: "reused",
      entries: [
        { id: "a", title: "GitHub", domain: "github.com", weak: true },
        { id: "b", title: "Example Bank", domain: "bank.example.com", weak: false },
      ],
    },
    {
      kind: "weak",
      entries: [{ id: "c", title: "Work", domain: "discord.com", weak: true }],
    },
  ],
};

describe("HealthScreen", () => {
  it("lists reused cards before weak ones and marks a weak member on the reused card", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(<HealthScreen health={health} onGenerate={onGenerate} onOpen={onOpen} />);

    expect(
      screen.getByText("Checked on this computer. Nothing is sent anywhere."),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "1 Strong" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "3 Weak" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "2 Reused" })).toBeInTheDocument();

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Reused")).toBeInTheDocument();
    expect(within(cards[0]).getByText("GitHub")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Weak")).toBeInTheDocument();
    expect(within(cards[0]).queryByText("Work")).not.toBeInTheDocument();
    expect(within(cards[1]).getByText("Weak")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Work")).toBeInTheDocument();
    expect(screen.queryByText("discord123")).not.toBeInTheDocument();

    await user.click(
      within(cards[0]).getAllByRole("button", { name: "Generate a new password" })[0],
    );
    expect(onGenerate).toHaveBeenCalledWith("a");
    await user.click(within(cards[0]).getByRole("button", { name: "Open github.com" }));
    expect(onOpen).toHaveBeenCalledWith("a");
  });
});

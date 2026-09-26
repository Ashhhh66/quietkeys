import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Unlock from "./Unlock";
import * as api from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, unlock: vi.fn() };
});

const unlockMock = api.unlock as unknown as ReturnType<typeof vi.fn>;

function passwordField(): HTMLInputElement {
  return document.querySelector("input[type='password']") as HTMLInputElement;
}

beforeEach(() => {
  unlockMock.mockReset();
});

describe("Unlock", () => {
  it("unlocks and calls onUnlocked, clearing the field", async () => {
    unlockMock.mockResolvedValue(undefined);
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<Unlock onUnlocked={onUnlocked} />);

    const input = passwordField();
    await user.type(input, "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    expect(unlockMock).toHaveBeenCalledWith("correct horse battery staple");
    expect(input).toHaveValue("");
  });

  it("shows the generic message and clears the field on a wrong password", async () => {
    unlockMock.mockRejectedValue({
      kind: "decrypt_failed",
      message: "Incorrect password or corrupted vault",
    });
    const user = userEvent.setup();
    render(<Unlock onUnlocked={vi.fn()} />);

    const input = passwordField();
    await user.type(input, "wrong password");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("Incorrect password or corrupted vault")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("shows and ticks down a countdown on a throttled error, disabling submit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      unlockMock.mockRejectedValue({
        kind: "throttled",
        message: "Too many incorrect attempts. Try again in 5 seconds",
        secondsRemaining: 5,
      });
      const user = userEvent.setup({ delay: null });
      render(<Unlock onUnlocked={vi.fn()} />);

      const input = passwordField();
      await user.type(input, "wrong password");
      await user.click(screen.getByRole("button", { name: "Unlock" }));

      const button = () => screen.getByRole("button");
      await waitFor(() => expect(button()).toHaveTextContent("Try again in 5s"));
      expect(button()).toBeDisabled();

      await vi.advanceTimersByTimeAsync(3000);
      expect(button()).toHaveTextContent("Try again in 2s");

      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => expect(button()).toHaveTextContent("Unlock"));
      expect(button()).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import Generator from "./Generator";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return {
    ...actual,
    generatePassword: vi.fn(),
    generatePassphrase: vi.fn(),
    scorePassword: vi.fn(),
    copyGeneratedPassword: vi.fn(),
  };
});

const generatePassword = api.generatePassword as unknown as ReturnType<typeof vi.fn>;
const generatePassphrase = api.generatePassphrase as unknown as ReturnType<typeof vi.fn>;
const scorePassword = api.scorePassword as unknown as ReturnType<typeof vi.fn>;
const copyGeneratedPassword = api.copyGeneratedPassword as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  generatePassword.mockReset().mockResolvedValue({ value: "Correct-horse-battery-1", bits: 80 });
  generatePassphrase.mockReset().mockResolvedValue({
    value: "Correct-horse-battery-staple-7",
    bits: 67.94599061291626,
  });
  scorePassword.mockReset().mockResolvedValue({ score: 0, warning: "zxcvbn", suggestions: [] });
  copyGeneratedPassword.mockReset().mockResolvedValue(undefined);
});

describe("Generator", () => {
  it("regenerates when a password option changes", async () => {
    const user = userEvent.setup();
    render(<Generator />);

    await waitFor(() => expect(generatePassword).toHaveBeenCalledTimes(1));
    expect(generatePassword).toHaveBeenCalledWith({
      length: 20,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: false,
    });

    await user.click(screen.getByRole("checkbox", { name: "Symbols" }));
    await user.click(screen.getByRole("checkbox", { name: "Exclude ambiguous characters" }));
    fireEvent.change(screen.getByRole("slider", { name: "Length" }), { target: { value: "32" } });

    await waitFor(() =>
      expect(generatePassword).toHaveBeenLastCalledWith({
        length: 32,
        uppercase: true,
        lowercase: true,
        digits: true,
        symbols: false,
        excludeAmbiguous: true,
      }),
    );
    expect(generatePassword.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("80.0 bits · Very strong")).toBeInTheDocument();
    expect(scorePassword).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled());
    const calls = generatePassword.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(generatePassword).toHaveBeenCalledTimes(calls + 1));
  });

  it("builds a passphrase from the chosen options and colours the separator and number", async () => {
    const user = userEvent.setup();
    const onSaveAsLogin = vi.fn();
    render(<Generator onSaveAsLogin={onSaveAsLogin} />);
    await screen.findByText("Correct-horse-battery-1");

    await user.click(screen.getByRole("radio", { name: "Passphrase" }));
    await waitFor(() =>
      expect(generatePassphrase).toHaveBeenCalledWith({
        words: 5,
        separator: "-",
        capitalise: true,
        addNumber: true,
      }),
    );

    const result = await screen.findByText((_, node) => {
      return node?.tagName === "P" && node.textContent === "Correct-horse-battery-staple-7";
    });
    const hyphens = within(result).getAllByText("-");
    expect(hyphens.length).toBeGreaterThan(0);
    expect(hyphens[0]).toHaveClass("text-accent");
    expect(within(result).getByText("7")).toHaveClass("text-warn-fg");
    expect(screen.getByText("67.9 bits · Strong")).toBeInTheDocument();
    expect(screen.getByText(/Passphrases make great master passwords/)).toBeInTheDocument();
    expect(scorePassword).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "Add a number" }));
    await waitFor(() =>
      expect(generatePassphrase).toHaveBeenLastCalledWith({
        words: 5,
        separator: "-",
        capitalise: true,
        addNumber: false,
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save as new login" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Save as new login" }));
    expect(onSaveAsLogin).toHaveBeenCalledWith("Correct-horse-battery-staple-7");
  });

  it("copies the generated password and shows the confirmation", async () => {
    const user = userEvent.setup();
    render(<Generator />);
    expect(await screen.findByText("Correct-horse-battery-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy password" }));

    expect(copyGeneratedPassword).toHaveBeenCalledWith("Correct-horse-battery-1");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Password copied");
    expect(status).toHaveTextContent("Clears from clipboard in 30s · not in history");
    expect(status.textContent).not.toContain("Correct-horse-battery-1");
  });

  it("restarts the clipboard countdown when copying again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null });
      render(<Generator />);
      expect(await screen.findByText("Correct-horse-battery-1")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Copy password" }));
      expect(screen.getByRole("status")).toHaveTextContent("Clears from clipboard in 30s");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(screen.getByRole("status")).toHaveTextContent("Clears from clipboard in 20s");

      await user.click(screen.getByRole("button", { name: "Copy password" }));
      expect(screen.getByRole("status")).toHaveTextContent("Clears from clipboard in 30s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the copy button when copying is unsupported", async () => {
    copyGeneratedPassword.mockRejectedValue({
      kind: "unsupported",
      message: "Copying isn't available on this system.",
    });
    const user = userEvent.setup();
    render(<Generator />);
    expect(await screen.findByText("Correct-horse-battery-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy password" }));

    expect(screen.queryByRole("button", { name: "Copy password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import Generator from "./Generator";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, generatePassword: vi.fn(), scorePassword: vi.fn() };
});

const generatePassword = api.generatePassword as unknown as ReturnType<typeof vi.fn>;
const scorePassword = api.scorePassword as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  generatePassword.mockReset().mockResolvedValue("Correct-horse-battery-1");
  scorePassword.mockReset().mockResolvedValue({ score: 3, warning: null, suggestions: [] });
});

describe("Generator", () => {
  it("generates once on open, then uses the chosen options", async () => {
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
    await user.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(generatePassword).toHaveBeenCalledTimes(2));
    expect(generatePassword).toHaveBeenLastCalledWith({
      length: 32,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: false,
      excludeAmbiguous: true,
    });
  });
});

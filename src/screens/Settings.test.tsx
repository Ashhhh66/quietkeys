import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import Settings from "./Settings";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return {
    ...actual,
    scorePassword: vi.fn(),
    changeMasterPassword: vi.fn(),
    exportVault: vi.fn(),
  };
});

const scorePassword = api.scorePassword as unknown as ReturnType<typeof vi.fn>;
const exportVault = api.exportVault as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  scorePassword
    .mockReset()
    .mockResolvedValue({ score: 2, warning: "Short", suggestions: ["Add words"] });
  exportVault.mockReset();
});

describe("Settings", () => {
  it("scores the new password 400ms after it stops changing", async () => {
    vi.useFakeTimers();
    try {
      render(<Settings />);
      fireEvent.change(screen.getByLabelText("New password"), { target: { value: "horse" } });
      await vi.advanceTimersByTimeAsync(399);
      expect(scorePassword).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(scorePassword).toHaveBeenCalledWith("horse");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when the export file already exists", async () => {
    exportVault.mockRejectedValue({
      kind: "io",
      message: "File error: entity already exists",
    });
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole("button", { name: "Export backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A file with that name already exists. Choose a different name.",
    );
  });
});

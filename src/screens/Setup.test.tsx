import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Setup from "./Setup";
import * as api from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, createVault: vi.fn() };
});

const createVault = api.createVault as unknown as ReturnType<typeof vi.fn>;

function checklistItem(text: string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

function expectMet(text: string, met: boolean) {
  if (met) {
    expect(checklistItem(text)).not.toHaveTextContent("Not met:");
  } else {
    expect(checklistItem(text)).toHaveTextContent("Not met:");
  }
}

beforeEach(() => {
  createVault.mockReset();
});

describe("Setup", () => {
  it("shows the length rule as unmet for a too-short password and disables submit", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "short");
    expectMet("At least 12 characters", false);
    expectMet("No hidden control characters", true);
    expect(screen.getByRole("button", { name: "Create vault" })).toBeDisabled();
  });

  it("shows the match rule as unmet when the confirmation differs", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm master password"), "different password");
    expectMet("At least 12 characters", true);
    expectMet("Passwords match", false);
    expect(screen.getByRole("button", { name: "Create vault" })).toBeDisabled();
  });

  it("enables submit once the password is valid and confirmed", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm master password"), "correct horse battery");
    expectMet("At least 12 characters", true);
    expectMet("No hidden control characters", true);
    expectMet("Passwords match", true);
    expect(screen.getByRole("button", { name: "Create vault" })).toBeEnabled();
  });

  it("creates the vault and calls onCreated, clearing both fields", async () => {
    createVault.mockResolvedValue(undefined);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<Setup onCreated={onCreated} />);

    const passwordInput = screen.getByLabelText("Master password");
    const confirmInput = screen.getByLabelText("Confirm master password");
    await user.type(passwordInput, "correct horse battery");
    await user.type(confirmInput, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create vault" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(createVault).toHaveBeenCalledWith("correct horse battery");
    expect(passwordInput).toHaveValue("");
    expect(confirmInput).toHaveValue("");
  });

  it("shows the error and still clears both fields when creation fails", async () => {
    createVault.mockRejectedValue({ kind: "crypto", message: "Internal cryptography error" });
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    const passwordInput = screen.getByLabelText("Master password");
    const confirmInput = screen.getByLabelText("Confirm master password");
    await user.type(passwordInput, "correct horse battery");
    await user.type(confirmInput, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create vault" }));

    expect(await screen.findByText("Internal cryptography error")).toBeInTheDocument();
    expect(passwordInput).toHaveValue("");
    expect(confirmInput).toHaveValue("");
  });
});

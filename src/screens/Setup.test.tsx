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

beforeEach(() => {
  createVault.mockReset();
});

describe("Setup", () => {
  it("shows live feedback for a too-short password and disables submit", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "short");
    expect(
      screen.getByText("The master password must be at least 12 characters long"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create vault" })).toBeDisabled();
  });

  it("shows a mismatch warning when the confirmation differs", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "different password");
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create vault" })).toBeDisabled();
  });

  it("enables submit once the password is valid and confirmed", async () => {
    const user = userEvent.setup();
    render(<Setup onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("Master password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery");
    expect(screen.getByRole("button", { name: "Create vault" })).toBeEnabled();
  });

  it("creates the vault and calls onCreated, clearing both fields", async () => {
    createVault.mockResolvedValue(undefined);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<Setup onCreated={onCreated} />);

    const passwordInput = screen.getByLabelText("Master password");
    const confirmInput = screen.getByLabelText("Confirm password");
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
    const confirmInput = screen.getByLabelText("Confirm password");
    await user.type(passwordInput, "correct horse battery");
    await user.type(confirmInput, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create vault" }));

    expect(await screen.findByText("Internal cryptography error")).toBeInTheDocument();
    expect(passwordInput).toHaveValue("");
    expect(confirmInput).toHaveValue("");
  });
});

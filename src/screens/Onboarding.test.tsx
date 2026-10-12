import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import Onboarding from "./Onboarding";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, vaultInfo: vi.fn() };
});

const vaultInfo = api.vaultInfo as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vaultInfo.mockReset().mockResolvedValue({
    path: "%LOCALAPPDATA%\\com.quietkeys.app\\vault.quietkeys",
    lastSaved: "2026-09-27T12:00:00Z",
    backup: { status: "missing" },
    kdf: "argon2id",
    cipher: "xchacha20poly1305",
  });
});

describe("Onboarding", () => {
  it("says the master password cannot be recovered and shows the shortened path", async () => {
    render(<Onboarding onContinue={() => {}} />);
    expect(await screen.findByText(/cannot be opened/)).toBeInTheDocument();
    expect(screen.getByLabelText("Vault file")).toHaveTextContent(
      "%LOCALAPPDATA%\\com.quietkeys.app\\vault.quietkeys",
    );
    expect(screen.queryByText(/ada|Users\\/)).not.toBeInTheDocument();
  });

  it("opens an Emergency Kit with a blank password line and continues", async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onContinue={onContinue} />);
    await user.click(await screen.findByRole("button", { name: "Emergency Kit" }));
    expect(screen.getByRole("heading", { name: "Emergency Kit" })).toBeInTheDocument();
    expect(screen.getByText("vault.quietkeys.bak")).toBeInTheDocument();
    expect(screen.getByText("vault.quietkeys.v1-backup")).toBeInTheDocument();
    expect(screen.getByLabelText("Blank line")).toHaveTextContent("Write it by hand");
    expect(screen.queryByText(/correct horse/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});

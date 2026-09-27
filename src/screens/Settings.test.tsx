import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vaultInfo: vi.fn(),
    showVaultInFolder: vi.fn(),
    openEncryptionReadme: vi.fn(),
  };
});

const scorePassword = api.scorePassword as unknown as ReturnType<typeof vi.fn>;
const exportVault = api.exportVault as unknown as ReturnType<typeof vi.fn>;
const changeMasterPassword = api.changeMasterPassword as unknown as ReturnType<typeof vi.fn>;
const vaultInfo = api.vaultInfo as unknown as ReturnType<typeof vi.fn>;
const showVaultInFolder = api.showVaultInFolder as unknown as ReturnType<typeof vi.fn>;
const openEncryptionReadme = api.openEncryptionReadme as unknown as ReturnType<typeof vi.fn>;

let savedAt = new Date(Date.now() - 2 * 60_000).toISOString();

function info(backup: api.BackupStatus) {
  return {
    path: "%LOCALAPPDATA%\\com.quietkeys.app\\vault.quietkeys",
    lastSaved: savedAt,
    backup,
    kdf: "argon2id",
    cipher: "xchacha20poly1305",
  };
}

beforeEach(() => {
  scorePassword
    .mockReset()
    .mockResolvedValue({ score: 2, warning: "Short", suggestions: ["Add words"] });
  exportVault.mockReset();
  changeMasterPassword.mockReset();
  savedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  vaultInfo.mockReset().mockResolvedValue(info({ status: "healthy", savedAt }));
  showVaultInFolder.mockReset().mockResolvedValue(undefined);
  openEncryptionReadme.mockReset().mockResolvedValue(undefined);
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
    await user.click(await screen.findByRole("button", { name: "Export a copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A file with that name already exists. Choose a different name.",
    );
  });

  it("shows the version from getVersion", async () => {
    render(<Settings />);
    expect(await screen.findByText("Version 0.1.0")).toBeInTheDocument();
  });

  it("clears the master-password fields and confirms the change", async () => {
    changeMasterPassword.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Settings />);

    await user.type(screen.getByLabelText("Current password"), "old password here");
    await user.type(screen.getByLabelText("New password"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Change master password" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Master password changed. Backups you exported earlier still open with your old password.",
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toHaveValue("");
      expect(screen.getByLabelText("New password")).toHaveValue("");
      expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    });
  });

  it("applies density and text size immediately", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole("radio", { name: "Compact" }));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(localStorage.getItem("quietkeys.density")).toBe("compact");
    await user.click(screen.getByRole("radio", { name: "A+" }));
    expect(document.documentElement.style.fontSize).toBe("110%");
    expect(localStorage.getItem("quietkeys.textSize")).toBe("a+");
    delete document.documentElement.dataset.density;
    document.documentElement.style.fontSize = "";
    localStorage.removeItem("quietkeys.density");
    localStorage.removeItem("quietkeys.textSize");
  });

  it("shows a healthy backup and reveals the vault without sending a path", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    expect(
      await screen.findByText("%LOCALAPPDATA%\\com.quietkeys.app\\vault.quietkeys"),
    ).toBeInTheDocument();
    expect(screen.getByText("Healthy · saved 2 min ago")).toBeInTheDocument();
    expect(screen.getByText("Argon2id · XChaCha20-Poly1305")).toBeInTheDocument();
    expect(screen.queryByText(/ada|Users\\/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(showVaultInFolder).toHaveBeenCalledWith();
    await user.click(screen.getByRole("button", { name: "How it works" }));
    expect(openEncryptionReadme).toHaveBeenCalledWith();
  });

  it("says when there is no backup", async () => {
    vaultInfo.mockResolvedValue(info({ status: "missing" }));
    render(<Settings />);
    expect(await screen.findByText("No backup yet")).toBeInTheDocument();
  });

  it("says when the backup cannot be opened", async () => {
    vaultInfo.mockResolvedValue(info({ status: "unreadable" }));
    render(<Settings />);
    expect(
      await screen.findByText("Backup can't be opened. Your next save will replace it."),
    ).toBeInTheDocument();
  });

  it("opens the keyboard shortcuts list", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveTextContent(
      "Copy the selected password",
    );
  });
});

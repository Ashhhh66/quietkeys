import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

const EXTENSION_ID = "mmgnphcfacceojicelmchbgpmgclieda";

describe("the extension manifest", () => {
  it("pins the unpacked extension id from its public key", async () => {
    expect(await chromeExtensionId(manifest.key)).toBe(EXTENSION_ID);
  });

  it("asks only for what filling on click needs", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["nativeMessaging", "storage", "activeTab"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(JSON.stringify(manifest.permissions)).not.toContain("<all_urls>");
    expect(manifest.content_scripts).toEqual([
      {
        matches: ["http://*/*", "https://*/*"],
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: false,
      },
    ]);
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'none'",
    );
  });
});

async function chromeExtensionId(spkiBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(spkiBase64), (char) => char.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const alphabet = "abcdefghijklmnop";
  let id = "";
  for (const byte of digest.subarray(0, 16)) {
    id += alphabet[byte >> 4] + alphabet[byte & 0x0f];
  }
  return id;
}

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, "..");
const outDir = resolve(root, "dist");

const entries = [
  { name: "background", format: "es" },
  { name: "content", format: "iife" },
  { name: "popup", format: "es" },
];

for (const [index, entry] of entries.entries()) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: index === 0,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: {
        input: { [entry.name]: resolve(root, "src", `${entry.name}.ts`) },
        output: {
          format: entry.format,
          entryFileNames: "[name].js",
          codeSplitting: false,
        },
      },
    },
  });
}

await copyFile(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));
await copyFile(resolve(root, "popup.html"), resolve(outDir, "popup.html"));
await copyFile(resolve(root, "popup.css"), resolve(outDir, "popup.css"));
await mkdir(resolve(outDir, "icons"), { recursive: true });
await copyFile(resolve(repo, "src-tauri/icons/32x32.png"), resolve(outDir, "icons/32.png"));
await copyFile(resolve(repo, "src-tauri/icons/128x128.png"), resolve(outDir, "icons/128.png"));

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's automatic cleanup only self-registers when vitest's globals are enabled; this
// project imports test functions explicitly instead, so it's wired up by hand here.
// This file lives under src/ (rather than the project root) so tsc's type-check of the
// tests — which only includes src/ — picks up jest-dom's ambient `expect` augmentation.
afterEach(() => {
  cleanup();
});

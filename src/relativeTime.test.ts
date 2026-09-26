import { describe, expect, it } from "vitest";
import { changedLabel, strengthIsWeak, strengthLabel } from "./relativeTime";

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("changedLabel", () => {
  it("describes how long ago a login was changed", () => {
    expect(changedLabel("2026-09-26T08:00:00Z", NOW)).toBe("Changed today");
    expect(changedLabel("2026-09-25T08:00:00Z", NOW)).toBe("Changed yesterday");
    expect(changedLabel("2026-09-20T08:00:00Z", NOW)).toBe("Changed 6 days ago");
    expect(changedLabel("2026-06-26T08:00:00Z", NOW)).toBe("Changed 3 months ago");
    expect(changedLabel("2024-09-26T08:00:00Z", NOW)).toBe("Changed 2 years ago");
  });
});

describe("strengthLabel", () => {
  it("names scores 0 through 4 and treats 0–2 as weak", () => {
    expect(strengthLabel(0)).toBe("Very weak");
    expect(strengthLabel(4)).toBe("Very strong");
    expect(strengthLabel(5)).toBeNull();
    expect(strengthIsWeak(2)).toBe(true);
    expect(strengthIsWeak(3)).toBe(false);
  });
});

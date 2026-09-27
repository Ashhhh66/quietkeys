import { describe, expect, it } from "vitest";
import {
  agoLabel,
  changedLabel,
  deletedAgoLabel,
  deletedRemainingLabel,
  strengthIsWeak,
  strengthLabel,
  usedLabel,
  usedUntilLabel,
} from "./relativeTime";

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

describe("agoLabel", () => {
  it("counts minutes and hours from a pinned clock", () => {
    expect(agoLabel("2026-09-26T11:58:00Z", NOW)).toBe("2 min ago");
    expect(agoLabel("2026-09-26T11:59:30Z", NOW)).toBe("just now");
    expect(agoLabel("2026-09-26T09:00:00Z", NOW)).toBe("3 hours ago");
  });
});

describe("used and deleted labels", () => {
  it("reuses the same day counts and counts down the 30-day keep", () => {
    expect(usedLabel("2026-09-26T08:00:00Z", NOW)).toBe("Used today");
    expect(deletedAgoLabel("2026-09-23T08:00:00Z", NOW)).toBe("Deleted 3 days ago");
    expect(deletedRemainingLabel("2026-09-23T08:00:00Z", NOW)).toBe("removed forever in 27 days");
    expect(usedUntilLabel("2026-06-12T00:00:00Z")).toBe("Used until 12 Jun 2026");
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

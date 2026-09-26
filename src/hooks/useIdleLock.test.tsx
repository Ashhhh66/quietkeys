import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { IDLE_CHECK_MS, useIdleLock } from "./useIdleLock";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof api>("../api");
  return { ...actual, lock: vi.fn() };
});

const lock = api.lock as unknown as ReturnType<typeof vi.fn>;

function Harness() {
  useIdleLock(true, () => {});
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
  localStorage.setItem("quietkeys.autoLockMinutes", "5");
  lock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("useIdleLock", () => {
  it("locks once the idle timeout has passed", async () => {
    render(<Harness />);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(lock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("locks on the next check when the clock jumps past the timeout", async () => {
    render(<Harness />);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await vi.advanceTimersByTimeAsync(IDLE_CHECK_MS);
    expect(lock).toHaveBeenCalledTimes(1);
  });
});

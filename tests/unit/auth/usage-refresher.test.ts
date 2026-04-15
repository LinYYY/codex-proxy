import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConfig = {
  quota: {
    refresh_interval_minutes: 0,
  },
};

vi.mock("@src/config.js", () => ({
  getConfig: vi.fn(() => mockConfig),
}));

vi.mock("@src/utils/jitter.js", () => ({
  jitter: vi.fn((value: number) => value),
}));

import { SnapshotTimer } from "@src/auth/usage-refresher.js";

describe("SnapshotTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockConfig.quota.refresh_interval_minutes = 0;
  });

  it("records usage-history snapshots even when quota refresh is disabled", () => {
    const pool = {} as never;
    const usageStats = {
      recordSnapshot: vi.fn(),
    } as never;

    const timer = new SnapshotTimer(pool, usageStats);
    timer.start();

    expect(usageStats.recordSnapshot).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_000);
    expect(usageStats.recordSnapshot).toHaveBeenCalledTimes(2);

    timer.stop();
  });

  it("uses the configured interval when quota refresh is enabled", () => {
    mockConfig.quota.refresh_interval_minutes = 2;

    const pool = {} as never;
    const usageStats = {
      recordSnapshot: vi.fn(),
    } as never;

    const timer = new SnapshotTimer(pool, usageStats);
    timer.start();

    vi.advanceTimersByTime(3_000);
    expect(usageStats.recordSnapshot).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(usageStats.recordSnapshot).toHaveBeenCalledTimes(3);

    timer.stop();
  });
});

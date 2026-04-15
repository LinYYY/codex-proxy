/**
 * SnapshotTimer — periodically records usage stats snapshots for the dashboard.
 *
 * Previously this module also polled GET /codex/usage for each account.
 * That active polling was removed because quota data is now collected passively
 * from response headers on every proxied request (see proxy-handler.ts +
 * rate-limit-headers.ts).  Only the local snapshot recording remains.
 */

import { getConfig } from "../config.js";
import { jitter } from "../utils/jitter.js";
import type { AccountPool } from "./account-pool.js";
import type { UsageStatsStore } from "./usage-stats.js";

const INITIAL_DELAY_MS = 3_000;
const DEFAULT_SNAPSHOT_INTERVAL_MIN = 5;

export class SnapshotTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private pool: AccountPool;
  private usageStats: UsageStatsStore;

  constructor(pool: AccountPool, usageStats: UsageStatsStore) {
    this.pool = pool;
    this.usageStats = usageStats;
  }

  start(): void {
    this.stopped = false;
    const config = getConfig();
    const intervalMin = config.quota.refresh_interval_minutes > 0
      ? config.quota.refresh_interval_minutes
      : DEFAULT_SNAPSHOT_INTERVAL_MIN;

    // Seed the history file immediately so the dashboard can start building
    // a series even when background quota polling is disabled.
    this.usageStats.recordSnapshot(this.pool);

    this.timer = setTimeout(() => {
      this.tick();
    }, INITIAL_DELAY_MS);

    if (config.quota.refresh_interval_minutes === 0) {
      console.log(
        `[SnapshotTimer] quota.refresh_interval_minutes=0; usage-history snapshots continue every ${intervalMin}min`,
      );
    } else {
      console.log(`[SnapshotTimer] Recording snapshots every ${intervalMin}min`);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      this.usageStats.recordSnapshot(this.pool);
    } catch (err) {
      console.warn("[SnapshotTimer] Failed to record snapshot:", err instanceof Error ? err.message : err);
    }
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const config = getConfig();
    const intervalMin = config.quota.refresh_interval_minutes > 0
      ? config.quota.refresh_interval_minutes
      : DEFAULT_SNAPSHOT_INTERVAL_MIN;
    const intervalMs = jitter(intervalMin * 60 * 1000, 0.15);
    this.timer = setTimeout(() => this.tick(), intervalMs);
  }
}

// ── Free function wrappers (backward compatibility) ──────────────────

let _instance: SnapshotTimer | null = null;

export function startQuotaRefresh(
  accountPool: AccountPool,
  usageStats?: UsageStatsStore,
): void {
  _instance?.stop();
  if (!usageStats) return;
  _instance = new SnapshotTimer(accountPool, usageStats);
  _instance.start();
}

export function stopQuotaRefresh(): void {
  _instance?.stop();
  _instance = null;
}

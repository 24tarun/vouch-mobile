const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_RUNS_PER_WINDOW = 20;
const DEFAULT_MIN_INTERVAL_MS = 750;

interface RealtimeRateLimiterOptions {
  label: string;
  callback: () => void;
  maxRunsPerWindow?: number;
  windowMs?: number;
  minIntervalMs?: number;
}

export function createRealtimeRateLimiter({
  label,
  callback,
  maxRunsPerWindow = DEFAULT_MAX_RUNS_PER_WINDOW,
  windowMs = DEFAULT_WINDOW_MS,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
}: RealtimeRateLimiterOptions) {
  const runTimestamps: number[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingRunPending = false;
  let warnedDuringWindow = false;

  function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
    if (timer) clearTimeout(timer);
  }

  function prune(now: number) {
    while (runTimestamps.length > 0 && now - runTimestamps[0] >= windowMs) {
      runTimestamps.shift();
    }

    if (runTimestamps.length === 0) {
      warnedDuringWindow = false;
    }
  }

  function scheduleRetry(delayMs: number, kind: 'debounce' | 'cooldown') {
    trailingRunPending = true;

    if (kind === 'debounce') {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!trailingRunPending) return;
        trailingRunPending = false;
        attemptRun();
      }, delayMs);
      return;
    }

    if (cooldownTimer) return;
    if (!warnedDuringWindow) {
      warnedDuringWindow = true;
      console.warn(
        `[realtime] Suppressing repeated syncs for ${label} after ${maxRunsPerWindow} runs in ${Math.round(windowMs / 1000)}s.`,
      );
    }
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      if (!trailingRunPending) return;
      trailingRunPending = false;
      attemptRun();
    }, delayMs);
  }

  function attemptRun() {
    const now = Date.now();
    prune(now);

    const lastRunAt = runTimestamps[runTimestamps.length - 1] ?? null;
    if (lastRunAt !== null && now - lastRunAt < minIntervalMs) {
      scheduleRetry(minIntervalMs - (now - lastRunAt), 'debounce');
      return;
    }

    if (runTimestamps.length >= maxRunsPerWindow) {
      const resetInMs = Math.max(windowMs - (now - runTimestamps[0]) + 25, minIntervalMs);
      scheduleRetry(resetInMs, 'cooldown');
      return;
    }

    runTimestamps.push(now);
    callback();
  }

  return {
    trigger() {
      attemptRun();
    },
    dispose() {
      clearTimer(debounceTimer);
      clearTimer(cooldownTimer);
      debounceTimer = null;
      cooldownTimer = null;
      trailingRunPending = false;
    },
  };
}

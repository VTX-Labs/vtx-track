/** Time-window helpers shared by the daemon, CLI, and reports. */

/** Start-of-day (local) epoch ms for the day containing `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** End-of-day (local, exclusive) epoch ms for the day containing `at`. */
export function endOfDay(at: number): number {
  return startOfDay(at) + 86_400_000;
}

/** Format an epoch ms as a local `YYYY-MM-DD` date string. */
export function toDateString(at: number): string {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` string to the local start-of-day epoch ms. */
export function fromDateString(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

/** The [from, to) window for the local day containing `at`. */
export function dayRange(at: number): { from: number; to: number } {
  return { from: startOfDay(at), to: endOfDay(at) };
}

/** The [from, to) window for the last `n` days ending now (inclusive of today). */
export function lastNDays(now: number, n: number): { from: number; to: number } {
  return { from: startOfDay(now) - (n - 1) * 86_400_000, to: endOfDay(now) };
}

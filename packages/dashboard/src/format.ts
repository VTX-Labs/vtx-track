/**
 * Pure, dependency-free formatting helpers shared by the browser app and unit
 * tests. Kept free of DOM and Node APIs so they run anywhere.
 */

/**
 * Format a millisecond duration as a compact human string, e.g.
 * `0m`, `45s`, `3m`, `1h 5m`, `12h 0m`. Negative or NaN inputs clamp to `0m`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format a 0..1 share as a whole-number percentage string, e.g. `42%`. Values
 * are clamped into range; non-finite inputs yield `0%`.
 */
export function formatPercent(share: number): string {
  if (!Number.isFinite(share)) return "0%";
  const clamped = Math.max(0, Math.min(1, share));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * Format a one-decimal hours value, e.g. `1.5h`, `0.0h`. Non-finite inputs
 * yield `0.0h`.
 */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0.0h";
  return `${hours.toFixed(1)}h`;
}

/**
 * Format an epoch-ms timestamp as a local `HH:MM` clock string (24-hour).
 */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Format a Date as a local `YYYY-MM-DD` string (the daemon's date format). */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Start-of-day epoch ms for the given date (local time). */
export function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

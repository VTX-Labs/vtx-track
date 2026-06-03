/** Tiny hand-rolled ANSI + rendering helpers (no chalk, per VTX conventions). */
import { BANNER_RAW } from "./banner.js";

// Build the ESC byte in code so this source file contains no raw control
// characters (which some editors/encoders mangle).
const ESC = String.fromCharCode(27);

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function wrap(code: number, s: string): string {
  return useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s;
}

export const color = {
  bold: (s: string) => wrap(1, s),
  dim: (s: string) => wrap(2, s),
  red: (s: string) => wrap(31, s),
  green: (s: string) => wrap(32, s),
  yellow: (s: string) => wrap(33, s),
  blue: (s: string) => wrap(34, s),
  cyan: (s: string) => wrap(36, s),
  gray: (s: string) => wrap(90, s),
};

/** The vtx-track wordmark banner, brand-blue when color is enabled. */
export const BANNER = color.cyan(BANNER_RAW);

/** A solid block char and a light shade, by code point (corruption-proof). */
const FULL_BLOCK = String.fromCodePoint(0x2588); // U+2588 █
const LIGHT_SHADE = String.fromCodePoint(0x2591); // U+2591 ░

/** Render a horizontal bar chart row: label, bar, value. */
export function barRow(
  label: string,
  value: string,
  fraction: number,
  labelWidth: number,
  barWidth = 24,
): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * barWidth);
  const bar =
    color.blue(FULL_BLOCK.repeat(filled)) +
    color.gray(LIGHT_SHADE.repeat(barWidth - filled));
  return `  ${label.padEnd(labelWidth)} ${bar} ${value}`;
}

/** Render a simple two-column table. */
export function table(rows: Array<[string, string]>): string {
  const width = rows.reduce((m, [k]) => Math.max(m, k.length), 0);
  return rows
    .map(([k, v]) => `  ${color.gray(k.padEnd(width))}  ${v}`)
    .join("\n");
}

export function out(s = ""): void {
  process.stdout.write(s + "\n");
}

export function err(s: string): void {
  process.stderr.write(s + "\n");
}

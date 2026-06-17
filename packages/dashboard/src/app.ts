/**
 * vtx-track dashboard — client app.
 *
 * No framework: a set of fetch + render functions wired to the daemon's
 * localhost HTTP API. The timeline uses uPlot; the dot-matrix analytics, focus
 * gauge, segmented hero bar, and live "now" card are hand-rolled SVG/DOM
 * (crisp, accessible, theme-aware). Real app icons come from the daemon's
 * `/icon` endpoint, with a generated letter-badge fallback. AI insights run on
 * Chrome's built-in on-device model when available (nothing leaves the
 * machine), degrading to a computed summary otherwise. Everything runs against
 * 127.0.0.1; if the daemon is offline we show a friendly empty state.
 */
import uPlot from "uplot";
import { DaemonClient, DaemonOfflineError } from "@vtx-track/protocol";
import type {
  FocusReport,
  HealthStatus,
  Segment,
  StandupReport,
  SummaryReport,
} from "@vtx-track/protocol";
import {
  formatDuration,
  formatPercent,
  startOfDay,
  toDateString,
} from "./format.js";
import { aiInsight, computedInsight } from "./ai.js";
import type { Insight, InsightCard } from "./ai.js";
import { askCopilot, chatAvailable } from "./chat.js";
import type { AgentTool, ChatComponent } from "./chat.js";

/** The three range presets the switcher offers. */
type RangePreset = "today" | "7d" | "30d";

interface Range {
  from: number;
  to: number;
}

const BRAND = "#3182ce";
/** Category accent palette — mirrors the CSS --c1..--c8 vars. */
const PALETTE = [
  "#3182ce",
  "#38b2ac",
  "#805ad5",
  "#dd6b20",
  "#d53f8c",
  "#38a169",
  "#e53e3e",
  "#718096",
];
const SVG_NS = "http://www.w3.org/2000/svg";

const client = new DaemonClient({ baseUrl: window.location.origin });

let activePreset: RangePreset = "today";
const charts: uPlot[] = [];
/** Set of app names the daemon has a real icon for (refreshed each load). */
let iconApps = new Set<string>();
/** Latest standup markdown, for the Copy button. */
let lastStandupMarkdown = "";
/** Handle for the live "now" timer interval, cleared on each refresh. */
let nowTimer = 0;
/** Guards the AI insight call so it runs once per data refresh, not per tick. */
let aiToken = 0;

// ── DOM helpers ────────────────────────────────────────────────────────────

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function destroyCharts(): void {
  while (charts.length) charts.pop()?.destroy();
}

function isDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function axisStroke(): string {
  return isDark() ? "#9aa6ba" : "#5a6678";
}

function gridStroke(): string {
  return isDark() ? "rgba(154,166,186,0.13)" : "rgba(90,102,120,0.13)";
}

/** Palette color by index so app bars, donut slices, and legend agree. */
function colorFor(_label: string, index: number): string {
  return PALETTE[index % PALETTE.length] ?? BRAND;
}

/** First letter(s) for a fallback app badge. */
function initials(name: string): string {
  const clean = (name || "?").replace(/\.exe$/i, "").trim();
  return (clean[0] ?? "?").toUpperCase();
}

/** Productive (non-idle, non-locked) segment? */
function isActive(seg: Segment): boolean {
  return seg.state !== "idle" && seg.state !== "locked";
}

// ── Range math ───────────────────────────────────────────────────────────────

function rangeFor(preset: RangePreset): Range {
  const now = Date.now();
  const today = startOfDay(new Date(now));
  if (preset === "today") return { from: today, to: now };
  const days = preset === "7d" ? 7 : 30;
  return { from: today - (days - 1) * 86_400_000, to: now };
}

function presetLabel(preset: RangePreset): string {
  return preset === "today" ? "Today" : preset === "7d" ? "Last 7 days" : "Last 30 days";
}

// ── Status / banner ──────────────────────────────────────────────────────────

function setStatus(text: string, kind: "ok" | "offline" | "warn"): void {
  const dot = el("status-dot");
  const label = el("status-text");
  dot.dataset.kind = kind;
  label.textContent = text;
}

function showWaylandNote(show: boolean): void {
  el("wayland-note").hidden = !show;
}

function showOffline(show: boolean): void {
  el("offline-banner").hidden = !show;
}

// ── Live "now tracking" card ───────────────────────────────────────────────

/**
 * Derive the current activity from the most recent timeline segment. The
 * daemon closes a segment when the app/idle state changes, so the last segment
 * is "what's happening now" (or what just happened). We show the app, a live
 * running timer since it started, and whether it's active or idle.
 */
function renderNow(segments: Segment[], health: HealthStatus | null): void {
  const appEl = el("now-app");
  const timerEl = el("now-timer");
  const metaEl = el("now-meta");
  const pulse = el("now-pulse");

  if (nowTimer) {
    window.clearInterval(nowTimer);
    nowTimer = 0;
  }

  if (!health || health.paused) {
    pulse.dataset.kind = "off";
    appEl.textContent = health?.paused ? "Paused" : "Offline";
    timerEl.textContent = "—";
    metaEl.textContent = health?.paused ? "tracking paused" : "daemon not reachable";
    return;
  }

  // The newest segment by start time.
  const latest = segments.reduce<Segment | null>(
    (best, s) => (!best || s.startedAt > best.startedAt ? s : best),
    null,
  );

  if (!latest) {
    pulse.dataset.kind = "ok";
    appEl.textContent = "Idle";
    timerEl.textContent = "0:00";
    metaEl.textContent = "no activity yet today";
    return;
  }

  const active = isActive(latest);
  pulse.dataset.kind = active ? "ok" : "idle";
  appEl.textContent = active ? latest.app || "Unknown" : "Idle";
  metaEl.textContent = active
    ? latest.category || "uncategorized"
    : latest.state;

  // Live timer counting from the current segment's start.
  const tick = (): void => {
    const elapsed = Date.now() - latest.startedAt;
    timerEl.textContent = clockFromMs(elapsed);
  };
  tick();
  nowTimer = window.setInterval(tick, 1000);
}

/** Format ms as a running clock: `m:ss` under an hour, else `h:mm:ss`. */
function clockFromMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Hero (headline total, segmented focus bar, sparkline) ────────────────────

function renderHero(
  summary: SummaryReport | null,
  segments: Segment[],
  range: Range,
): void {
  el("hero-eyebrow").textContent = presetLabel(activePreset);
  el("hero-total").textContent = summary ? formatDuration(summary.totalMs) : "0m";

  // Segmented bar: active vs idle/locked across the range.
  let activeMs = 0;
  let idleMs = 0;
  for (const seg of segments) {
    if (isActive(seg)) activeMs += seg.durationMs;
    else idleMs += seg.durationMs;
  }
  const totalMs = activeMs + idleMs;
  const seg = el("hero-segbar");
  clear(seg);
  const legend = el("hero-legend");
  clear(legend);
  if (totalMs > 0) {
    const parts: Array<{ label: string; ms: number; color: string }> = [
      { label: "Active", ms: activeMs, color: PALETTE[0]! },
      { label: "Idle", ms: idleMs, color: isDark() ? "#3a4660" : "#cbd5e0" },
    ];
    for (const p of parts) {
      if (p.ms <= 0) continue;
      const fill = document.createElement("div");
      fill.className = "segbar-fill";
      fill.style.width = `${(p.ms / totalMs) * 100}%`;
      fill.style.background = p.color;
      fill.title = `${p.label}: ${formatDuration(p.ms)}`;
      seg.appendChild(fill);

      const lr = document.createElement("span");
      lr.className = "seg-legend-item";
      const dot = document.createElement("span");
      dot.className = "seg-legend-dot";
      dot.style.background = p.color;
      lr.append(dot, document.createTextNode(`${p.label} · ${formatDuration(p.ms)}`));
      legend.appendChild(lr);
    }
  }

  // Sparkline: active minutes bucketed across the range (24 bars).
  const host = el("hero-sparkline");
  clear(host);
  const buckets = bucketActiveMinutes(segments, range, 24);
  const peak = Math.max(1, ...buckets);
  for (const v of buckets) {
    const bar = document.createElement("div");
    bar.className = v >= peak * 0.66 ? "spark-bar hot" : "spark-bar";
    bar.style.height = `${Math.max(2, (v / peak) * 100)}%`;
    bar.title = `${Math.round(v)}m`;
    host.appendChild(bar);
  }
}

/** Sum active (non-idle) minutes into `count` even buckets over the range. */
function bucketActiveMinutes(segments: Segment[], range: Range, count: number): number[] {
  const out = new Array<number>(count).fill(0);
  const span = Math.max(1, range.to - range.from);
  const bucketMs = span / count;
  for (const seg of segments) {
    if (!isActive(seg)) continue;
    let s = Math.max(seg.startedAt, range.from);
    const e = Math.min(seg.endedAt, range.to);
    while (s < e) {
      const idx = Math.min(count - 1, Math.floor((s - range.from) / bucketMs));
      const bucketEnd = range.from + (idx + 1) * bucketMs;
      const slice = Math.min(e, bucketEnd) - s;
      out[idx] = (out[idx] ?? 0) + slice / 60000;
      s = bucketEnd;
    }
  }
  return out;
}

// ── KPI strip ────────────────────────────────────────────────────────────────

function renderKpis(focus: FocusReport | null, summary: SummaryReport | null): void {
  const strip = el("kpi-strip");
  clear(strip);

  const topApp = summary?.rows[0];
  const kpis: Array<{
    value: string;
    label: string;
    hint?: string | undefined;
    accent: string;
  }> = [
    {
      value: focus ? formatDuration(focus.totalActiveMs) : "—",
      label: "Active time",
      hint: focus ? "focused, non-idle" : "pick Today for focus metrics",
      accent: PALETTE[0]!,
    },
    {
      value: focus ? String(focus.contextSwitches) : "—",
      label: "Context switches",
      hint: focus ? `${focus.switchesPerHour.toFixed(1)} / hour` : undefined,
      accent: PALETTE[2]!,
    },
    {
      value: focus ? formatDuration(focus.longestDeepWorkMs) : "—",
      label: "Longest deep work",
      hint: focus ? `${focus.deepWorkSessions} session(s) ≥ 25m` : undefined,
      accent: PALETTE[1]!,
    },
    {
      value: topApp ? formatPercent(topApp.share) : "—",
      label: "Top app share",
      hint: topApp ? topApp.key : undefined,
      accent: PALETTE[3]!,
    },
  ];

  for (const k of kpis) {
    const node = document.createElement("div");
    node.className = "kpi";
    const accent = document.createElement("div");
    accent.className = "kpi-accent";
    accent.style.background = k.accent;
    const v = document.createElement("div");
    v.className = "kpi-value";
    v.textContent = k.value;
    const l = document.createElement("div");
    l.className = "kpi-label";
    l.textContent = k.label;
    node.append(accent, v, l);
    if (k.hint) {
      const h = document.createElement("div");
      h.className = "kpi-hint";
      h.textContent = k.hint;
      node.appendChild(h);
    }
    strip.appendChild(node);
  }
}

// ── Dot-matrix analytics ─────────────────────────────────────────────────────

/**
 * A dot-matrix column chart: one column per bucket (hour of today, or day of a
 * multi-day range), each column a stack of dots whose count encodes active
 * time. Dots light up brand-green from the bottom. Hovering a column shows a
 * tooltip with the bucket label and total. Pure SVG, theme-aware, crisp.
 */
function renderMatrix(segments: Segment[], range: Range): void {
  const host = el("matrix-chart");
  const meta = el("matrix-meta");
  clear(host);

  const isToday = activePreset === "today";
  // Today → 24 hourly columns; multi-day → one column per day.
  const cols = isToday ? 24 : Math.max(1, Math.round((range.to - range.from) / 86_400_000));
  const colMs = isToday ? 3_600_000 : 86_400_000;
  const base = isToday ? startOfDay(new Date(range.from)) : range.from;

  const totals = new Array<number>(cols).fill(0); // active ms per column
  for (const seg of segments) {
    if (!isActive(seg)) continue;
    let s = Math.max(seg.startedAt, base);
    const e = Math.min(seg.endedAt, base + cols * colMs);
    while (s < e) {
      const idx = Math.floor((s - base) / colMs);
      if (idx < 0 || idx >= cols) break;
      const bucketEnd = base + (idx + 1) * colMs;
      totals[idx] = (totals[idx] ?? 0) + (Math.min(e, bucketEnd) - s);
      s = bucketEnd;
    }
  }

  // Each dot = a fixed slice of time; column height scales to the busiest one.
  const ROWS = 12;
  const peak = Math.max(1, ...totals);
  const perDot = peak / ROWS;
  meta.textContent = isToday
    ? "active time · by hour"
    : "active time · by day";

  const W = 1000;
  const H = 280;
  const padL = 8;
  const padB = 26;
  const plotW = W - padL * 2;
  const plotH = H - padB;
  const colW = plotW / cols;
  const dotR = Math.max(2.5, Math.min(5, (colW - 6) / 2));
  const rowGap = plotH / ROWS;

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "matrix-svg",
    preserveAspectRatio: "none",
  });

  const litColor = BRAND;
  const dimColor = isDark() ? "rgba(56,161,105,0.13)" : "rgba(49,130,206,0.12)";

  for (let c = 0; c < cols; c++) {
    const cx = padL + c * colW + colW / 2;
    const lit = Math.round(((totals[c] ?? 0) / perDot));
    for (let r = 0; r < ROWS; r++) {
      const cy = plotH - r * rowGap - rowGap / 2;
      const on = r < lit;
      const dot = svg("circle", {
        cx: cx.toFixed(1),
        cy: cy.toFixed(1),
        r: dotR.toFixed(1),
        fill: on ? litColor : dimColor,
      });
      if (on) dot.setAttribute("opacity", String(0.45 + 0.55 * (r / ROWS)));
      root.appendChild(dot);
    }

    // Hover hit-area + tooltip.
    const label = isToday
      ? hourLabel(c)
      : new Date(base + c * colMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const hit = svg("rect", {
      x: (padL + c * colW).toFixed(1),
      y: 0,
      width: colW.toFixed(1),
      height: plotH.toFixed(1),
      fill: "transparent",
      class: "matrix-hit",
    });
    const title = svg("title", {});
    title.textContent = `${label} · ${formatDuration(totals[c] ?? 0)}`;
    hit.appendChild(title);
    root.appendChild(hit);

    // X-axis labels (sparse so they don't collide).
    const showLabel = isToday ? c % 3 === 0 : cols <= 14 || c % Math.ceil(cols / 14) === 0;
    if (showLabel) {
      const txt = svg("text", {
        x: cx.toFixed(1),
        y: H - 8,
        "text-anchor": "middle",
        class: "matrix-axis",
      });
      txt.textContent = label;
      root.appendChild(txt);
    }
  }

  host.appendChild(root);
}

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

// ── Focus gauge (radial 0..100) ──────────────────────────────────────────────

/**
 * A single focus score (0..100) distilled from focus metrics: rewards deep
 * work and active time, penalizes high context-switching. Rendered as a radial
 * arc gauge.
 */
function renderFocusGauge(focus: FocusReport | null): void {
  const host = el("focus-gauge");
  const meta = el("focus-meta");
  clear(host);

  if (!focus || focus.totalActiveMs <= 0) {
    meta.textContent = "";
    host.appendChild(emptyHint("Pick Today for a focus score."));
    return;
  }

  const score = focusScore(focus);
  meta.textContent = scoreLabel(score);

  const W = 220;
  const H = 150;
  const cx = W / 2;
  const cy = H - 16;
  const radius = 86;
  const stroke = 16;

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "gauge-svg" });
  // Track (180° arc, left→right).
  root.appendChild(
    svg("path", {
      d: arcPath(cx, cy, radius, 180, 360),
      fill: "none",
      stroke: isDark() ? "#2a3344" : "#e8edf4",
      "stroke-width": stroke,
      "stroke-linecap": "round",
    }),
  );
  // Value arc.
  const endAngle = 180 + (score / 100) * 180;
  root.appendChild(
    svg("path", {
      d: arcPath(cx, cy, radius, 180, endAngle),
      fill: "none",
      stroke: scoreColor(score),
      "stroke-width": stroke,
      "stroke-linecap": "round",
    }),
  );
  const value = svg("text", {
    x: cx,
    y: cy - 14,
    "text-anchor": "middle",
    class: "gauge-value",
  });
  value.textContent = String(score);
  const unit = svg("text", { x: cx, y: cy + 6, "text-anchor": "middle", class: "gauge-unit" });
  unit.textContent = "/ 100 focus";
  root.append(value, unit);
  host.appendChild(root);

  // Supporting stat row.
  const stats = document.createElement("div");
  stats.className = "gauge-stats";
  stats.innerHTML = "";
  const items: Array<[string, string]> = [
    ["Deep work", formatDuration(focus.longestDeepWorkMs)],
    ["Switches/hr", focus.switchesPerHour.toFixed(1)],
  ];
  for (const [label, val] of items) {
    const cell = document.createElement("div");
    cell.className = "gauge-stat";
    const v = document.createElement("div");
    v.className = "gauge-stat-val";
    v.textContent = val;
    const l = document.createElement("div");
    l.className = "gauge-stat-label";
    l.textContent = label;
    cell.append(v, l);
    stats.appendChild(cell);
  }
  host.appendChild(stats);
}

/** 0..100 focus score: deep-work and low switching raise it. */
function focusScore(f: FocusReport): number {
  const activeHrs = f.totalActiveMs / 3_600_000;
  // Switching penalty: 0 switches/hr → 1.0, 30+/hr → ~0.
  const switchFactor = Math.max(0, 1 - f.switchesPerHour / 30);
  // Deep-work bonus: longest streak relative to a 50-minute "great" session.
  const deepFactor = Math.min(1, f.longestDeepWorkMs / (50 * 60_000));
  // Volume nudge so a tiny active window can't score perfectly.
  const volumeFactor = Math.min(1, activeHrs / 1);
  const raw = (0.55 * switchFactor + 0.45 * deepFactor) * (0.5 + 0.5 * volumeFactor);
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

function scoreColor(score: number): string {
  if (score >= 70) return "#38a169";
  if (score >= 40) return "#dd6b20";
  return "#e53e3e";
}

function scoreLabel(score: number): string {
  if (score >= 70) return "deep focus";
  if (score >= 40) return "steady";
  return "scattered";
}

/** SVG arc path between two angles (degrees), clockwise. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// ── By app (real icons) ──────────────────────────────────────────────────────

function renderApps(report: SummaryReport | null): void {
  const container = el("summary-app");
  const meta = el("app-count");
  clear(container);

  const rows = report?.rows ?? [];
  if (rows.length === 0) {
    meta.textContent = "";
    container.appendChild(emptyHint("No activity in this range yet."));
    return;
  }
  meta.textContent = `${rows.length} app${rows.length === 1 ? "" : "s"}`;

  const top = rows.slice(0, 10);
  const peak = Math.max(1, top[0]?.durationMs ?? 1);
  const list = document.createElement("div");
  list.className = "applist";

  top.forEach((row, i) => {
    const name = row.key || "Unknown";
    const item = document.createElement("div");
    item.className = "approw";

    // Icon: real PNG when available, else a colored letter badge.
    const badge = document.createElement("div");
    badge.className = "appicon";
    badge.style.background = colorFor(name, i);
    if (iconApps.has(name)) {
      const img = document.createElement("img");
      img.src = client.iconUrl(name);
      img.alt = "";
      img.loading = "lazy";
      // If the icon 404s for any reason, fall back to the letter badge.
      img.addEventListener(
        "error",
        () => {
          img.remove();
          badge.textContent = initials(name);
        },
        { once: true },
      );
      badge.appendChild(img);
    } else {
      badge.textContent = initials(name);
    }

    const main = document.createElement("div");
    main.className = "appmain";
    const nm = document.createElement("div");
    nm.className = "appname";
    nm.textContent = name;
    nm.title = name;
    const track = document.createElement("div");
    track.className = "appbar-track";
    const fill = document.createElement("div");
    fill.className = "appbar-fill";
    fill.style.width = `${Math.max(3, (row.durationMs / peak) * 100)}%`;
    fill.style.background = colorFor(name, i);
    track.appendChild(fill);
    main.append(nm, track);

    const val = document.createElement("div");
    val.className = "appval";
    const t = document.createElement("div");
    t.className = "appval-time";
    t.textContent = formatDuration(row.durationMs);
    const p = document.createElement("div");
    p.className = "appval-pct";
    p.textContent = formatPercent(row.share);
    val.append(t, p);

    item.append(badge, main, val);
    list.appendChild(item);
  });

  container.appendChild(list);
}

// ── By category (donut + legend) ──────────────────────────────────────────────

function renderCategoryDonut(report: SummaryReport | null): void {
  const container = el("summary-category");
  clear(container);

  const rows = (report?.rows ?? []).filter((r) => r.durationMs > 0);
  if (rows.length === 0) {
    container.appendChild(emptyHint("No activity in this range yet."));
    return;
  }

  const total = rows.reduce((sum, r) => sum + r.durationMs, 0) || 1;

  // Build a conic-gradient ring from the shares.
  const stops: string[] = [];
  let acc = 0;
  rows.forEach((r, i) => {
    const start = (acc / total) * 360;
    acc += r.durationMs;
    const end = (acc / total) * 360;
    stops.push(`${colorFor(r.key, i)} ${start}deg ${end}deg`);
  });

  const donut = document.createElement("div");
  donut.className = "donut";
  donut.style.cssText =
    "border-radius:50%;position:relative;" +
    `background:conic-gradient(${stops.join(",")});`;
  const hole = document.createElement("div");
  hole.style.cssText =
    "position:absolute;inset:22%;border-radius:50%;" +
    "background:var(--surface);display:grid;place-items:center;";
  const center = document.createElement("div");
  center.className = "donut-center";
  center.textContent = formatDuration(total);
  hole.appendChild(center);
  donut.appendChild(hole);

  const legend = document.createElement("div");
  legend.className = "legend";
  rows.slice(0, 8).forEach((r, i) => {
    const lr = document.createElement("div");
    lr.className = "legend-row";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = colorFor(r.key, i);
    const nm = document.createElement("span");
    nm.className = "legend-name";
    nm.textContent = r.key || "Uncategorized";
    nm.title = r.key;
    const val = document.createElement("span");
    val.className = "legend-val";
    val.textContent = `${formatDuration(r.durationMs)} · ${formatPercent(r.share)}`;
    lr.append(dot, nm, val);
    legend.appendChild(lr);
  });

  container.append(donut, legend);
}

// ── Generic bar list (projects / languages) ──────────────────────────────────

function renderSummaryBars(containerId: string, report: SummaryReport | null, max = 6): void {
  const container = el(containerId);
  clear(container);

  const rows = (report?.rows ?? []).slice(0, max);
  if (rows.length === 0) {
    container.appendChild(emptyHint("No activity in this range yet."));
    return;
  }

  const list = document.createElement("div");
  list.className = "bars";
  const peak = Math.max(1, rows[0]?.durationMs ?? 1);

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = row.key || "Uncategorized";
    label.title = row.key;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(2, (row.durationMs / peak) * 100)}%`;
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = `${formatDuration(row.durationMs)} · ${formatPercent(row.share)}`;

    item.append(label, track, value);
    list.appendChild(item);
  }
  container.appendChild(list);
}

function emptyHint(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}

// ── Timeline (uPlot) ─────────────────────────────────────────────────────────

function renderTimeline(segments: Segment[], range: Range): void {
  const container = el("timeline-chart");
  const meta = el("timeline-meta");
  clear(container);

  if (segments.length === 0) {
    meta.textContent = "";
    container.appendChild(emptyHint("No timeline segments for this range."));
    return;
  }

  const bucketMs = 15 * 60 * 1000;
  const start = Math.floor(range.from / bucketMs) * bucketMs;
  const end = Math.ceil(range.to / bucketMs) * bucketMs;
  const count = Math.max(1, Math.round((end - start) / bucketMs));
  meta.textContent = "15-minute buckets · active minutes";

  const xs = new Array<number>(count);
  const ys = new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) xs[i] = (start + i * bucketMs) / 1000;

  for (const seg of segments) {
    if (!isActive(seg)) continue;
    let s = Math.max(seg.startedAt, start);
    const e = Math.min(seg.endedAt, end);
    while (s < e) {
      const idx = Math.floor((s - start) / bucketMs);
      const bucketEnd = start + (idx + 1) * bucketMs;
      const slice = Math.min(e, bucketEnd) - s;
      if (idx >= 0 && idx < count) ys[idx] = (ys[idx] ?? 0) + slice / 60000;
      s = bucketEnd;
    }
  }

  const width = container.clientWidth || 640;
  const barsBuilder = uPlot.paths.bars?.({ size: [0.85, 24] });
  const valueSeries: uPlot.Series = {
    label: "Active minutes",
    stroke: BRAND,
    fill: isDark() ? "rgba(49,130,206,0.45)" : "rgba(49,130,206,0.28)",
    width: 2,
    points: { show: false },
    ...(barsBuilder ? { paths: barsBuilder } : {}),
  };
  const opts: uPlot.Options = {
    width,
    height: 220,
    cursor: { y: false },
    scales: { x: { time: true } },
    legend: { show: false },
    axes: [
      {
        stroke: axisStroke(),
        grid: { stroke: gridStroke(), width: 1 },
        ticks: { stroke: gridStroke() },
      },
      {
        stroke: axisStroke(),
        grid: { stroke: gridStroke(), width: 1 },
        ticks: { stroke: gridStroke() },
        values: (_u, vals) => vals.map((v) => `${Math.round(v)}m`),
      },
    ],
    series: [{}, valueSeries],
  };

  const chart = new uPlot(opts, [xs, ys], container);
  charts.push(chart);
}

// ── AI insights (on-device, with computed fallback) ──────────────────────────

function renderAiLoading(): void {
  const host = el("ai-insights");
  clear(host);
  const p = document.createElement("p");
  p.className = "ai-thinking";
  p.textContent = "Analyzing your day…";
  host.appendChild(p);
}

const VIBE_LABEL: Record<Insight["vibe"], string> = {
  "deep-focus": "Deep focus",
  steady: "Steady",
  scattered: "Scattered",
};
const CARD_ICON: Record<InsightCard["kind"], string> = {
  win: "▲",
  watch: "!",
  tip: "✦",
};

/** Render the structured insight as rich components (header, cards, spotlight, action). */
function renderAiResult(insight: Insight, source: "model" | "computed"): void {
  const host = el("ai-insights");
  clear(host);
  el("ai-meta").textContent = source === "model" ? "on-device · Gemini Nano" : "computed";

  // Header: headline + a vibe chip.
  const header = document.createElement("div");
  header.className = "ai-header";
  const headline = document.createElement("div");
  headline.className = "ai-headline";
  headline.textContent = insight.headline;
  const vibe = document.createElement("span");
  vibe.className = "ai-vibe";
  vibe.dataset.vibe = insight.vibe;
  vibe.textContent = VIBE_LABEL[insight.vibe];
  header.append(headline, vibe);
  host.appendChild(header);

  // Body: spotlight app (with real icon) + insight cards.
  const body = document.createElement("div");
  body.className = "ai-grid";

  if (insight.spotlightApp) {
    const spot = document.createElement("div");
    spot.className = "ai-spotlight";
    const name = insight.spotlightApp;
    const badge = document.createElement("div");
    badge.className = "appicon ai-spot-icon";
    badge.style.background = colorFor(name, 0);
    if (iconApps.has(name)) {
      const img = document.createElement("img");
      img.src = client.iconUrl(name);
      img.alt = "";
      img.addEventListener(
        "error",
        () => {
          img.remove();
          badge.textContent = initials(name);
        },
        { once: true },
      );
      badge.appendChild(img);
    } else {
      badge.textContent = initials(name);
    }
    const spotText = document.createElement("div");
    const spotLabel = document.createElement("div");
    spotLabel.className = "ai-spot-label";
    spotLabel.textContent = "Spotlight";
    const spotName = document.createElement("div");
    spotName.className = "ai-spot-name";
    spotName.textContent = name;
    spotText.append(spotLabel, spotName);
    spot.append(badge, spotText);
    body.appendChild(spot);
  }

  const cards = document.createElement("div");
  cards.className = "ai-cards";
  for (const card of insight.cards) {
    const c = document.createElement("div");
    c.className = "ai-card";
    c.dataset.kind = card.kind;
    const icon = document.createElement("span");
    icon.className = "ai-card-icon";
    icon.textContent = CARD_ICON[card.kind];
    const txt = document.createElement("span");
    txt.className = "ai-card-text";
    txt.textContent = card.text;
    c.append(icon, txt);
    cards.appendChild(c);
  }
  body.appendChild(cards);
  host.appendChild(body);

  // Action callout.
  if (insight.action) {
    const action = document.createElement("div");
    action.className = "ai-action";
    const tag = document.createElement("span");
    tag.className = "ai-action-tag";
    tag.textContent = "Try this";
    const txt = document.createElement("span");
    txt.textContent = insight.action;
    action.append(tag, txt);
    host.appendChild(action);
  }
}

/** Build the compact stats the insight is generated from. */
function insightFacts(
  summaryApp: SummaryReport | null,
  summaryCategory: SummaryReport | null,
  focus: FocusReport | null,
): {
  totalMs: number;
  topApps: Array<{ name: string; ms: number; share: number }>;
  topCategories: Array<{ name: string; ms: number; share: number }>;
  focus: FocusReport | null;
} {
  return {
    totalMs: summaryApp?.totalMs ?? 0,
    topApps: (summaryApp?.rows ?? []).slice(0, 5).map((r) => ({
      name: r.key,
      ms: r.durationMs,
      share: r.share,
    })),
    topCategories: (summaryCategory?.rows ?? []).slice(0, 5).map((r) => ({
      name: r.key,
      ms: r.durationMs,
      share: r.share,
    })),
    focus,
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

/** Why a refresh is running — controls whether the (expensive) AI insight reruns. */
type RefreshReason = "initial" | "range" | "interval" | "resize";

/** Re-entrancy guard so overlapping refreshes can't stack or destroy mid-render. */
let refreshing = false;
let pendingReason: RefreshReason | null = null;

/**
 * Refresh the dashboard. The on-device AI insight is only (re)generated on
 * meaningful events — initial load, a range switch, or an explicit request —
 * never on the periodic interval or on resize. On-device inference is heavy
 * (seconds of main-thread work), so running it every 60s froze the tab.
 */
async function refresh(reason: RefreshReason = "interval"): Promise<void> {
  // Coalesce concurrent calls: remember the "strongest" reason and run once.
  if (refreshing) {
    if (reason === "initial" || reason === "range") pendingReason = reason;
    return;
  }
  refreshing = true;
  try {
    await doRefresh(reason);
  } finally {
    refreshing = false;
    if (pendingReason) {
      const next = pendingReason;
      pendingReason = null;
      void refresh(next);
    }
  }
}

async function doRefresh(reason: RefreshReason): Promise<void> {
  const range = rangeFor(activePreset);
  destroyCharts();
  const runAi = reason === "initial" || reason === "range";

  // Health first — drives offline/Wayland states and never blocks reports.
  let health: HealthStatus | null = null;
  try {
    health = await client.health();
  } catch (err) {
    if (err instanceof DaemonOfflineError) {
      setStatus("Daemon offline", "offline");
      showOffline(true);
      showWaylandNote(false);
      guard("now", () => renderNow([], null));
      return;
    }
  }

  showOffline(false);
  if (health) {
    setStatus(
      health.paused ? "Paused" : `Tracking · ${health.platform}`,
      health.paused ? "warn" : "ok",
    );
    showWaylandNote(health.windowIdentificationLimited);
  }

  // Which apps have real icons (best-effort; failure just means letter badges).
  iconApps = new Set(await safe(() => client.iconApps()).then((r) => r?.apps ?? []));

  const today = toDateString(new Date());
  const [byCategory, byApp, segments, focus, standup] = await Promise.all([
    safe(() => client.summary(range, "category")),
    safe(() => client.summary(range, "app")),
    safe(() => client.timeline(range)).then((s) => s ?? []),
    activePreset === "today" ? safe(() => client.focus(today)) : Promise.resolve(null),
    activePreset === "today" ? safe(() => client.standup(today)) : Promise.resolve(null),
  ]);

  guard("now", () => renderNow(segments, health));
  guard("hero", () => renderHero(byApp, segments, range));
  guard("kpis", () => renderKpis(focus, byApp));
  guard("matrix", () => renderMatrix(segments, range));
  guard("apps", () => renderApps(byApp));
  guard("category", () => renderCategoryDonut(byCategory));
  guard("focus", () => renderFocusGauge(focus));
  guard("timeline", () => renderTimeline(segments, range));
  guard("standup", () => renderStandup(standup));

  // AI insight: only on load/range change. Fire-and-forget; token-guarded so a
  // stale call can't overwrite a newer one. On interval/resize we keep the last
  // insight rather than re-running the model.
  if (runAi) {
    const myAiToken = ++aiToken;
    void runAiInsight(myAiToken, byApp, byCategory, focus);
  }

  // Project/language need the VS Code extension; render after the core view.
  const [byProject, byLanguage] = await Promise.all([
    safe(() => client.summary(range, "project")),
    safe(() => client.summary(range, "language")),
  ]);
  guard("projects", () => renderSummaryBars("summary-project", byProject, 6));
  guard("languages", () => renderSummaryBars("summary-language", byLanguage, 6));
}

async function runAiInsight(
  token: number,
  byApp: SummaryReport | null,
  byCategory: SummaryReport | null,
  focus: FocusReport | null,
): Promise<void> {
  if (token !== aiToken) return;
  const facts = insightFacts(byApp, byCategory, focus);
  if (facts.totalMs <= 0) {
    if (token === aiToken) {
      renderAiResult(
        {
          headline: "Nothing tracked yet",
          vibe: "steady",
          cards: [{ kind: "tip", text: "Start working and insights will appear here." }],
          spotlightApp: null,
          action: "",
        },
        "computed",
      );
    }
    return;
  }
  renderAiLoading();
  try {
    const { insight, source } = await aiInsight(facts, presetLabel(activePreset));
    if (token === aiToken) renderAiResult(insight, source);
  } catch {
    if (token === aiToken) renderAiResult(computedInsight(facts), "computed");
  }
}

function renderStandup(standup: StandupReport | null): void {
  const container = el("standup-preview");
  clear(container);
  lastStandupMarkdown = standup?.markdown ?? "";

  if (!standup || !standup.markdown.trim()) {
    container.appendChild(emptyHint("No standup yet — track some time today."));
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "standup";
  pre.textContent = standup.markdown;
  container.appendChild(pre);
}

/**
 * Run one panel's render, isolating failures so a single bad panel can't blank
 * the whole dashboard. Logs which panel failed for diagnosis.
 */
function guard(panel: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[vtx-track] panel "${panel}" failed to render:`, err);
  }
}

/** Run a fetch, swallowing offline/transport errors into null. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ── AI copilot (slide-out chat with tool-calling) ────────────────────────────

/** Parse a human range word into a {from,to}. Defaults to today. */
function parseRange(word: unknown): Range {
  const w = String(word ?? "today").toLowerCase();
  if (w === "7d" || w === "week" || w === "7days" || w.includes("7")) return rangeFor("7d");
  if (w === "30d" || w === "month" || w === "30days" || w.includes("30")) return rangeFor("30d");
  return rangeFor("today");
}

/** Tools the copilot can call — each fetches real numbers from the daemon. */
function copilotTools(): AgentTool[] {
  return [
    {
      name: "get_summary",
      description: "Time grouped by app, category, project, language, or branch for a range.",
      args: {
        range: '"today" | "7d" | "30d"',
        by: '"app" | "category" | "project" | "language" | "branch"',
      },
      async run(args) {
        const by = (["app", "category", "project", "language", "branch"].includes(String(args.by))
          ? args.by
          : "app") as "app" | "category" | "project" | "language" | "branch";
        const r = await client.summary(parseRange(args.range), by);
        return {
          totalMs: r.totalMs,
          total: formatDuration(r.totalMs),
          rows: r.rows.slice(0, 8).map((row) => ({
            key: row.key,
            duration: formatDuration(row.durationMs),
            ms: row.durationMs,
            pct: Math.round(row.share * 100),
          })),
        };
      },
    },
    {
      name: "get_focus",
      description: "Focus metrics for today: active time, context switches/hr, deep-work streak.",
      args: {},
      async run() {
        const f = await client.focus(toDateString(new Date()));
        return {
          activeTime: formatDuration(f.totalActiveMs),
          contextSwitches: f.contextSwitches,
          switchesPerHour: Math.round(f.switchesPerHour * 10) / 10,
          longestDeepWork: formatDuration(f.longestDeepWorkMs),
          deepWorkSessions: f.deepWorkSessions,
          focusScore: focusScore(f),
        };
      },
    },
    {
      name: "get_standup",
      description: "Today's generated standup summary (markdown).",
      args: {},
      async run() {
        const s = await client.standup(toDateString(new Date()));
        return { markdown: s.markdown };
      },
    },
  ];
}

interface ChatTurn {
  role: "user" | "assistant" | "trace";
  text: string;
  components?: ChatComponent[];
}

const chatHistory: ChatTurn[] = [];
let chatBusy = false;
let copilotReady = false;

function openCopilot(): void {
  // The rail docks as inline content: a class on <body> shifts the page and
  // expands the rail (no overlay, no scrim).
  document.body.classList.add("copilot-open");
  el("copilot").setAttribute("aria-hidden", "false");
  if (chatHistory.length === 0) {
    pushChat({
      role: "assistant",
      text: copilotReady
        ? "Hi! Ask me anything about your tracked time — what you focused on, where time went, how to improve."
        : "On-device AI isn't available in this browser, so I'll answer from your live stats where I can. (Chrome 138+ with Gemini Nano enables full chat.)",
    });
  }
  window.setTimeout(() => el<HTMLInputElement>("copilot-text").focus(), 280);
}

function closeCopilot(): void {
  document.body.classList.remove("copilot-open");
  el("copilot").setAttribute("aria-hidden", "true");
}

/** Cap the chat transcript so a very long session can't grow memory/DOM forever. */
const MAX_CHAT_TURNS = 60;

function pushChat(turn: ChatTurn): void {
  chatHistory.push(turn);
  renderChatTurn(turn);
  if (chatHistory.length > MAX_CHAT_TURNS) {
    chatHistory.splice(0, chatHistory.length - MAX_CHAT_TURNS);
    const log = el("copilot-log");
    while (log.childElementCount > MAX_CHAT_TURNS) log.removeChild(log.firstChild as Node);
  }
}

function renderChatTurn(turn: ChatTurn): void {
  const log = el("copilot-log");
  const row = document.createElement("div");
  row.className = `chat-turn chat-${turn.role}`;

  if (turn.role === "trace") {
    row.textContent = turn.text;
  } else {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    if (turn.text) {
      const p = document.createElement("p");
      p.className = "chat-text";
      p.textContent = turn.text;
      bubble.appendChild(p);
    }
    for (const c of turn.components ?? []) bubble.appendChild(renderChatComponent(c));
    row.appendChild(bubble);
  }
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function renderChatComponent(c: ChatComponent): HTMLElement {
  if (c.type === "stat") {
    const box = document.createElement("div");
    box.className = "chat-stat";
    const v = document.createElement("div");
    v.className = "chat-stat-val";
    v.textContent = c.value;
    const l = document.createElement("div");
    l.className = "chat-stat-label";
    l.textContent = c.hint ? `${c.label} · ${c.hint}` : c.label;
    box.append(v, l);
    return box;
  }
  if (c.type === "bars") {
    const box = document.createElement("div");
    box.className = "chat-bars";
    if (c.title) {
      const t = document.createElement("div");
      t.className = "chat-bars-title";
      t.textContent = c.title;
      box.appendChild(t);
    }
    const peak = Math.max(1, ...c.items.map((i) => i.value));
    c.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "chat-bar-row";
      const label = document.createElement("span");
      label.className = "chat-bar-label";
      label.textContent = it.label;
      const track = document.createElement("div");
      track.className = "chat-bar-track";
      const fill = document.createElement("div");
      fill.className = "chat-bar-fill";
      fill.style.width = `${Math.max(3, (it.value / peak) * 100)}%`;
      fill.style.background = colorFor(it.label, i);
      track.appendChild(fill);
      const val = document.createElement("span");
      val.className = "chat-bar-val";
      val.textContent = it.display;
      row.append(label, track, val);
      box.appendChild(row);
    });
    return box;
  }
  if (c.type === "applist") {
    const box = document.createElement("div");
    box.className = "chat-applist";
    if (c.title) {
      const t = document.createElement("div");
      t.className = "chat-bars-title";
      t.textContent = c.title;
      box.appendChild(t);
    }
    const peak = Math.max(1, ...c.items.map((i) => i.value));
    c.items.forEach((it, i) => {
      const name = it.app || "Unknown";
      const row = document.createElement("div");
      row.className = "chat-app-row";

      const badge = document.createElement("div");
      badge.className = "appicon chat-app-icon";
      badge.style.background = colorFor(name, i);
      if (iconApps.has(name)) {
        const img = document.createElement("img");
        img.src = client.iconUrl(name);
        img.alt = "";
        img.addEventListener(
          "error",
          () => {
            img.remove();
            badge.textContent = initials(name);
          },
          { once: true },
        );
        badge.appendChild(img);
      } else {
        badge.textContent = initials(name);
      }

      const main = document.createElement("div");
      main.className = "chat-app-main";
      const nm = document.createElement("div");
      nm.className = "chat-app-name";
      nm.textContent = name;
      nm.title = name;
      const track = document.createElement("div");
      track.className = "chat-bar-track";
      const fill = document.createElement("div");
      fill.className = "chat-bar-fill";
      fill.style.width = `${Math.max(3, (it.value / peak) * 100)}%`;
      fill.style.background = colorFor(name, i);
      track.appendChild(fill);
      main.append(nm, track);

      const val = document.createElement("span");
      val.className = "chat-app-val";
      val.textContent = it.display;

      row.append(badge, main, val);
      box.appendChild(row);
    });
    return box;
  }
  if (c.type === "chips") {
    const box = document.createElement("div");
    box.className = "chat-chips";
    c.items.forEach((name, i) => {
      const chip = document.createElement("span");
      chip.className = "chat-chip";
      const dot = document.createElement("span");
      dot.className = "chat-chip-dot";
      dot.style.background = colorFor(name, i);
      chip.append(dot, document.createTextNode(name));
      box.appendChild(chip);
    });
    return box;
  }
  // callout
  const box = document.createElement("div");
  box.className = "chat-callout";
  box.dataset.tone = c.tone;
  box.textContent = c.text;
  return box;
}

async function submitChat(question: string): Promise<void> {
  if (chatBusy || !question.trim()) return;
  chatBusy = true;
  pushChat({ role: "user", text: question.trim() });

  const thinking = document.createElement("div");
  thinking.className = "chat-turn chat-trace";
  thinking.textContent = "thinking…";
  el("copilot-log").appendChild(thinking);

  try {
    if (!copilotReady) {
      // No on-device model: answer the most common asks from live stats.
      const fallback = await copilotFallback(question);
      thinking.remove();
      pushChat({ role: "assistant", ...fallback });
      return;
    }
    const answer = await askCopilot(question, copilotTools(), {
      onToolCall: (name) => {
        thinking.textContent = `checking ${name.replace(/_/g, " ")}…`;
      },
    });
    thinking.remove();
    pushChat({ role: "assistant", text: answer.text, components: answer.components });
  } catch {
    thinking.remove();
    const fallback = await copilotFallback(question);
    pushChat({ role: "assistant", ...fallback });
  } finally {
    chatBusy = false;
  }
}

/** Deterministic answers when the on-device model is unavailable. */
async function copilotFallback(question: string): Promise<{ text: string; components: ChatComponent[] }> {
  const q = question.toLowerCase();
  try {
    if (q.includes("focus") || q.includes("switch") || q.includes("deep")) {
      const f = await client.focus(toDateString(new Date()));
      return {
        text: `Today you had ${f.contextSwitches} context switches (${f.switchesPerHour.toFixed(1)}/hr) and a longest deep-work stretch of ${formatDuration(f.longestDeepWorkMs)}.`,
        components: [
          { type: "stat", label: "Focus score", value: String(focusScore(f)), hint: scoreLabel(focusScore(f)) },
        ],
      };
    }
    const by = q.includes("categor") ? "category" : "app";
    const range = q.includes("week") || q.includes("7") ? rangeFor("7d") : q.includes("month") || q.includes("30") ? rangeFor("30d") : rangeFor("today");
    const sum = await client.summary(range, by);
    return {
      text: `You tracked ${formatDuration(sum.totalMs)}. Top ${by === "category" ? "categories" : "apps"}:`,
      components: [
        {
          type: "bars",
          items: sum.rows.slice(0, 5).map((r) => ({
            label: r.key || "Unknown",
            value: r.durationMs,
            display: `${formatDuration(r.durationMs)} · ${formatPercent(r.share)}`,
          })),
        },
      ],
    };
  } catch {
    return { text: "I couldn't reach the daemon to answer that.", components: [] };
  }
}

function wireCopilot(): void {
  void chatAvailable().then((ready) => {
    copilotReady = ready;
    const sub = document.getElementById("copilot-sub");
    if (sub) sub.textContent = ready ? "on-device · Gemini Nano" : "stats mode";
  });

  el("copilot-fab").addEventListener("click", () => {
    if (document.body.classList.contains("copilot-open")) closeCopilot();
    else openCopilot();
  });
  el("copilot-close").addEventListener("click", closeCopilot);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("copilot-open")) closeCopilot();
  });

  const form = el<HTMLFormElement>("copilot-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = el<HTMLInputElement>("copilot-text");
    const q = input.value;
    input.value = "";
    void submitChat(q);
  });
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function wireRangeSwitcher(): void {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".range-btn"),
  );
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.range as RangePreset | undefined;
      if (!preset) return;
      activePreset = preset;
      for (const b of buttons) b.classList.toggle("active", b === btn);
      void refresh("range");
    });
  }
}

function wireStandupCopy(): void {
  const btn = document.getElementById("standup-copy");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!lastStandupMarkdown) return;
    try {
      await navigator.clipboard.writeText(lastStandupMarkdown);
      const prev = btn.textContent;
      btn.textContent = "Copied!";
      window.setTimeout(() => {
        btn.textContent = prev;
      }, 1400);
    } catch {
      /* clipboard unavailable; ignore */
    }
  });
}

function start(): void {
  // Each wiring step is isolated: a missing optional element must never abort
  // the whole dashboard (that previously left every panel blank).
  guard("wire-range", wireRangeSwitcher);
  guard("wire-standup", wireStandupCopy);
  guard("wire-copilot", wireCopilot);
  void refresh("initial");

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void refresh("resize"), 250);
  });

  // Periodic refresh so the dashboard stays live without a manual reload. This
  // re-fetches and re-renders the cheap panels but does NOT re-run the on-device
  // AI model. Pause while the tab is hidden to avoid background churn.
  window.setInterval(() => {
    if (!document.hidden) void refresh("interval");
  }, 60_000);

  // Stop the live "now" timer while hidden; resume with a fresh render.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (nowTimer) {
        window.clearInterval(nowTimer);
        nowTimer = 0;
      }
    } else {
      void refresh("interval");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

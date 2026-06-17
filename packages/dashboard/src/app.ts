/**
 * vtx-track dashboard — client app.
 *
 * No framework: a set of fetch + render functions wired to the daemon's
 * localhost HTTP API. The timeline uses uPlot; everything else is hand-rolled
 * DOM (crisp, accessible, theme-aware). Real app icons come from the daemon's
 * `/icon` endpoint, with a generated letter-badge fallback. Everything runs
 * against 127.0.0.1; if the daemon is offline we show a friendly empty state.
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

const client = new DaemonClient({ baseUrl: window.location.origin });

let activePreset: RangePreset = "today";
const charts: uPlot[] = [];
/** Set of app names the daemon has a real icon for (refreshed each load). */
let iconApps = new Set<string>();
/** Latest standup markdown, for the Copy button. */
let lastStandupMarkdown = "";

// ── DOM helpers ────────────────────────────────────────────────────────────

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
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

// ── Hero (headline total + activity sparkline) ────────────────────────────────

function renderHero(summary: SummaryReport | null, segments: Segment[], range: Range): void {
  el("hero-eyebrow").textContent = presetLabel(activePreset);
  el("hero-total").textContent = summary ? formatDuration(summary.totalMs) : "0m";

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
    if (seg.state === "idle" || seg.state === "locked") continue;
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
      img.addEventListener("error", () => {
        img.remove();
        badge.textContent = initials(name);
      });
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
    if (seg.state === "idle" || seg.state === "locked") continue;
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

// ── Standup preview ──────────────────────────────────────────────────────────

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

// ── Orchestration ────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  const range = rangeFor(activePreset);
  destroyCharts();

  // Health first — drives offline/Wayland states and never blocks reports.
  let health: HealthStatus | null = null;
  try {
    health = await client.health();
  } catch (err) {
    if (err instanceof DaemonOfflineError) {
      setStatus("Daemon offline", "offline");
      showOffline(true);
      showWaylandNote(false);
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

  guard("hero", () => renderHero(byApp, segments, range));
  guard("kpis", () => renderKpis(focus, byApp));
  guard("apps", () => renderApps(byApp));
  guard("category", () => renderCategoryDonut(byCategory));
  guard("timeline", () => renderTimeline(segments, range));
  guard("standup", () => renderStandup(standup));

  // Project/language need the VS Code extension; render after the core view.
  const [byProject, byLanguage] = await Promise.all([
    safe(() => client.summary(range, "project")),
    safe(() => client.summary(range, "language")),
  ]);
  guard("projects", () => renderSummaryBars("summary-project", byProject, 6));
  guard("languages", () => renderSummaryBars("summary-language", byLanguage, 6));
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
      void refresh();
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
  wireRangeSwitcher();
  wireStandupCopy();
  void refresh();

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void refresh(), 200);
  });

  // Periodic refresh so the dashboard stays live without a manual reload.
  window.setInterval(() => void refresh(), 60_000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

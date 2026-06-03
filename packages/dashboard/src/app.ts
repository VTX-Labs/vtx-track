/**
 * vtx-track dashboard — client app.
 *
 * No framework: a small set of fetch + render functions wired to the daemon's
 * localhost HTTP API. Charts use uPlot. Everything runs against 127.0.0.1; if
 * the daemon is offline we show a friendly empty state instead of erroring.
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
  formatClock,
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

const client = new DaemonClient({ baseUrl: window.location.origin });

let activePreset: RangePreset = "today";
const charts: uPlot[] = [];

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
  return isDark() ? "#a0aec0" : "#4a5568";
}

function gridStroke(): string {
  return isDark() ? "rgba(160,174,192,0.15)" : "rgba(74,85,104,0.15)";
}

// ── Range math ───────────────────────────────────────────────────────────────

function rangeFor(preset: RangePreset): Range {
  const now = Date.now();
  const today = startOfDay(new Date(now));
  if (preset === "today") return { from: today, to: now };
  const days = preset === "7d" ? 7 : 30;
  return { from: today - (days - 1) * 86_400_000, to: now };
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

// ── Summary bar charts ───────────────────────────────────────────────────────

/**
 * Render a horizontal-ish bar list for a grouped summary. uPlot draws vertical
 * bars; we keep it readable by capping to the top rows and labeling each bar via
 * the value axis. For dense lists this beats a cramped canvas.
 */
function renderSummaryBars(
  containerId: string,
  report: SummaryReport,
  max = 8,
): void {
  const container = el(containerId);
  clear(container);

  const rows = report.rows.slice(0, max);
  if (rows.length === 0) {
    container.appendChild(emptyHint("No activity in this range yet."));
    return;
  }

  // Simple, dependency-light bar list (DOM, not canvas) — crisp and accessible.
  const list = document.createElement("div");
  list.className = "bars";
  const top = rows[0];
  const peak = top ? Math.max(top.durationMs, 1) : 1;

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

/**
 * Render the day's active-minutes timeline as a uPlot bar/area chart, bucketed
 * into 15-minute slots across the selected range. Active and idle-prevented time
 * is summed per bucket so the shape reflects when the day was busy.
 */
function renderTimeline(segments: Segment[], range: Range): void {
  const container = el("timeline-chart");
  clear(container);

  if (segments.length === 0) {
    container.appendChild(emptyHint("No timeline segments for this range."));
    return;
  }

  const bucketMs = 15 * 60 * 1000;
  const start = Math.floor(range.from / bucketMs) * bucketMs;
  const end = Math.ceil(range.to / bucketMs) * bucketMs;
  const count = Math.max(1, Math.round((end - start) / bucketMs));

  const xs = new Array<number>(count);
  const ys = new Array<number>(count).fill(0);
  for (let i = 0; i < count; i++) xs[i] = (start + i * bucketMs) / 1000;

  for (const seg of segments) {
    if (seg.state === "idle" || seg.state === "locked") continue;
    // Spread the segment's duration across the buckets it overlaps.
    let s = Math.max(seg.startedAt, start);
    const e = Math.min(seg.endedAt, end);
    while (s < e) {
      const idx = Math.floor((s - start) / bucketMs);
      const bucketEnd = start + (idx + 1) * bucketMs;
      const slice = Math.min(e, bucketEnd) - s;
      if (idx >= 0 && idx < count) ys[idx] = (ys[idx] ?? 0) + slice / 60000; // minutes
      s = bucketEnd;
    }
  }

  const width = container.clientWidth || 640;
  const barsBuilder = uPlot.paths.bars?.({ size: [0.85, 24] });
  const valueSeries: uPlot.Series = {
    label: "Active minutes",
    stroke: BRAND,
    fill: isDark() ? "rgba(49,130,206,0.35)" : "rgba(49,130,206,0.20)",
    width: 2,
    points: { show: false },
    ...(barsBuilder ? { paths: barsBuilder } : {}),
  };
  const opts: uPlot.Options = {
    width,
    height: 200,
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

// ── Focus cards ────────────────────────────────────────────────────────────

function renderFocus(focus: FocusReport | null): void {
  const container = el("focus-cards");
  clear(container);

  if (!focus) {
    container.appendChild(emptyHint("Focus metrics are per-day; pick Today."));
    return;
  }

  const cards: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Active today", value: formatDuration(focus.totalActiveMs) },
    {
      label: "Context switches",
      value: String(focus.contextSwitches),
      hint: `${focus.switchesPerHour.toFixed(1)}/hr`,
    },
    {
      label: "Longest deep work",
      value: formatDuration(focus.longestDeepWorkMs),
    },
    {
      label: "Deep-work sessions",
      value: String(focus.deepWorkSessions),
      hint: "≥ 25 min",
    },
  ];

  for (const card of cards) {
    const node = document.createElement("div");
    node.className = "card";
    const v = document.createElement("div");
    v.className = "card-value";
    v.textContent = card.value;
    const l = document.createElement("div");
    l.className = "card-label";
    l.textContent = card.label;
    node.append(v, l);
    if (card.hint) {
      const h = document.createElement("div");
      h.className = "card-hint";
      h.textContent = card.hint;
      node.appendChild(h);
    }
    container.appendChild(node);
  }
}

// ── Standup preview ──────────────────────────────────────────────────────────

function renderStandup(standup: StandupReport | null): void {
  const container = el("standup-preview");
  clear(container);

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

  // Health first — it drives the offline/Wayland states and never blocks reports.
  let health: HealthStatus | null = null;
  try {
    health = await client.health();
  } catch (err) {
    if (err instanceof DaemonOfflineError) {
      setStatus("Daemon offline", "offline");
      showOffline(true);
      showWaylandNote(false);
      clearAllSections();
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

  const today = toDateString(new Date());

  const [byCategory, byApp, segments, focus, standup] = await Promise.all([
    safe(() => client.summary(range, "category")),
    safe(() => client.summary(range, "app")),
    safe(() => client.timeline(range)),
    activePreset === "today" ? safe(() => client.focus(today)) : Promise.resolve(null),
    activePreset === "today" ? safe(() => client.standup(today)) : Promise.resolve(null),
  ]);

  if (byCategory) renderSummaryBars("summary-category", byCategory);
  if (byApp) renderSummaryBars("summary-app", byApp);
  renderTimeline(segments ?? [], range);

  // Top projects + languages (project/language summaries reuse the bar list).
  const [byProject, byLanguage] = await Promise.all([
    safe(() => client.summary(range, "project")),
    safe(() => client.summary(range, "language")),
  ]);
  if (byProject) renderSummaryBars("summary-project", byProject, 6);
  if (byLanguage) renderSummaryBars("summary-language", byLanguage, 6);

  renderFocus(focus);
  renderStandup(standup);
}

function clearAllSections(): void {
  for (const id of [
    "summary-category",
    "summary-app",
    "summary-project",
    "summary-language",
    "timeline-chart",
    "focus-cards",
    "standup-preview",
  ]) {
    const node = document.getElementById(id);
    if (node) {
      clear(node);
      node.appendChild(emptyHint("Start the daemon to see your data."));
    }
  }
}

/** Run a fetch, swallowing offline/transport errors into null so one failure can't blank the page. */
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

function start(): void {
  wireRangeSwitcher();
  void refresh();

  // Re-render charts on resize so uPlot stays crisp; debounced lightly.
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

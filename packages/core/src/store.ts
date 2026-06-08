import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import Database from "better-sqlite3";
import type { Segment, VsCodeContext, BrowserContext } from "@vtx-track/protocol";
import type { PendingSegment } from "./sessionizer.js";
import { DEFAULT_CATEGORY_COLORS } from "./categorize.js";

const SCHEMA_VERSION = 1;

/** A row returned from segment queries, joined with app + contexts. */
interface SegmentRow {
  id: number;
  app: string;
  exe_path: string;
  category: string;
  title: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  state: string;
  host: string;
  vs_workspace: string | null;
  vs_repo: string | null;
  vs_branch: string | null;
  vs_file: string | null;
  vs_language: string | null;
  vs_mode: string | null;
  vs_active_edit: number | null;
  br_domain: string | null;
  br_tab_title: string | null;
  vs_pid: number | null;
  br_pid: number | null;
}

/**
 * The local SQLite store. Owns the schema and all reads/writes of the timeline.
 * Opened in WAL mode so the CLI and dashboard can read while the daemon writes.
 */
export class Store {
  readonly db: Database.Database;
  private readonly host: string;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    try {
      this.db = new Database(dbPath);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      // A missing/incompatible native binding surfaces here as a bindings error.
      if (/bindings file|\.node|NODE_MODULE_VERSION|was compiled against/i.test(msg)) {
        throw new Error(
          "vtx-track could not load the SQLite native binding (better-sqlite3). " +
            "It is missing or built for a different Node version. The daemon " +
            "normally fetches it automatically on start; if you hit this " +
            "elsewhere, run `node scripts/native-bootstrap.mjs` from the " +
            `install directory. Original error: ${msg}`,
        );
      }
      throw e;
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.host = this.machineId();
  }

  /** Persist a closed segment and return its full {@link Segment} form. */
  insertSegment(seg: PendingSegment): Segment {
    const appId = this.upsertApp(seg.app, seg.appExePath, seg.category);
    const info = this.db
      .prepare(
        `INSERT INTO segment
           (app_id, title, started_at, ended_at, duration_ms, state, host)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        appId,
        seg.title,
        seg.startedAt,
        seg.endedAt,
        seg.durationMs,
        seg.state,
        this.host,
      );
    const segmentId = Number(info.lastInsertRowid);

    if (seg.vscode) this.insertVsCode(segmentId, seg.vscode);
    if (seg.browser) this.insertBrowser(segmentId, seg.browser);

    return {
      id: segmentId,
      app: seg.app,
      appExePath: seg.appExePath,
      category: seg.category,
      title: seg.title,
      startedAt: seg.startedAt,
      endedAt: seg.endedAt,
      durationMs: seg.durationMs,
      state: seg.state,
      host: this.host,
      ...(seg.vscode ? { vscode: seg.vscode } : {}),
      ...(seg.browser ? { browser: seg.browser } : {}),
    };
  }

  /** Append an event to the audit log. */
  logEvent(at: number, kind: string, detail?: unknown): void {
    this.db
      .prepare(`INSERT INTO event (at, kind, detail) VALUES (?, ?, ?)`)
      .run(at, kind, detail === undefined ? null : JSON.stringify(detail));
  }

  /** All segments overlapping the [from, to) window, ordered by start. */
  segmentsBetween(from: number, to: number): Segment[] {
    const rows = this.db
      .prepare<[number, number], SegmentRow>(SEGMENT_SELECT + ORDER)
      .all(to, from);
    return rows.map(rowToSegment);
  }

  /** Delete every segment, app, and event. Returns the number of segments removed. */
  wipe(): number {
    const count = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM segment`).get() as {
        n: number;
      }
    ).n;
    // Segments, apps, and the event log are user data and are deleted.
    // Categories are configuration (colours + built-ins) and are preserved.
    this.db.exec(`DELETE FROM segment; DELETE FROM app; DELETE FROM event;`);
    return count;
  }

  /** Stable per-machine identifier, persisted in the meta table. */
  private machineId(): string {
    const existing = this.db
      .prepare(`SELECT value FROM meta WHERE key = 'host'`)
      .get() as { value: string } | undefined;
    if (existing) return existing.value;
    const id = hostname() || "unknown-host";
    this.db
      .prepare(`INSERT INTO meta (key, value) VALUES ('host', ?)`)
      .run(id);
    return id;
  }

  private upsertApp(name: string, exePath: string, category: string): number {
    const categoryId = this.upsertCategory(category);
    this.db
      .prepare(
        `INSERT INTO app (name, exe_path, category_id) VALUES (?, ?, ?)
         ON CONFLICT(name, exe_path) DO UPDATE SET category_id = excluded.category_id`,
      )
      .run(name, exePath, categoryId);
    const row = this.db
      .prepare(`SELECT id FROM app WHERE name = ? AND exe_path = ?`)
      .get(name, exePath) as { id: number };
    return row.id;
  }

  private upsertCategory(name: string): number {
    const color = DEFAULT_CATEGORY_COLORS[name] ?? "#a0aec0";
    this.db
      .prepare(
        `INSERT INTO category (name, color) VALUES (?, ?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run(name, color);
    const row = this.db
      .prepare(`SELECT id FROM category WHERE name = ?`)
      .get(name) as { id: number };
    return row.id;
  }

  private insertVsCode(segmentId: number, vs: VsCodeContext): void {
    this.db
      .prepare(
        `INSERT INTO vscode_context
           (segment_id, pid, workspace, repo, branch, file_path, language, mode, active_edit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        segmentId,
        vs.pid,
        vs.workspace ?? null,
        vs.repo ?? null,
        vs.branch ?? null,
        vs.filePath ?? null,
        vs.language ?? null,
        vs.mode,
        vs.activelyTyping ? 1 : 0,
      );
  }

  private insertBrowser(segmentId: number, br: BrowserContext): void {
    this.db
      .prepare(
        `INSERT INTO browser_context (segment_id, pid, domain, tab_title)
         VALUES (?, ?, ?, ?)`,
      )
      .run(segmentId, br.pid, br.domain, br.tabTitle ?? null);
  }

  /** Create or migrate the schema based on `user_version`. */
  private migrate(): void {
    const version = (
      this.db.pragma("user_version", { simple: true }) as number
    );
    if (version < 1) {
      this.db.exec(MIGRATION_1);
      this.seedCategories();
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
    // Future migrations: `if (version < 2) { … }`.
  }

  private seedCategories(): void {
    const insert = this.db.prepare(
      `INSERT INTO category (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`,
    );
    const tx = this.db.transaction(() => {
      for (const [name, color] of Object.entries(DEFAULT_CATEGORY_COLORS)) {
        insert.run(name, color);
      }
    });
    tx();
  }

  /** Close the database handle. */
  close(): void {
    this.db.close();
  }
}

const SEGMENT_SELECT = `
  SELECT s.id, a.name AS app, a.exe_path, c.name AS category, s.title,
         s.started_at, s.ended_at, s.duration_ms, s.state, s.host,
         v.workspace AS vs_workspace, v.repo AS vs_repo, v.branch AS vs_branch,
         v.file_path AS vs_file, v.language AS vs_language, v.mode AS vs_mode,
         v.active_edit AS vs_active_edit, v.pid AS vs_pid,
         b.domain AS br_domain, b.tab_title AS br_tab_title, b.pid AS br_pid
    FROM segment s
    JOIN app a ON a.id = s.app_id
    JOIN category c ON c.id = a.category_id
    LEFT JOIN vscode_context v ON v.segment_id = s.id
    LEFT JOIN browser_context b ON b.segment_id = s.id
   WHERE s.started_at < ? AND s.ended_at > ?`;

const ORDER = ` ORDER BY s.started_at ASC`;

function rowToSegment(r: SegmentRow): Segment {
  const seg: Segment = {
    id: r.id,
    app: r.app,
    appExePath: r.exe_path,
    category: r.category,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    state: r.state as Segment["state"],
    host: r.host,
  };
  if (r.vs_mode !== null) {
    seg.vscode = {
      pid: r.vs_pid ?? -1,
      mode: r.vs_mode as VsCodeContext["mode"],
      activelyTyping: r.vs_active_edit === 1,
      ...(r.vs_workspace !== null ? { workspace: r.vs_workspace } : {}),
      ...(r.vs_repo !== null ? { repo: r.vs_repo } : {}),
      ...(r.vs_branch !== null ? { branch: r.vs_branch } : {}),
      ...(r.vs_file !== null ? { filePath: r.vs_file } : {}),
      ...(r.vs_language !== null ? { language: r.vs_language } : {}),
    };
  }
  if (r.br_domain !== null) {
    seg.browser = {
      pid: r.br_pid ?? -1,
      domain: r.br_domain,
      ...(r.br_tab_title !== null ? { tabTitle: r.br_tab_title } : {}),
    };
  }
  return seg;
}

const MIGRATION_1 = `
CREATE TABLE category (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE app (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  exe_path     TEXT NOT NULL,
  display_name TEXT,
  category_id  INTEGER REFERENCES category(id),
  UNIQUE(name, exe_path)
);

CREATE TABLE segment (
  id          INTEGER PRIMARY KEY,
  app_id      INTEGER NOT NULL REFERENCES app(id),
  title       TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  state       TEXT NOT NULL,
  host        TEXT NOT NULL
);
CREATE INDEX idx_segment_started ON segment(started_at);
CREATE INDEX idx_segment_app ON segment(app_id, started_at);

CREATE TABLE vscode_context (
  segment_id  INTEGER PRIMARY KEY REFERENCES segment(id) ON DELETE CASCADE,
  pid         INTEGER,
  workspace   TEXT,
  repo        TEXT,
  branch      TEXT,
  file_path   TEXT,
  language    TEXT,
  mode        TEXT,
  active_edit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE browser_context (
  segment_id INTEGER PRIMARY KEY REFERENCES segment(id) ON DELETE CASCADE,
  pid        INTEGER,
  domain     TEXT,
  tab_title  TEXT
);

CREATE TABLE event (
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`;

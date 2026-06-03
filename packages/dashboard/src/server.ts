import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve, sep } from "node:path";

/**
 * A static-file handler: returns true if it served the request, false if the
 * request was not for the dashboard (so the daemon can fall through to its 404).
 */
export type StaticHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => boolean;

/** Map of file extension (lowercase, no dot) to Content-Type. */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
};

/**
 * Resolve the Content-Type for a path by its extension. Falls back to
 * `application/octet-stream` for anything unrecognized.
 */
export function contentTypeFor(pathname: string): string {
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  const ext = pathname.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Decode and normalize a URL path into a filesystem-relative path under `root`,
 * or return null if the result escapes `root` (path traversal) or is otherwise
 * unsafe. Routes `/` and `/dashboard` to `index.html`.
 */
export function resolveStaticPath(
  urlPath: string,
  root: string,
): string | null {
  // Strip the query/hash; the daemon may pass the raw req.url.
  let pathname = urlPath.split("?")[0]?.split("#")[0] ?? "/";

  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // Reject NUL bytes outright.
  if (pathname.includes("\0")) return null;

  // Map the app's two entry routes to the shell.
  if (pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/") {
    pathname = "/index.html";
  }

  // Normalize separators so "\" on Windows can't be smuggled past the check.
  const cleaned = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
  const candidate = resolve(root, normalize(cleaned));

  // Containment check: the candidate must live inside root.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return null;
  }
  return candidate;
}

/** Directory holding the built static assets (index.html, app.js, styles.css, uPlot CSS). */
function publicRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "public");
}

/**
 * Create a static handler that serves the dashboard's built assets from this
 * package's `dist/public/`. Only GET/HEAD requests for existing files under the
 * public root are served; everything else returns false so the daemon falls
 * through to its own routing (and ultimately a 404).
 */
export function createStaticHandler(): StaticHandler {
  const root = resolve(publicRoot());

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") return false;

    const filePath = resolveStaticPath(req.url ?? "/", root);
    if (!filePath) return false;

    if (!existsSync(filePath)) return false;
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypeFor(filePath));
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "no-cache");

    if (method === "HEAD") {
      res.end();
      return true;
    }

    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
    return true;
  };
}

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Runtime self-heal for `better-sqlite3`'s native binding.
 *
 * The store's binding is normally wired up at install time, but pnpm blocks
 * dependency scripts and an `ignore-scripts=true` npmrc disables the root
 * postinstall entirely — leaving the binary missing and the daemon unable to
 * open SQLite. Rather than fail with a cryptic "Could not locate the bindings
 * file" error, the daemon calls {@link ensureSqliteBinding} before constructing
 * the store: if the binary is missing it fetches the matching prebuilt one
 * (from the package's own `prebuild-install`, or directly from GitHub Releases)
 * so a scripts-disabled install just works on first start.
 *
 * This mirrors `scripts/native-bootstrap.mjs` but is self-contained in the
 * daemon so it survives bundling and any install layout.
 */

const isWindows = process.platform === "win32";
const ABI = process.versions.modules;
const BINARY = ["build", "Release", "better_sqlite3.node"] as const;

/**
 * Resolve better-sqlite3's install directory, or null if not installed.
 *
 * better-sqlite3 is a dependency of `@vtx-track/core`, not of the daemon, so
 * under pnpm's strict layout we can't resolve it from the daemon's own scope.
 * We anchor resolution at `@vtx-track/core` (which does depend on it), then fall
 * back to the daemon's own scope for flat/hoisted installs (e.g. global npm).
 */
function betterSqliteDir(): string | null {
  const anchors: string[] = [import.meta.url];
  // Anchor at @vtx-track/core's resolved entry file too — better-sqlite3 is
  // core's dependency, so under pnpm's strict layout it resolves from core's
  // scope, not the daemon's. core's `exports` map exposes only the `import`
  // condition, so we use the ESM resolver (import.meta.resolve), which honors
  // it, rather than the CJS createRequire resolver.
  try {
    anchors.push(import.meta.resolve("@vtx-track/core"));
  } catch {
    /* core not resolvable from here — the daemon's own scope still applies */
  }

  for (const anchor of anchors) {
    try {
      const require = createRequire(anchor);
      return dirname(require.resolve("better-sqlite3/package.json"));
    } catch {
      // try the next anchor
    }
  }
  return null;
}

function readVersion(dir: string): string | null {
  try {
    return createRequire(join(dir, "package.json"))("./package.json").version;
  } catch {
    return null;
  }
}

/** Extract a `.tar.gz` into `dest`, handling Windows tar's drive-letter quirk. */
function extractTarball(tarball: string, basename: string, dest: string): void {
  if (isWindows) {
    const local = join(dest, basename);
    if (local !== tarball) copyFileSync(tarball, local);
    try {
      execFileSync("tar", ["--force-local", "-xzf", basename], {
        cwd: dest,
        stdio: "ignore",
        shell: false,
      });
    } finally {
      if (local !== tarball) rmSync(local, { force: true });
    }
  } else {
    execFileSync("tar", ["-xzf", tarball, "-C", dest], {
      stdio: "ignore",
      shell: false,
    });
  }
}

function tryPrebuildInstall(dir: string, binary: string): boolean {
  const bin = join(
    dir,
    "node_modules",
    ".bin",
    isWindows ? "prebuild-install.CMD" : "prebuild-install",
  );
  if (!existsSync(bin)) return false;
  try {
    execFileSync(bin, [], { cwd: dir, stdio: "ignore", shell: isWindows });
  } catch {
    /* fall through to the network fallback */
  }
  return existsSync(binary);
}

async function tryGithubRelease(
  dir: string,
  binary: string,
  version: string,
): Promise<boolean> {
  const asset = `better-sqlite3-v${version}-node-v${ABI}-${process.platform}-${process.arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`;
  const tmp = mkdtempSync(join(tmpdir(), "vtx-native-"));
  const tarball = join(tmp, asset);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) return false;
    await pipeline(
      res.body as unknown as NodeJS.ReadableStream,
      createWriteStream(tarball),
    );
    extractTarball(tarball, asset, dir);
    return existsSync(binary);
  } catch {
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Ensure `better-sqlite3`'s native binding is present, fetching it if not.
 * Returns true if the binding is available (already or after a fetch). Never
 * throws — callers surface a friendly error if this returns false.
 */
export async function ensureSqliteBinding(
  log: (msg: string) => void = () => {},
): Promise<boolean> {
  const dir = betterSqliteDir();
  if (!dir) return false;
  const binary = join(dir, ...BINARY);
  if (existsSync(binary)) return true;

  const version = readVersion(dir);
  log("vtx-track: preparing the SQLite native binding (first run)…");

  if (tryPrebuildInstall(dir, binary)) return true;
  if (version && (await tryGithubRelease(dir, binary, version))) return true;
  return existsSync(binary);
}

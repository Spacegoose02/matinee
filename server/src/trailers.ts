// Local trailers: the file Plex and Jellyfin both pick up is "<folder name>-trailer.mp4" next to the title.
// Matinee finds the YouTube trailer (TMDB's list, else a YouTube search) and downloads it with yt-dlp.
import { spawn } from "node:child_process";
import { access, constants, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { MEDIA_DIR, isDirectory } from "./storage.js";

const VIDEO = /\.(mp4|mkv|webm|m4v|mov|avi)$/i;
const TRAILER_FOLDERS = new Set(["trailers", "trailer"]);

export interface TrailerFile { name: string; sizeBytes: number; path: string }

/** An existing trailer: "*-trailer.ext" beside the title, or a video in a "Trailers" subfolder. */
export async function findTrailer(folder: string): Promise<TrailerFile | undefined> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (e.isFile() && VIDEO.test(e.name) && /(-trailer\.[^.]+$)|^trailer\.[^.]+$/i.test(e.name)) {
      return { name: e.name, path: join(folder, e.name), sizeBytes: (await stat(join(folder, e.name)).catch(() => undefined))?.size ?? 0 };
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && TRAILER_FOLDERS.has(e.name.toLowerCase())) {
      try {
        const inside = (await readdir(join(folder, e.name))).find((n) => VIDEO.test(n));
        if (inside) return { name: `${e.name}/${inside}`, path: join(folder, e.name, inside), sizeBytes: (await stat(join(folder, e.name, inside)).catch(() => undefined))?.size ?? 0 };
      } catch { /* unreadable subfolder: treat as no trailer */ }
    }
  }
  return undefined;
}

export const canWrite = (folder: string) => access(folder, constants.W_OK).then(() => true, () => false);

/**
 * Where a manager's folder lives inside Matinee: through the Storage path mapping if there is one,
 * otherwise by trying the path with leading parts dropped under the media mount.
 */
export function localFolder(managerPath: string, mapped: { root: string; local: string } | undefined): string | undefined {
  if (mapped) {
    const rest = managerPath.slice(mapped.root.length).replace(/^[\/]+/, "");
    return join(mapped.local, rest);
  }
  const parts = managerPath.split(/[\/]+/).filter(Boolean);
  for (let drop = 0; drop < Math.min(parts.length, 4); drop++) {
    const candidate = join(MEDIA_DIR, ...parts.slice(drop));
    if (isDirectory(candidate)) return candidate;
  }
  return undefined;
}

export function runYtDlp(args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const take = (d: Buffer) => { out = (out + d.toString()).slice(-4000); };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, out: (err as NodeJS.ErrnoException).code === "ENOENT" ? "yt-dlp is not installed in this image" : String(err) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
  });
}

export async function ytDlpVersion(): Promise<string | undefined> {
  const r = await runYtDlp(["--version"], 15_000);
  return r.code === 0 ? r.out.trim() : undefined;
}

/** Download one trailer next to the title. `source` is a YouTube URL or a "ytsearch1:" query. */
export async function downloadTrailer(folder: string, source: string): Promise<{ ok: boolean; message?: string }> {
  const base = basename(folder).replace(/%/g, "%%");
  const out = join(folder, `${base}-trailer.%(ext)s`);
  const r = await runYtDlp([
    "--no-playlist", "--no-progress", "--no-warnings",
    "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4", "--max-filesize", "600M", "--match-filter", "duration<600",
    "-o", out, source,
  ]);
  if (r.code !== 0) {
    const line = r.out.trim().split("\n").filter(Boolean).pop() ?? "yt-dlp failed";
    return { ok: false, message: line.replace(/^ERROR:\s*/, "") };
  }
  return { ok: true };
}

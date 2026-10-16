// Real disk space. A manager only knows the free space of the folder as it sees it inside its own
// container, which is wrong whenever the mount isn't a plain share. If the same share is mounted into
// Matinee (read-only is enough), Matinee can measure it itself once told which folder is which.
import { existsSync, statSync } from "node:fs";
import { access, opendir, readdir, statfs } from "node:fs/promises";
import { join } from "node:path";

export const MEDIA_DIR = process.env.MEDIA_DIR ?? "/media";

export interface DiskSpace { totalBytes: number; freeBytes: number }

export async function diskSpace(path: string): Promise<DiskSpace> {
  const s = await statfs(path);
  return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
}

export const isDirectory = (path: string) => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** What Matinee can actually see under the media mount: Docker makes an empty folder even if the share isn't visible. */
export async function inspectMedia(): Promise<{ mediaMounted: boolean; mediaEntries: string[]; mediaReadError?: string }> {
  if (!isDirectory(MEDIA_DIR)) return { mediaMounted: false, mediaEntries: [] };
  try {
    const entries = await readdir(MEDIA_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort((a, b) => a.localeCompare(b));
    return { mediaMounted: true, mediaEntries: dirs.slice(0, 80) };
  } catch (err) {
    return { mediaMounted: true, mediaEntries: [], mediaReadError: (err as NodeJS.ErrnoException).code ?? String(err) };
  }
}

const MAX_DEPTH = 3;
// A folder holding thousands of titles is a library, not somewhere a library lives; don't walk into it.
const MAX_CHILDREN_TO_DESCEND = 400;
const PARALLEL = 12;

/** Subfolders of a folder, or undefined if it has more than the limit (stops reading early, which matters on network shares). */
async function subfolders(dir: string, limit: number): Promise<string[] | undefined> {
  const out: string[] = [];
  let seen = 0;
  try {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (++seen > limit) return undefined;
      if (entry.isDirectory()) out.push(join(dir, entry.name));
    }
  } catch {
    // Unreadable folders are simply not candidates.
  }
  return out;
}

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) out.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(fn))));
  return out;
}

/**
 * Finds which folder under the media mount holds the same titles the manager reports: it counts how many
 * of the manager's known title folders exist directly inside each candidate. Likely folders (the top
 * levels) are checked first and the search stops at a full match, so a big network share stays quick.
 */
export async function findLocalPath(samples: string[]): Promise<{ path: string; hits: number; tried: number } | undefined> {
  if (samples.length === 0 || !isDirectory(MEDIA_DIR)) return undefined;
  let best: { path: string; hits: number } | undefined;
  let level = [MEDIA_DIR];
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const scores = await inBatches(level, async (dir) => ({
      dir,
      hits: (await Promise.all(samples.map((name) => access(join(dir, name)).then(() => 1, () => 0)))).reduce((a: number, b: number) => a + b, 0),
    }));
    for (const { dir, hits } of scores) if (hits > 0 && (!best || hits > best.hits)) best = { path: dir, hits };
    if (best && best.hits === samples.length) break; // every sample title is here: no need to look further
    if (best && best.hits * 2 >= samples.length) break; // most are, and a deeper folder is unlikely to beat it
    if (depth === MAX_DEPTH) break;
    level = (await inBatches(level, (dir) => subfolders(dir, MAX_CHILDREN_TO_DESCEND))).flatMap((list) => list ?? []);
  }
  return best && { ...best, tried: samples.length };
}

import Fastify from "fastify";
import sensible from "@fastify/sensible";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { mapLimit } from "./util.js";
import { canWrite, downloadTrailer, findTrailer, localFolder, ytDlpVersion } from "./trailers.js";
import { fileURLToPath } from "node:url";
import { configDir, deleteService, getService, getSetting, listServices, postersDir, saveService, setSetting } from "./db.js";
import { buildLibrary, mergeCollections, type Collection } from "./library.js";
import { fetchChecked } from "./http.js";
import { homeKeyFor, registerAuth } from "./auth.js";
import { MEDIA_DIR, diskSpace, findLocalPath, inspectMedia, isDirectory } from "./storage.js";
import { PODCAST_GENRES, lookupFeed, topPodcasts } from "./podcasts.js";
import { ensureCollections, sameName, type CacheChange, type EnsureOp } from "./collections.js";
import { MANAGER_KINDS, SERVER_KINDS, adapterFor, credentialFields, imageHeaders } from "./services/registry.js";
import {
  SERVICE_KINDS, type AddOptions, type AddRequest, type AudiobookRequestInfo, type AudiobookResult, type HistoryItem, type DownloadAction, type ImportIssue, type ManagerTask, type TorrentInfo, type RemotePathMapping, type ListKind, type PodcastTarget, type MediaItem, type ServiceKind, type TrendingItem, type QueueItem, type RawCollection, type RawItem, type SearchResult, type ServiceConfig,
} from "./services/types.js";

// Sent to the browser in place of stored secrets; sending it back means "unchanged".
const MASK = "••••••••";
const SECRET_FIELDS = ["apiKey", "password"] as const;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: MAX_IMAGE_BYTES });
await app.register(sensible);
await app.register(compress); // the library list is large JSON and shrinks about tenfold
app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
registerAuth(app); // must come before the routes it guards

const masked = (s: ServiceConfig) => ({
  ...s,
  apiKey: s.apiKey ? MASK : "",
  password: s.password ? MASK : "",
});

type ServiceBody = Partial<ServiceConfig>;

/** Builds a full config from a request body, keeping stored secrets the client sent back masked. */
function fromBody(body: ServiceBody, id: string): ServiceConfig {
  const existing = getService(id);
  if (!body.kind || !SERVICE_KINDS.includes(body.kind)) throw app.httpErrors.badRequest("Unknown service kind");
  if (!body.url || !/^https?:\/\//.test(body.url)) throw app.httpErrors.badRequest("URL must start with http:// or https://");
  const cfg: ServiceConfig = {
    id,
    kind: body.kind,
    name: body.name?.trim() || body.kind,
    url: body.url.trim(),
    apiKey: body.apiKey ?? "",
    username: body.username ?? "",
    password: body.password ?? "",
    enabled: body.enabled ?? true,
  };
  for (const field of SECRET_FIELDS) {
    if (cfg[field] === MASK) cfg[field] = existing?.[field] ?? "";
  }
  return cfg;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs one call per service, collecting per-service failures instead of failing the request. */
async function fanOut<T>(services: ServiceConfig[], fn: (s: ServiceConfig) => Promise<T[]> | undefined) {
  const errors: { serviceId: string; name: string; message: string }[] = [];
  const results = await Promise.all(
    services.map(async (s) => {
      try {
        return (await fn(s)) ?? [];
      } catch (err) {
        errors.push({ serviceId: s.id, name: s.name, message: errorMessage(err) });
        return [];
      }
    }),
  );
  return { items: results.flat(), errors };
}

// --- Library cache -------------------------------------------------------------------------
// Radarr/Sonarr answer in a couple of seconds; Plex/Jellyfin on a big library take far longer.
// So they are cached separately: the quick side refreshes often, the slow side rarely, and the
// page is always answered from the cache (stale is fine) while a refresh runs in the background.

type PullError = { serviceId: string; name: string; message: string };
interface Pulled { at: number; items: RawItem[]; errors: PullError[] }
interface ServersPulled extends Pulled { collections: RawCollection[] }
interface Merged {
  items: MediaItem[];
  collections: Collection[];
  errors: PullError[];
  fetchedAt: string;
  byKey: Map<string, MediaItem>;
  /** Maps a title as a server reports it back to the merged title (by external ids). */
  find: (raw: RawItem) => MediaItem | undefined;
  /** Bumped each time the merge is rebuilt, so cached responses know when they are stale. */
  version: number;
  /** Keys that keep their full detail (summary, backdrop…) in the list so the home banner can use them. */
  featured: Set<string>;
}

const MANAGERS_TTL_MS = 2 * 60_000;
const SERVERS_TTL_MS = 15 * 60_000;
const FEATURED_POOL = 60;
const cacheFile = join(configDir, "library-cache.json");
const CACHE_VERSION = 3; // 3: server entries carry watch state; 2: titles carry server ids and tags, collections carry server ids

let managersRaw: Pulled | undefined;
let serversRaw: ServersPulled | undefined;
let merged: Merged | undefined;
let mergedVersion = 0;
let responseCache: { key: string; json: string; gzip: Buffer } | undefined;
const trendingCache = new Map<string, { at: number; items: TrendingItem[] }>();

try {
  // Survive restarts: a warm cache means the first page load isn't a minute-long wait.
  const saved = JSON.parse(readFileSync(cacheFile, "utf8"));
  if (saved.version !== CACHE_VERSION) throw new Error("cache from an older version");
  managersRaw = saved.managersRaw;
  serversRaw = saved.serversRaw;
} catch {
  // No cache yet (or unreadable): the first request pulls everything.
}

let persisting = false;
async function persist() {
  if (persisting) return;
  persisting = true;
  try {
    await writeFile(cacheFile, JSON.stringify({ version: CACHE_VERSION, managersRaw, serversRaw }));
  } catch (err) {
    app.log.warn(`Could not save the library cache: ${errorMessage(err)}`);
  } finally {
    persisting = false;
  }
}

const dedupeErrors = (errors: PullError[]) => [...new Map(errors.map((e) => [`${e.serviceId}|${e.message}`, e])).values()];
const targets = (kinds: ServiceKind[]) => listServices().filter((s) => s.enabled && kinds.includes(s.kind));

let managersPull: Promise<void> | undefined;
let serversPull: Promise<void> | undefined;

// If a service fails mid-refresh, keep what we knew about it rather than wiping its titles.
const refreshManagers = () =>
  (managersPull ??= (async () => {
    const r = await fanOut<RawItem>(targets(MANAGER_KINDS), (svc) => adapterFor(svc).library?.());
    const failed = new Set(r.errors.map((e) => e.serviceId));
    const kept = failed.size ? (managersRaw?.items ?? []).filter((i) => i.managed && failed.has(i.managed.serviceId)) : [];
    managersRaw = { at: Date.now(), items: [...r.items, ...kept], errors: r.errors };
    merged = undefined;
    void persist();
  })().finally(() => {
    managersPull = undefined;
  }));

const refreshServers = () =>
  (serversPull ??= (async () => {
    const list = targets(SERVER_KINDS);
    const [lib, cols] = await Promise.all([
      fanOut<RawItem>(list, (svc) => adapterFor(svc).library?.()),
      fanOut<RawCollection>(list, (svc) => adapterFor(svc).collections?.()),
    ]);
    const failedLib = new Set(lib.errors.map((e) => e.serviceId));
    const failedCols = new Set(cols.errors.map((e) => e.serviceId));
    const keptItems = failedLib.size ? (serversRaw?.items ?? []).filter((i) => i.available.some((a) => failedLib.has(a.serviceId))) : [];
    const keptCols = failedCols.size ? (serversRaw?.collections ?? []).filter((c) => failedCols.has(c.serviceId)) : [];
    serversRaw = {
      at: Date.now(),
      items: [...lib.items, ...keptItems],
      collections: [...cols.items, ...keptCols],
      errors: dedupeErrors([...lib.errors, ...cols.errors]),
    };
    merged = undefined;
    void persist();
  })().finally(() => {
    serversPull = undefined;
  }));

/** Make sure there is data to answer with; refreshes stale data behind the scenes. */
async function ensureLibrary(force: boolean) {
  const now = Date.now();
  const waits: Promise<void>[] = [];
  const consider = (raw: { at: number } | undefined, ttl: number, pull: () => Promise<void>) => {
    if (force || !raw) waits.push(pull());
    else if (now - raw.at > ttl) void pull().catch(() => {});
  };
  consider(managersRaw, MANAGERS_TTL_MS, refreshManagers);
  consider(serversRaw, SERVERS_TTL_MS, refreshServers);
  await Promise.all(waits);
}

/** A service was added/edited/removed: drop what we know about that side so it is pulled afresh. */
function invalidate(kind: ServiceKind) {
  if (kind === "tmdb") trendingCache.clear();
  if (kind === "readmeabook") audiobookListCache.clear();
  if (MANAGER_KINDS.includes(kind)) managersRaw = undefined;
  else if (SERVER_KINDS.includes(kind)) serversRaw = undefined;
  merged = undefined;
}

function currentMerged(): Merged {
  if (merged) return merged;
  const { items, find } = buildLibrary(managersRaw?.items ?? [], serversRaw?.items ?? []);
  const featured = new Set(
    items
      .filter((i) => i.backdrop && i.type !== "book" && i.available.length > 0)
      .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
      .slice(0, FEATURED_POOL)
      .map((i) => i.key),
  );
  merged = {
    items,
    collections: mergeCollections(serversRaw?.collections ?? [], find, targets(["plex", "jellyfin"]).map((s) => s.id)),
    errors: dedupeErrors([...(managersRaw?.errors ?? []), ...(serversRaw?.errors ?? [])]),
    fetchedAt: new Date(Math.min(managersRaw?.at ?? Date.now(), serversRaw?.at ?? Date.now())).toISOString(),
    byKey: new Map(items.map((i) => [i.key, i])),
    find,
    version: ++mergedVersion,
    featured,
  };
  return merged;
}

/** The list the browser needs for grids: summaries, backdrops etc. come on demand from /api/item. */
function slimItem(i: MediaItem): MediaItem {
  const { overview: _o, backdrop: _b, genres: _g, studio: _s, certification: _c, runtimeMinutes: _r, ...rest } = i;
  return {
    ...rest,
    managed: i.managed && { ...i.managed, path: undefined },
    available: i.available.map(({ serviceId, library, resolution, watch }) => ({ serviceId, library, resolution, watch })),
  };
}

const posterOverrides = () => getSetting<Record<string, string>>("posters", {});

// Regular users see which services exist, but not where they live or how they sign in.
app.get("/api/services", async (req) => ({
  kinds: SERVICE_KINDS,
  credentialFields,
  services: listServices().map((s) => (req.user && req.user.role !== "admin" ? { ...masked(s), url: "", username: "" } : masked(s))),
}));

app.post<{ Body: ServiceBody }>("/api/services", async (req) => {
  const cfg = fromBody(req.body, randomUUID());
  saveService(cfg);
  invalidate(cfg.kind);
  return masked(cfg);
});

app.put<{ Params: { id: string }; Body: ServiceBody }>("/api/services/:id", async (req) => {
  if (!getService(req.params.id)) throw app.httpErrors.notFound();
  const previous = getService(req.params.id);
  const cfg = fromBody(req.body, req.params.id);
  saveService(cfg);
  if (previous) invalidate(previous.kind);
  invalidate(cfg.kind);
  return masked(cfg);
});

app.delete<{ Params: { id: string } }>("/api/services/:id", async (req) => {
  const existing = getService(req.params.id);
  deleteService(req.params.id);
  if (existing) invalidate(existing.kind);
  return { ok: true };
});

// Tests an unsaved form, so the id is optional and only used to recover masked secrets.
// ?force=1 is an explicit "Test" click and skips any back-off after earlier failed logins.
app.post<{ Body: ServiceBody; Querystring: { force?: string } }>("/api/services/test", async (req) => {
  const cfg = fromBody(req.body, req.body.id ?? "");
  try {
    return await adapterFor(cfg).test({ force: req.query.force === "1" });
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
});

app.get<{ Querystring: { refresh?: string } }>("/api/library", async (req, reply) => {
  await ensureLibrary(Boolean(req.query.refresh));
  const m = currentMerged();
  const overrides = posterOverrides();
  const pinnedList = homeFor(req).pinned;
  // Building and serialising thousands of titles is the slow part, so reuse the result until something changes.
  const key = `${m.version}|${pinnedList.join(",")}|${JSON.stringify(overrides)}`;
  if (responseCache?.key !== key) {
    const pinned = new Set(pinnedList);
    // Poster overrides are applied here so changing a poster doesn't need a re-pull.
    const items = m.items.map((i) => {
      const full = overrides[i.key] ? { ...i, poster: `/posters/${overrides[i.key]}` } : i;
      return m.featured.has(i.key) || pinned.has(i.key) ? full : slimItem(full);
    });
    const collections = m.collections.map((c) => (overrides[`collection:${c.name}`] ? { ...c, poster: `/posters/${overrides[`collection:${c.name}`]}` } : c));
    const json = JSON.stringify({ items, collections, errors: m.errors, fetchedAt: m.fetchedAt });
    responseCache = { key, json, gzip: gzipSync(json) }; // compressed once, not on every request
  }
  reply.type("application/json; charset=utf-8").header("Vary", "Accept-Encoding");
  if (String(req.headers["accept-encoding"] ?? "").includes("gzip")) return reply.header("Content-Encoding", "gzip").send(responseCache.gzip);
  return reply.send(responseCache.json);
});

// Everything we know about one title (the list leaves out summaries and backdrops).
app.get<{ Querystring: { key?: string } }>("/api/item", async (req) => {
  await ensureLibrary(false);
  const item = currentMerged().byKey.get(req.query.key ?? "");
  if (!item) throw app.httpErrors.notFound();
  const overrides = posterOverrides();
  return overrides[item.key] ? { ...item, poster: `/posters/${overrides[item.key]}` } : item;
});

// --- Download clients: pause, resume, remove and move what SABnzbd and qBittorrent are holding -----

const CONTROLLABLE: ServiceKind[] = ["sabnzbd", "qbittorrent"];

app.get("/api/torrents", async () => {
  const r = await fanOut<TorrentInfo>(targets(["qbittorrent"]), (s) => adapterFor(s).torrents?.());
  return { items: r.items, errors: r.errors, configured: targets(["qbittorrent"]).length > 0 };
});

app.post<{ Body: { serviceId?: string; id?: string; action?: string; deleteFiles?: boolean; path?: string } }>("/api/downloads/control", async (req) => {
  const { serviceId, id, action, deleteFiles, path } = req.body ?? {};
  const service = serviceId ? getService(serviceId) : undefined;
  if (!service || !service.enabled || !CONTROLLABLE.includes(service.kind)) throw app.httpErrors.notFound("Unknown download client");
  const actions = ["pause", "resume", "remove", "pause-all", "resume-all", "set-location"];
  if (!action || !actions.includes(action)) throw app.httpErrors.badRequest("Unknown action");
  const global = action === "pause-all" || action === "resume-all";
  if (!global && (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id))) throw app.httpErrors.badRequest("Pick a download");
  if (action === "set-location" && (!path || path.length > 500 || /[\0\n\r]/.test(path))) throw app.httpErrors.badRequest("Give a folder path");
  try {
    await adapterFor(service).control!(id ?? "", action as DownloadAction, { deleteFiles: deleteFiles === true, path });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

app.get("/api/queue", async () => {
  const enabled = listServices().filter((s) => s.enabled);
  return fanOut<QueueItem>(enabled, (s) => adapterFor(s).queue?.());
});

// --- Trailers: find which titles lack a local trailer and download them with yt-dlp -------------

type TrailerState = "have" | "missing" | "unmapped" | "readonly";
interface TrailerRow { key: string; title: string; year?: number; type: MediaItem["type"]; state: TrailerState; file?: string; sizeBytes?: number }
interface TrailerJob { key: string; title: string; status: "queued" | "running" | "done" | "failed"; message?: string; source?: string }

let trailerScan: { at: number; rows: TrailerRow[] } | undefined;
const trailerJobs = new Map<string, TrailerJob>();
const trailerQueue: string[] = [];
let trailerWorker = false;

function trailerFolder(item: MediaItem): string | undefined {
  const m = item.managed;
  if (!m?.path) return undefined;
  let mapped: { root: string; local: string } | undefined;
  for (const [k, local] of Object.entries(pathMappings())) {
    const [sid, ...rest] = k.split("|");
    const root = rest.join("|");
    if (sid === m.serviceId && m.path.startsWith(root) && (!mapped || root.length > mapped.root.length)) mapped = { root, local };
  }
  return localFolder(m.path, mapped);
}

async function scanTrailers(): Promise<TrailerRow[]> {
  if (trailerScan && Date.now() - trailerScan.at < 5 * 60_000) return trailerScan.rows;
  await ensureLibrary(false);
  const titles = [...currentMerged().byKey.values()].filter((i) => (i.type === "movie" || i.type === "series") && i.managed?.path);
  const writable = new Map<string, boolean>();
  const rows = await mapLimit(titles, 12, async (i): Promise<TrailerRow> => {
    const base = { key: i.key, title: i.title, year: i.year, type: i.type };
    const folder = trailerFolder(i);
    if (!folder) return { ...base, state: "unmapped" };
    const found = await findTrailer(folder);
    if (found) return { ...base, state: "have", file: found.name, sizeBytes: found.sizeBytes };
    const parent = dirname(folder);
    if (!writable.has(parent)) writable.set(parent, await canWrite(folder).then((ok) => ok || canWrite(parent)));
    return { ...base, state: writable.get(parent) ? "missing" : "readonly" };
  });
  trailerScan = { at: Date.now(), rows };
  return rows;
}

async function trailerSource(item: MediaItem): Promise<string> {
  const tmdb = targets(["tmdb"])[0];
  if (tmdb && item.ids.tmdb && (item.type === "movie" || item.type === "series")) {
    try {
      const url = await adapterFor(tmdb).trailerUrl?.(item.type, item.ids.tmdb);
      if (url) return url;
    } catch { /* fall back to a YouTube search */ }
  }
  const year = item.year ? ` ${item.year}` : "";
  return `ytsearch1:${item.title}${year} ${item.type === "series" ? "tv series " : ""}official trailer`;
}

async function runTrailerQueue() {
  if (trailerWorker) return;
  trailerWorker = true;
  try {
    for (let key = trailerQueue.shift(); key; key = trailerQueue.shift()) {
      const job = trailerJobs.get(key);
      const item = currentMerged().byKey.get(key);
      const folder = item && trailerFolder(item);
      if (!job || !item || !folder) continue;
      job.status = "running";
      try {
        job.source ??= await trailerSource(item);
        const r = await downloadTrailer(folder, job.source);
        job.status = r.ok ? "done" : "failed";
        job.message = r.message;
        if (r.ok) {
          const row = trailerScan?.rows.find((x) => x.key === key);
          if (row) Object.assign(row, { state: "have" as const, file: `${basename(folder)}-trailer.mp4` });
        }
      } catch (err) {
        job.status = "failed";
        job.message = errorMessage(err);
      }
    }
  } finally {
    trailerWorker = false;
  }
}

app.get<{ Querystring: { refresh?: string } }>("/api/trailers", async (req) => {
  if (req.query.refresh) trailerScan = undefined;
  const [rows, version] = await Promise.all([scanTrailers(), ytDlpVersion()]);
  return {
    ytDlp: version ?? null,
    mediaMounted: (await inspectMedia()).mediaMounted,
    tmdb: targets(["tmdb"]).length > 0,
    items: rows,
    jobs: [...trailerJobs.values()],
  };
});

// Play a trailer already on disk (with Range support so the browser can seek).
app.get<{ Querystring: { key?: string } }>("/api/trailer-file", async (req, reply) => {
  await ensureLibrary(false);
  const item = currentMerged().byKey.get(req.query.key ?? "");
  const folder = item && trailerFolder(item);
  const found = folder ? await findTrailer(folder) : undefined;
  if (!found) throw app.httpErrors.notFound("No trailer saved for this title");
  const size = (await stat(found.path)).size;
  const ext = found.path.split(".").pop()?.toLowerCase();
  const type = ext === "mkv" ? "video/x-matroska" : ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4";
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    return reply.code(206).type(type).header("Accept-Ranges", "bytes").header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", end - start + 1)
      .send(createReadStream(found.path, { start, end }));
  }
  return reply.type(type).header("Accept-Ranges", "bytes").header("Content-Length", size).send(createReadStream(found.path));
});

// A YouTube trailer to watch when none is saved yet (TMDB's pick).
app.get<{ Querystring: { key?: string; type?: string; tmdb?: string; title?: string; year?: string } }>("/api/trailer-online", async (req) => {
  await ensureLibrary(false);
  const tmdb = targets(["tmdb"])[0];
  if (!tmdb) return { youtubeId: null };
  // Either one of our titles (by key) or one we don't have yet (Discover), identified by TMDB id or by name.
  const item = req.query.key ? currentMerged().byKey.get(req.query.key) : undefined;
  const type = item?.type ?? req.query.type;
  const tmdbId = item?.ids.tmdb ?? (req.query.tmdb && /^\d+$/.test(req.query.tmdb) ? req.query.tmdb : undefined);
  const title = item?.title ?? req.query.title;
  if ((type !== "movie" && type !== "series") || (!tmdbId && !title)) return { youtubeId: null };
  try {
    const url = await adapterFor(tmdb).trailerUrl?.(type, tmdbId, title ? { title, year: item?.year ?? (Number(req.query.year) || undefined) } : undefined);
    return { youtubeId: url?.split("v=")[1] ?? null };
  } catch {
    return { youtubeId: null };
  }
});

// Other artwork for a title, from TMDB, to choose from.
app.get<{ Querystring: { key?: string } }>("/api/poster-options", async (req) => {
  await ensureLibrary(false);
  const item = currentMerged().byKey.get(req.query.key ?? "");
  const tmdb = targets(["tmdb"])[0];
  if (!tmdb) return { configured: false, items: [] };
  if (!item?.ids.tmdb || (item.type !== "movie" && item.type !== "series")) return { configured: true, items: [] };
  try {
    return { configured: true, items: (await adapterFor(tmdb).posterOptions?.(item.type, item.ids.tmdb)) ?? [] };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get("/api/trailers/jobs", async () => ({ jobs: [...trailerJobs.values()] }));

app.post<{ Body: { keys?: unknown; url?: string } }>("/api/trailers/download", async (req) => {
  const keys = req.body?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 500 || !keys.every((k) => typeof k === "string")) {
    throw app.httpErrors.badRequest("Pick between 1 and 500 titles");
  }
  const url = req.body?.url?.trim();
  if (url && (keys.length !== 1 || !/^https?:\/\//.test(url))) throw app.httpErrors.badRequest("A trailer link works for one title at a time and must start with http(s)");
  if (!(await ytDlpVersion())) throw app.httpErrors.badGateway("yt-dlp is not installed in this image. Rebuild the image from the latest source.");
  await scanTrailers();
  let queued = 0;
  for (const key of keys as string[]) {
    const row = trailerScan?.rows.find((r) => r.key === key);
    if (!row || row.state === "have" || row.state === "unmapped" || row.state === "readonly") continue;
    if (trailerJobs.get(key)?.status === "queued" || trailerJobs.get(key)?.status === "running") continue;
    trailerJobs.set(key, { key, title: row.title, status: "queued", source: url });
    trailerQueue.push(key);
    queued++;
  }
  void runTrailerQueue();
  return { ok: true, queued };
});

// --- Manage media: rename, move, rescan and remove titles through Radarr/Sonarr ----------------

/** The manager entry behind a library title. */
function managedTitle(key: string | undefined) {
  const item = key ? currentMerged().byKey.get(key) : undefined;
  const m = item?.managed;
  if (!item || !m || m.arrId === undefined) throw app.httpErrors.notFound("That title isn't managed by Radarr or Sonarr");
  const service = managerService(m.serviceId);
  return { item, arrId: m.arrId, service, adapter: adapterFor(service) };
}

app.get<{ Querystring: { key?: string } }>("/api/manage/rename", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter } = managedTitle(req.query.key);
  try {
    return { changes: await adapter.renamePreview!(arrId) };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { key?: string; fileIds?: unknown } }>("/api/manage/rename", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter } = managedTitle(req.body?.key);
  const ids = req.body?.fileIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) throw app.httpErrors.badRequest("Pick the files to rename");
  try {
    await adapter.renameApply!(arrId, ids as number[]);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  trailerScan = undefined;
  return { ok: true };
});

app.post<{ Body: { key?: string; name?: string } }>("/api/manage/rename-folder", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter } = managedTitle(req.body?.key);
  const name = (req.body?.name ?? "").trim();
  if (!name || /[\\/:*?"<>|]/.test(name) || name === "." || name === "..") throw app.httpErrors.badRequest("Use a plain folder name without slashes or special characters");
  try {
    await adapter.renameFolder!(arrId, name);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  await refreshManagers();
  trailerScan = undefined;
  return { ok: true };
});

app.post<{ Body: { key?: string; fromSeason?: number; toSeason?: number; offset?: number; apply?: boolean } }>("/api/manage/renumber", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter } = managedTitle(req.body?.key);
  const { fromSeason, toSeason, offset } = req.body ?? {};
  if (![fromSeason, toSeason, offset].every((n) => Number.isInteger(n))) throw app.httpErrors.badRequest("Pick the seasons and the episode offset");
  if (!adapter.renumber) throw app.httpErrors.badRequest("Renumbering is for shows");
  try {
    const rows = await adapter.renumber(arrId, { fromSeason: fromSeason!, toSeason: toSeason!, offset: offset! }, req.body?.apply === true);
    if (req.body?.apply) trailerScan = undefined;
    return { rows };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

// Delete files from disk so Radarr/Sonarr can fetch them again. Which episodes the files belong to is
// worked out here from the manager's own list, not taken from the page.
app.post<{ Body: { key?: string; fileIds?: unknown; blocklist?: boolean; search?: boolean } }>("/api/manage/delete-files", async (req) => {
  await ensureLibrary(false);
  const { item, arrId, adapter } = managedTitle(req.body?.key);
  let fileIds: number[];
  let episodeIds: number[] = [];
  if (item.type === "movie") {
    const id = item.managed?.fileId;
    if (id === undefined) throw app.httpErrors.badRequest("This movie has no file on disk");
    fileIds = [id];
  } else {
    const wanted = req.body?.fileIds;
    if (!Array.isArray(wanted) || wanted.length === 0 || wanted.length > 500 || !wanted.every((n) => Number.isInteger(n))) throw app.httpErrors.badRequest("Pick the episodes to delete");
    try {
      const known = (await adapter.episodes!(arrId)).filter((e) => e.fileId !== undefined && (wanted as number[]).includes(e.fileId));
      fileIds = [...new Set(known.map((e) => e.fileId!))];
      episodeIds = known.map((e) => e.id);
    } catch (err) {
      throw app.httpErrors.badGateway(errorMessage(err));
    }
    if (fileIds.length === 0) throw app.httpErrors.badRequest("Those episodes have no files any more");
  }
  try {
    await adapter.deleteFiles!(arrId, fileIds, { blocklist: req.body?.blocklist === true, episodeIds });
    if (req.body?.search) {
      if (item.type === "movie") await adapter.searchDownloads!([arrId], { monitor: true });
      else if (episodeIds.length) await adapter.searchEpisodes!(episodeIds);
    }
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  await refreshManagers();
  trailerScan = undefined;
  return { ok: true, count: fileIds.length };
});

app.post<{ Body: { key?: string; rootFolder?: string } }>("/api/manage/move", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter, service } = managedTitle(req.body?.key);
  const root = req.body?.rootFolder;
  try {
    const options = await adapter.addOptions!();
    if (!root || !options.rootFolders.some((r) => r.path === root)) throw app.httpErrors.badRequest("Choose one of the manager's root folders");
    await adapter.moveTo!(arrId, root);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  await refreshManagers();
  trailerScan = undefined;
  void service;
  return { ok: true };
});

app.post<{ Body: { key?: string } }>("/api/manage/rescan", async (req) => {
  await ensureLibrary(false);
  const { arrId, adapter } = managedTitle(req.body?.key);
  try {
    await adapter.rescan!(arrId);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

// The only call that can't be undone: the title has to be named in full, exactly as the library shows it.
app.post<{ Body: { key?: string; deleteFiles?: boolean; exclude?: boolean; confirm?: string } }>("/api/manage/remove", async (req) => {
  await ensureLibrary(false);
  const { item, arrId, adapter } = managedTitle(req.body?.key);
  if ((req.body?.confirm ?? "").trim() !== item.title) throw app.httpErrors.badRequest("Type the title exactly to confirm");
  try {
    await adapter.removeTitle!(arrId, { deleteFiles: req.body?.deleteFiles === true, exclude: req.body?.exclude === true });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  await refreshManagers();
  trailerScan = undefined;
  return { ok: true };
});

app.get("/api/activity", async () => {
  const r = await fanOut<ManagerTask>(targets(MANAGER_KINDS), (s) => adapterFor(s).tasks?.());
  return { items: r.items, errors: r.errors };
});

// --- Stuck imports: finished downloads Radarr/Sonarr could not import -----------------------

app.get("/api/import-issues", async () => {
  const managers = targets(MANAGER_KINDS);
  const r = await fanOut<ImportIssue>(managers, (s) => adapterFor(s).importIssues?.());
  const mappings = await fanOut<RemotePathMapping & { serviceId: string }>(managers, async (s) =>
    ((await adapterFor(s).remotePaths?.()) ?? []).map((m) => ({ ...m, serviceId: s.id })),
  );
  return { items: r.items, mappings: mappings.items, errors: [...r.errors, ...mappings.errors] };
});

app.post<{ Body: { serviceId?: string; ids?: unknown } }>("/api/import-retry", async (req) => {
  const service = managerService(req.body?.serviceId);
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((i) => typeof i === "string" && /^d+$/.test(i))) {
    throw app.httpErrors.badRequest("Pick the downloads to import");
  }
  try {
    for (const id of ids as string[]) await adapterFor(service).retryImport!(id);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true, count: ids.length };
});

app.post<{ Body: { serviceId?: string; id?: string; removeFromClient?: boolean; blocklist?: boolean } }>("/api/import-remove", async (req) => {
  const service = managerService(req.body?.serviceId);
  const id = req.body?.id;
  if (!id || !/^\d+$/.test(id)) throw app.httpErrors.badRequest("Pick a download to remove");
  try {
    await adapterFor(service).removeFromQueue!(id, { removeFromClient: req.body?.removeFromClient === true, blocklist: req.body?.blocklist === true });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

app.get<{ Querystring: { serviceId?: string; path?: string } }>("/api/import-browse", async (req) => {
  const service = managerService(req.query.serviceId);
  try {
    return await adapterFor(service).browseFolders!(req.query.path || "/");
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { serviceId?: string; path?: string } }>("/api/import-scan", async (req) => {
  const service = managerService(req.query.serviceId);
  if (!req.query.path) throw app.httpErrors.badRequest("Pick a folder to scan");
  try {
    return { items: await adapterFor(service).scanFolder!(req.query.path) };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; folder?: string; paths?: unknown; mode?: string } }>("/api/import-folder", async (req) => {
  const service = managerService(req.body?.serviceId);
  const { folder, paths, mode } = req.body ?? {};
  if (!folder || !Array.isArray(paths) || paths.length === 0 || paths.length > 500 || !paths.every((p) => typeof p === "string")) throw app.httpErrors.badRequest("Pick the files to import");
  if (mode !== "move" && mode !== "copy") throw app.httpErrors.badRequest("Choose move or copy");
  try {
    return { ok: true, count: await adapterFor(service).importFiles!(folder, paths as string[], mode) };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; host?: string; remotePath?: string; localPath?: string } }>("/api/remote-path", async (req) => {
  const service = managerService(req.body?.serviceId);
  const { host, remotePath, localPath } = req.body ?? {};
  if (!host?.trim() || !remotePath?.trim() || !localPath?.trim()) throw app.httpErrors.badRequest("Host, remote path and local path are all needed");
  try {
    await adapterFor(service).addRemotePath!({ host: host.trim(), remotePath: remotePath.trim(), localPath: localPath.trim() });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

// --- Discover: search Radarr/Sonarr lookup and add titles ------------------------------------

const managerService = (id?: string) => {
  const s = id ? getService(id) : undefined;
  if (!s || !MANAGER_KINDS.includes(s.kind)) throw app.httpErrors.notFound("Unknown Radarr/Sonarr service");
  return s;
};

app.get<{ Querystring: { q?: string } }>("/api/search", async (req) => {
  const term = (req.query.q ?? "").trim();
  if (term.length < 2) return { items: [], errors: [] };
  const managers = listServices().filter((s) => s.enabled && MANAGER_KINDS.includes(s.kind));
  return fanOut<SearchResult>(managers, (s) => adapterFor(s).search?.(term));
});

// --- Storage: map the managers' folders to folders Matinee can see, to measure real free space ---

type Mappings = Record<string, string>;
const mappingKey = (serviceId: string, path: string) => `${serviceId}|${path}`;
const pathMappings = () => getSetting<Mappings>("pathMappings", {});

/** Replaces a manager's own idea of free space with Matinee's measurement for folders that have been mapped. */
async function withMountedSpace(service: ServiceConfig, options: AddOptions): Promise<AddOptions> {
  const maps = pathMappings();
  const rootFolders = await Promise.all(
    options.rootFolders.map(async (r) => {
      const local = maps[mappingKey(service.id, r.path)];
      if (!local) return { ...r, freeSource: "manager" as const };
      try {
        const d = await diskSpace(local);
        return { ...r, freeBytes: d.freeBytes, totalBytes: d.totalBytes, freeSource: "mounted" as const };
      } catch {
        return { ...r, freeSource: "manager" as const };
      }
    }),
  );
  return { ...options, rootFolders };
}

app.get<{ Querystring: { s?: string } }>("/api/add-options", async (req) => {
  const service = managerService(req.query.s);
  try {
    return await withMountedSpace(service, await adapterFor(service).addOptions!());
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get("/api/storage", async () => {
  const maps = pathMappings();
  const rows: {
    serviceId: string; serviceName: string; kind: ServiceKind; path: string;
    reportedFreeBytes?: number; mappedPath?: string; freeBytes?: number; totalBytes?: number; problem?: string;
  }[] = [];
  const errors: { serviceId: string; name: string; message: string }[] = [];
  for (const service of targets(MANAGER_KINDS)) {
    try {
      const options = await adapterFor(service).addOptions!();
      for (const r of options.rootFolders) {
        const mappedPath = maps[mappingKey(service.id, r.path)];
        const row = { serviceId: service.id, serviceName: service.name, kind: service.kind, path: r.path, reportedFreeBytes: r.freeBytes, mappedPath } as (typeof rows)[number];
        if (mappedPath) {
          try {
            Object.assign(row, await diskSpace(mappedPath));
          } catch (err) {
            row.problem = `Can't read ${mappedPath}: ${errorMessage(err)}`;
          }
        }
        rows.push(row);
      }
    } catch (err) {
      errors.push({ serviceId: service.id, name: service.name, message: errorMessage(err) });
    }
  }
  return { rows, errors, mediaDir: MEDIA_DIR, ...(await inspectMedia()) };
});

app.put<{ Body: { serviceId?: string; path?: string; localPath?: string | null } }>("/api/storage/mapping", async (req) => {
  const { serviceId, path, localPath } = req.body ?? {};
  const service = managerService(serviceId);
  if (!path) throw app.httpErrors.badRequest("Missing folder");
  const maps = { ...pathMappings() };
  const key = mappingKey(service.id, path);
  const clean = localPath?.trim();
  if (!clean) delete maps[key];
  else {
    if (!isDirectory(clean)) {
      throw app.httpErrors.badRequest(`“${clean}” isn't a folder Matinee can see. Mount the share into Matinee's container first (on Unraid: add a Path to the container).`);
    }
    maps[key] = clean;
  }
  setSetting("pathMappings", maps);
  return { ok: true };
});

// Looks for each manager folder's titles under the media mount to work out which folder is which.
app.post("/api/storage/detect", async () => {
  await ensureLibrary(false);
  const items = currentMerged().items;
  const results: { serviceId: string; serviceName: string; path: string; localPath: string | null; hits: number; tried: number; samples: string[] }[] = [];
  for (const service of targets(MANAGER_KINDS)) {
    let options: AddOptions;
    try {
      options = await adapterFor(service).addOptions!();
    } catch {
      continue;
    }
    for (const r of options.rootFolders) {
      const prefix = r.path.replace(/[\\/]+$/, "") + "/";
      const samples = [
        ...new Set(
          items
            .filter((i) => i.managed?.serviceId === service.id && i.managed.path?.startsWith(prefix))
            .map((i) => i.managed!.path!.slice(prefix.length).split("/")[0]),
        ),
      ].filter(Boolean).slice(0, 8);
      const found = await findLocalPath(samples);
      results.push({ serviceId: service.id, serviceName: service.name, path: r.path, localPath: found?.path ?? null, hits: found?.hits ?? 0, tried: samples.length, samples: samples.slice(0, 2) });
    }
  }
  return { results, mediaDir: MEDIA_DIR, ...(await inspectMedia()) };
});

// --- Trending (TMDB) ---------------------------------------------------------------------------

const LIST_KINDS: ListKind[] = ["trending", "popular", "upcoming", "now", "top_rated"];

// --- MDBList: pick lists for the Home page --------------------------------------------------------

const mdbCache = new Map<string, { at: number; items: TrendingItem[]; more: boolean }>();
const MDB_PAGE = 100;
const detailCache = new Map<string, { at: number; value: Awaited<ReturnType<NonNullable<ReturnType<typeof adapterFor>["details"]>>> }>();

// --- Calibre-Web: recently added ebooks for the Home page ------------------------------------------

// Search ebooks: Shelfmark finds them to download, Calibre-Web says which ones you already have.
const normBook = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

app.get<{ Querystring: { q?: string } }>("/api/books/search", async (req) => {
  const q = (req.query.q ?? "").trim();
  if (q.length < 2) return { library: [], download: [], errors: [], calibre: false, shelfmark: false };
  const calibre = targets(["calibreweb"]);
  const shelf = targets(["shelfmark"]);
  const lib = await fanOut<import("./services/types.js").BookItem>(calibre, (s) => adapterFor(s).searchBooks?.(q));
  const dl = await fanOut<import("./services/types.js").BookItem & { serviceId: string }>(shelf, async (s) =>
    ((await adapterFor(s).searchBooks?.(q)) ?? []).map((b) => ({ ...b, serviceId: s.id })),
  );
  const have = new Set(lib.items.map((b) => normBook(b.title)));
  return {
    calibre: calibre.length > 0,
    shelfmark: shelf.length > 0,
    library: lib.items,
    download: dl.items.map((b) => ({ ...b, inLibrary: have.has(normBook(b.title)) || [...have].some((h) => h.length > 6 && (normBook(b.title).includes(h) || h.includes(normBook(b.title)))) })),
    errors: [...lib.errors, ...dl.errors],
  };
});

app.post<{ Body: { serviceId?: string; id?: string } }>("/api/books/request", async (req) => {
  const service = req.body?.serviceId ? getService(req.body.serviceId) : undefined;
  if (!service || service.kind !== "shelfmark" || !service.enabled) throw app.httpErrors.notFound("Unknown Shelfmark service");
  if (!req.body?.id || req.body.id.length > 200) throw app.httpErrors.badRequest("Pick a book");
  try {
    await adapterFor(service).requestBook!(req.body.id);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

app.get("/api/calibre/recent", async () => {
  const service = targets(["calibreweb"])[0];
  if (!service) return { configured: false, items: [] };
  try {
    return { configured: true, items: await adapterFor(service).recentBooks!(40) };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { scope?: string; q?: string; url?: string } }>("/api/mdblist/lists", async (req) => {
  const service = targets(["mdblist"])[0];
  if (!service) return { configured: false, lists: [] };
  const adapter = adapterFor(service);
  try {
    if (req.query.url) {
      const m = /mdblist\.com\/lists\/([^/\s]+)\/([^/?#\s]+)/i.exec(req.query.url);
      if (!m) throw app.httpErrors.badRequest("Paste a list page address like mdblist.com/lists/someone/list-name");
      const found = await adapter.resolveList!(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      return { configured: true, lists: found ? [found] : [] };
    }
    const scope = req.query.scope === "top" ? "top" : req.query.scope === "search" ? "search" : "mine";
    return { configured: true, lists: await adapter.externalLists!(scope, req.query.q) };
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { id?: string; full?: string; offset?: string } }>("/api/mdblist/items", async (req) => {
  const service = targets(["mdblist"])[0];
  const id = req.query.id ?? "";
  if (!service) return { configured: false, items: [] };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw app.httpErrors.badRequest("Missing list");
  const full = req.query.full === "1";
  const offset = full ? Math.max(Number(req.query.offset) || 0, 0) : 0;
  const cacheKey = full ? `${id}:full:${offset}` : id;
  const cached = mdbCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30 * 60_000) return { configured: true, items: cached.items, hasMore: cached.more };
  try {
    const page = await adapterFor(service).externalListItems!(id, full ? MDB_PAGE : 40, offset);
    let items = page.items;
    // MDBList carries no artwork, so borrow it from TMDB when that is connected.
    const tmdb = targets(["tmdb"])[0];
    if (tmdb) {
      const adapter = adapterFor(tmdb);
      items = await mapLimit(items, 6, async (t) => {
        if (!t.ids.tmdb) return t;
        const k = `${t.type}:${t.ids.tmdb}`;
        let d = detailCache.get(k);
        if (!d || Date.now() - d.at > 24 * 3600_000) {
          d = { at: Date.now(), value: await adapter.details?.(t.type, t.ids.tmdb).catch(() => undefined) };
          detailCache.set(k, d);
        }
        return d.value ? { ...t, ...d.value, year: t.year ?? d.value.year } : t;
      });
    }
    mdbCache.set(cacheKey, { at: Date.now(), items, more: full && page.more });
    return { configured: true, items, hasMore: full && page.more };
  } catch (err) {
    if (cached) return { configured: true, items: cached.items, hasMore: false };
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { type?: string; list?: string; full?: string; page?: string } }>("/api/trending", async (req) => {
  const type = req.query.type === "series" ? "series" : "movie";
  const list = LIST_KINDS.find((k) => k === req.query.list) ?? "trending";
  const service = targets(["tmdb"])[0];
  if (!service) return { configured: false, items: [] };
  const full = req.query.full === "1";
  const page = Math.min(Math.max(Number(req.query.page) || 1, 1), 500);
  const key = `${list}:${type}${full ? `:full:${page}` : ""}`;
  const cached = trendingCache.get(key);
  const moreAfter = (n: number) => full && n > 0 && page < 500;
  if (cached && Date.now() - cached.at < 60 * 60_000) return { configured: true, items: cached.items, hasMore: moreAfter(cached.items.length) };
  try {
    const items = await adapterFor(service).trending!(type, list, full ? { pages: 1, page } : undefined);
    trendingCache.set(key, { at: Date.now(), items });
    return { configured: true, items, hasMore: moreAfter(items.length) };
  } catch (err) {
    if (cached) return { configured: true, items: cached.items, hasMore: false }; // stale beats nothing
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

// --- Episodes ------------------------------------------------------------------------------------

const intList = (v: unknown, max = 300): number[] => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max || !v.every((n) => Number.isInteger(n) && n > 0)) {
    throw app.httpErrors.badRequest(`Send between 1 and ${max} ids`);
  }
  return v as number[];
};

app.get<{ Querystring: { s?: string; id?: string } }>("/api/episodes", async (req) => {
  const service = managerService(req.query.s);
  const id = /^\d+$/.test(req.query.id ?? "") ? Number(req.query.id) : undefined;
  if (id === undefined || !adapterFor(service).episodes) throw app.httpErrors.badRequest("Episodes are only available for shows");
  try {
    return await adapterFor(service).episodes!(id);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; episodeIds?: unknown } }>("/api/episode-search", async (req) => {
  const service = managerService(req.body?.serviceId);
  const ids = intList(req.body?.episodeIds);
  try {
    await adapterFor(service).searchEpisodes!(ids);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

app.post<{ Body: { serviceId?: string; arrId?: number; season?: number } }>("/api/season-search", async (req) => {
  const service = managerService(req.body?.serviceId);
  const { arrId, season } = req.body ?? {};
  if (!Number.isInteger(arrId) || !Number.isInteger(season)) throw app.httpErrors.badRequest("Missing show or season");
  try {
    await adapterFor(service).searchSeason!(arrId as number, season as number);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

app.put<{ Body: { serviceId?: string; episodeIds?: unknown; monitored?: boolean } }>("/api/episode-monitor", async (req) => {
  const service = managerService(req.body?.serviceId);
  const ids = intList(req.body?.episodeIds);
  try {
    await adapterFor(service).setEpisodesMonitored!(ids, Boolean(req.body?.monitored));
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

// --- Collections: maker, sync and tag rules ---------------------------------------------------

interface CollectionRule { tag: string; name: string; serviceIds: string[]; mirror: boolean; enabled: boolean }
interface RulesSettings { rules: CollectionRule[]; auto: boolean }
const rulesSettings = () => getSetting<RulesSettings>("collectionRules", { rules: [], auto: false });
const collectionServers = () => targets(["plex", "jellyfin"]);
let collectionsBusy = false;

/** Update the cached server collections after a real run, so the page reflects it without re-pulling Plex. */
function applyCollectionChanges(changes: CacheChange[]) {
  if (!serversRaw || changes.length === 0) return;
  const m = currentMerged();
  const keyOf = (raw: RawItem) => m.find(raw)?.key;
  for (const ch of changes) {
    let c = serversRaw.collections.find((x) => x.serviceId === ch.serviceId && sameName(x.name, ch.name) && (x.sectionKey ?? "") === (ch.sectionKey ?? ""));
    if (!c) {
      c = { serviceId: ch.serviceId, id: ch.id, sectionKey: ch.sectionKey, name: ch.name, members: [] };
      serversRaw.collections.push(c);
    }
    const have = new Set(c.members.map(keyOf));
    for (const key of ch.addKeys) {
      const item = m.byKey.get(key);
      if (item && !have.has(key)) c.members.push(item);
    }
    const drop = new Set(ch.removeKeys);
    c.members = c.members.filter((x) => !drop.has(keyOf(x) ?? ""));
  }
  merged = undefined;
  void persist();
}

function tagRuleOps(): EnsureOp[] {
  const { rules } = rulesSettings();
  const items = currentMerged().items;
  const known = new Set(collectionServers().map((s) => s.id));
  return rules
    .filter((r) => r.enabled && r.name.trim() && r.tag)
    .map((r) => ({
      name: r.name.trim(),
      memberKeys: items.filter((i) => i.type !== "book" && i.tags?.some((t) => t.toLowerCase() === r.tag.toLowerCase())).map((i) => i.key),
      serviceIds: r.serviceIds.filter((id) => known.has(id)),
      mirror: r.mirror,
    }));
}

async function runCollections(ops: EnsureOp[], dryRun: boolean) {
  const m = currentMerged();
  const { results, changes } = await ensureCollections(ops, dryRun, {
    byKey: m.byKey,
    collections: serversRaw?.collections ?? [],
    keyOf: (raw) => m.find(raw)?.key,
    services: listServices().filter((s) => s.enabled),
  });
  if (!dryRun) applyCollectionChanges(changes);
  return results;
}

// --- Collection covers: set one in Matinee, send it to the servers, copy between Plex and Jellyfin --------

const collectionCopies = (name: string) =>
  (serversRaw?.collections ?? []).filter((c) => c.id && sameName(c.name, name) && getService(c.serviceId)?.enabled);

async function putCover(targets: RawCollection[], bytes: Buffer, type: string) {
  const done: string[] = [];
  const failed: string[] = [];
  for (const c of targets) {
    const svc = getService(c.serviceId)!;
    try {
      await adapterFor(svc).setPoster!(c.id!, bytes, type);
      // Point the cover at the new image (cache-busted) so it shows without a full re-pull.
      const path = svc.kind === "plex"
        ? `/photo/:/transcode?width=342&height=513&minSize=1&upscale=1&url=${encodeURIComponent(`/library/metadata/${c.id}/thumb?t=${Date.now()}`)}`
        : `/Items/${c.id}/Images/Primary?maxWidth=342&quality=85&t=${Date.now()}`;
      c.poster = `/api/image?s=${svc.id}&p=${encodeURIComponent(path)}`;
      done.push(svc.name);
    } catch (err) {
      failed.push(`${svc.name}: ${errorMessage(err)}`);
    }
  }
  merged = undefined; // rebuild the collection list so the new covers show
  return { done, failed };
}

app.post<{ Body: { name?: string; action?: string; from?: string; to?: string } }>("/api/collections/cover", async (req) => {
  await ensureLibrary(false);
  const { name, action, from, to } = req.body ?? {};
  if (!name) throw app.httpErrors.badRequest("Missing collection name");
  const copies = collectionCopies(name);
  if (copies.length === 0) throw app.httpErrors.badRequest("No server has this collection");
  if (action === "send") {
    const file = posterOverrides()[`collection:${name}`];
    if (!file) throw app.httpErrors.badRequest("Choose a cover for this collection first");
    const type = Object.entries(IMAGE_EXT).find(([, e]) => e === file.split(".").pop())?.[0] ?? "image/jpeg";
    return putCover(copies, await readFile(join(postersDir, file)), type);
  }
  if (action === "copy") {
    const source = copies.find((c) => c.serviceId === from);
    const dest = copies.filter((c) => c.serviceId === to);
    if (!source || dest.length === 0 || from === to) throw app.httpErrors.badRequest("Pick two different servers that both have this collection");
    let image;
    try {
      image = await adapterFor(getService(source.serviceId)!).getPoster!(source.id!);
    } catch (err) {
      throw app.httpErrors.badGateway(errorMessage(err));
    }
    if (!image) throw app.httpErrors.badGateway("The source server has no cover for it");
    return putCover(dest, image.bytes, image.contentType);
  }
  throw app.httpErrors.badRequest("Unknown action");
});

// Give every collection a cover on each server that has none, copied from a server that has one.
app.post("/api/collections/cover-fill", async () => {
  await ensureLibrary(false);
  const groups = new Map<string, RawCollection[]>();
  for (const c of serversRaw?.collections ?? []) {
    if (!c.id || !getService(c.serviceId)?.enabled) continue;
    const k = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  let filled = 0;
  const failed: string[] = [];
  for (const list of groups.values()) {
    const source = list.find((c) => c.poster);
    const lacking = list.filter((c) => !c.poster && c.serviceId !== source?.serviceId);
    if (!source || lacking.length === 0) continue;
    try {
      const image = await adapterFor(getService(source.serviceId)!).getPoster!(source.id!);
      if (!image) continue;
      const r = await putCover(lacking, image.bytes, image.contentType);
      filled += r.done.length;
      failed.push(...r.failed);
    } catch (err) {
      failed.push(`${source.name}: ${errorMessage(err)}`);
    }
  }
  return { filled, failed };
});

app.get("/api/collections/rules", async () => {
  await ensureLibrary(false);
  const counts = new Map<string, number>();
  for (const i of currentMerged().items) for (const t of i.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return {
    ...rulesSettings(),
    tags: [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    servers: collectionServers().map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  };
});

app.put<{ Body: RulesSettings }>("/api/collections/rules", async (req) => {
  const body = req.body;
  if (!body || !Array.isArray(body.rules)) throw app.httpErrors.badRequest("Send a list of rules");
  const clean: RulesSettings = {
    auto: Boolean(body.auto),
    rules: body.rules
      .filter((r) => r && typeof r.tag === "string" && typeof r.name === "string")
      .slice(0, 200)
      .map((r) => ({
        tag: r.tag.slice(0, 80),
        name: r.name.slice(0, 120),
        serviceIds: Array.isArray(r.serviceIds) ? r.serviceIds.filter((x) => typeof x === "string") : [],
        mirror: Boolean(r.mirror),
        enabled: Boolean(r.enabled),
      })),
  };
  setSetting("collectionRules", clean);
  return clean;
});

// One endpoint for everything: explicit ops (the maker), "sync" (make same-named collections identical on every
// server), and the saved tag rules. dryRun reports the plan without changing anything.
app.post<{ Body: { ops?: EnsureOp[]; sync?: string[]; tagRules?: boolean; dryRun?: boolean } }>("/api/collections/run", async (req) => {
  const { ops: given = [], sync = [], tagRules = false, dryRun = false } = req.body ?? {};
  if (collectionsBusy) throw app.httpErrors.conflict("Another collections run is still working; try again in a moment.");
  collectionsBusy = true;
  try {
    await ensureLibrary(false);
    const m = currentMerged();
    const allServers = collectionServers();
    if (allServers.length === 0) throw app.httpErrors.badRequest("Connect Plex or Jellyfin first.");

    const ops: EnsureOp[] = [];
    for (const op of given) {
      if (!op || typeof op.name !== "string" || !op.name.trim() || op.name.length > 120) throw app.httpErrors.badRequest("Give the collection a name.");
      if (!Array.isArray(op.memberKeys) || op.memberKeys.length > 10_000 || !Array.isArray(op.serviceIds)) throw app.httpErrors.badRequest("Missing titles or servers.");
      ops.push({ name: op.name.trim(), memberKeys: op.memberKeys.filter((k) => typeof k === "string"), serviceIds: op.serviceIds.filter((k) => typeof k === "string"), mirror: Boolean(op.mirror) });
    }
    for (const name of sync) {
      const keys = new Set<string>();
      for (const c of (serversRaw?.collections ?? []).filter((c) => sameName(c.name, name))) {
        for (const member of c.members) {
          const key = m.find(member)?.key;
          if (key) keys.add(key);
        }
      }
      ops.push({ name, memberKeys: [...keys], serviceIds: allServers.map((s) => s.id) });
    }
    if (tagRules) ops.push(...tagRuleOps());
    if (ops.length === 0) throw app.httpErrors.badRequest("Nothing to do.");

    return { dryRun, results: await runCollections(ops, dryRun) };
  } finally {
    collectionsBusy = false;
  }
});

// Optional: keep tag-based collections up to date by themselves (only when the person switched it on).
setInterval(async () => {
  if (!rulesSettings().auto || collectionsBusy) return;
  collectionsBusy = true;
  try {
    await ensureLibrary(false);
    const ops = tagRuleOps();
    if (ops.length) {
      const results = await runCollections(ops, false);
      const changed = results.filter((r) => r.plans.some((p) => p.groups.some((g) => g.add || g.remove)));
      if (changed.length) app.log.info(`Tag collections updated: ${changed.map((r) => r.name).join(", ")}`);
      for (const r of results) for (const e of r.errors) app.log.warn(`Tag collection "${r.name}": ${e}`);
    }
  } catch (err) {
    app.log.warn(`Automatic tag collections failed: ${errorMessage(err)}`);
  } finally {
    collectionsBusy = false;
  }
}, 30 * 60_000);

// --- Audiobooks (ReadMeABook) -------------------------------------------------------------------

app.get<{ Querystring: { q?: string } }>("/api/audiobook-search", async (req) => {
  const term = (req.query.q ?? "").trim();
  if (term.length < 2) return { items: [], errors: [], configured: targets(["readmeabook"]).length > 0 };
  const services = targets(["readmeabook"]);
  const r = await fanOut<AudiobookResult>(services, (s) => adapterFor(s).searchAudiobooks?.(term));
  return { ...r, configured: services.length > 0 };
});

app.post<{ Body: { serviceId?: string; book?: { asin?: string; title?: string; author?: string } & Record<string, unknown> } }>("/api/audiobook-request", async (req) => {
  const service = req.body?.serviceId ? getService(req.body.serviceId) : undefined;
  const book = req.body?.book;
  if (!service || service.kind !== "readmeabook") throw app.httpErrors.notFound("Unknown ReadMeABook service");
  if (!book?.asin || !book.title || !book.author) throw app.httpErrors.badRequest("Missing audiobook details");
  try {
    await adapterFor(service).requestAudiobook!(book as Parameters<NonNullable<ReturnType<typeof adapterFor>["requestAudiobook"]>>[0]);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

// Popular / new-release audiobooks for the home and discover pages (cached: the source refreshes slowly).
const audiobookListCache = new Map<string, { at: number; items: AudiobookResult[]; message?: string }>();

app.get<{ Querystring: { list?: string } }>("/api/audiobook-lists", async (req) => {
  const list = req.query.list === "popular" ? "popular" : "new";
  const service = targets(["readmeabook"])[0];
  if (!service) return { configured: false, items: [] };
  const cached = audiobookListCache.get(list);
  // An empty list is not cached for long: the person may be about to run the refresh job that fills it.
  if (cached && Date.now() - cached.at < (cached.items.length ? 30 : 2) * 60_000) return { configured: true, items: cached.items, message: cached.message };
  try {
    const { items, message } = await adapterFor(service).audiobookList!(list);
    audiobookListCache.set(list, { at: Date.now(), items, message });
    return { configured: true, items, message };
  } catch (err) {
    if (cached) return { configured: true, items: cached.items, message: cached.message };
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

// --- Podcasts: public charts, and adding a show to Audiobookshelf -------------------------------

// Episode list for a show, and picking which ones Audiobookshelf downloads or drops.
const absFor = (id?: string) => {
  const s = id ? getService(id) : undefined;
  if (!s || s.kind !== "audiobookshelf" || !s.enabled) throw app.httpErrors.notFound("Unknown Audiobookshelf service");
  return s;
};

app.get<{ Querystring: { serviceId?: string; itunesId?: string } }>("/api/podcasts/episodes", async (req) => {
  const service = absFor(req.query.serviceId);
  try {
    const { feedUrl } = await lookupFeed(req.query.itunesId ?? "");
    return await adapterFor(service).podcastEpisodes!(feedUrl);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; itunesId?: string; keys?: unknown } }>("/api/podcasts/download", async (req) => {
  const service = absFor(req.body?.serviceId);
  const keys = req.body?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 500 || !keys.every((k) => typeof k === "string")) throw app.httpErrors.badRequest("Pick episodes to download");
  try {
    const { feedUrl } = await lookupFeed(req.body?.itunesId ?? "");
    const adapter = adapterFor(service);
    const info = await adapter.podcastEpisodes!(feedUrl);
    if (!info.itemId) throw new Error("This podcast isn't in Audiobookshelf yet");
    return { ok: true, count: await adapter.downloadPodcastEpisodes!(info.itemId, feedUrl, keys as string[]) };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; itunesId?: string; episodeIds?: unknown } }>("/api/podcasts/delete-episodes", async (req) => {
  const service = absFor(req.body?.serviceId);
  const ids = req.body?.episodeIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((k) => typeof k === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(k))) throw app.httpErrors.badRequest("Pick episodes to delete");
  try {
    const { feedUrl } = await lookupFeed(req.body?.itunesId ?? "");
    const adapter = adapterFor(service);
    const info = await adapter.podcastEpisodes!(feedUrl);
    if (!info.itemId) throw new Error("This podcast isn't in Audiobookshelf");
    // Only episodes this show actually holds can be deleted.
    const allowed = new Set(info.episodes.map((e) => e.episodeId).filter(Boolean));
    const targets = (ids as string[]).filter((i) => allowed.has(i));
    await adapter.deletePodcastEpisodes!(info.itemId, targets);
    return { ok: true, count: targets.length };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { genre?: string } }>("/api/podcasts/top", async (req) => {
  const genre = PODCAST_GENRES.find((g) => g.id === req.query.genre)?.id ?? "all";
  try {
    const added = new Set(getSetting<string[]>("podcastsAdded", []));
    return { genres: PODCAST_GENRES, items: (await topPodcasts(genre)).map((p) => (added.has(p.itunesId) ? { ...p, added: true } : p)) };
  } catch (err) {
    throw app.httpErrors.badGateway(`Couldn't load the podcast chart: ${errorMessage(err)}`);
  }
});

app.get("/api/podcasts/targets", async () => {
  const r = await fanOut<PodcastTarget>(targets(["audiobookshelf"]), (s) => adapterFor(s).podcastTargets?.());
  return r;
});

app.post<{ Body: { serviceId?: string; libraryId?: string; folderId?: string; folderPath?: string; itunesId?: string; autoDownload?: boolean; episodes?: unknown } }>("/api/podcasts/add", async (req) => {
  const { serviceId, libraryId, folderId, folderPath, itunesId, autoDownload } = req.body ?? {};
  const episodes = Array.isArray(req.body?.episodes) ? (req.body!.episodes as unknown[]).filter((e): e is string => typeof e === "string").slice(0, 500) : undefined;
  const service = serviceId ? getService(serviceId) : undefined;
  if (!service || service.kind !== "audiobookshelf") throw app.httpErrors.notFound("Unknown Audiobookshelf service");
  if (!libraryId || !folderId || !folderPath || !itunesId) throw app.httpErrors.badRequest("Choose a podcast library and folder");
  try {
    const { feedUrl } = await lookupFeed(itunesId);
    const result = await adapterFor(service).addPodcast!({ libraryId, folderId, folderPath, feedUrl, autoDownload: Boolean(autoDownload), episodes });
    // The new show will appear in the library on the next refresh of the media-server side.
    serversRaw = serversRaw && { ...serversRaw, at: 0 };
    // Remember it, so the chart keeps saying "Added" even before the library lists it.
    setSetting("podcastsAdded", [...new Set([...getSetting<string[]>("podcastsAdded", []), itunesId])]);
    return { ok: true, title: result.title };
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get("/api/audiobook-requests", async () => {
  const services = targets(["readmeabook"]);
  const r = await fanOut<AudiobookRequestInfo>(services, (s) => adapterFor(s).audiobookRequests?.());
  return { items: r.items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), errors: r.errors, configured: services.length > 0 };
});

// --- Download history ----------------------------------------------------------------------------

app.get("/api/history", async () => {
  const r = await fanOut<HistoryItem>(listServices().filter((s) => s.enabled), (svc) => adapterFor(svc).history?.());
  return { items: r.items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 250), errors: r.errors };
});

app.post<{ Body: Partial<AddRequest> & { serviceId?: string; title?: string; year?: number } }>("/api/add", async (req) => {
  const { serviceId, ids, rootFolderPath, qualityProfileId, monitored, searchNow, title, year } = req.body ?? {};
  const service = managerService(serviceId);
  if (!ids || !rootFolderPath || typeof qualityProfileId !== "number") {
    throw app.httpErrors.badRequest("Choose a folder and a quality profile");
  }
  // "Already added" is a normal outcome (a slow first attempt, another app, an old search result): say so and
  // point at the title instead of leaving the person stuck on an error.
  let alreadyAdded = false;
  try {
    await adapterFor(service).add!({ ids, rootFolderPath, qualityProfileId, monitored: monitored ?? true, searchNow: searchNow ?? true });
  } catch (err) {
    if (/already (been )?(added|exists)/i.test(errorMessage(err))) alreadyAdded = true;
    else {
      // A timeout can still mean the manager finished: refresh anyway so the library tells the truth.
      await refreshManagers().catch(() => {});
      throw app.httpErrors.badGateway(errorMessage(err));
    }
  }
  await refreshManagers(); // the new title shows up on the next library load, without re-pulling Plex
  const wanted = service.kind === "radarr" ? "movie" : "series";
  const library = currentMerged().items;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // By id first; if the manager and the lookup disagree on ids, fall back to the same name and year.
  const item =
    library.find((i) => i.type === wanted && ((ids.tmdb && i.ids.tmdb === ids.tmdb) || (ids.tvdb && i.ids.tvdb === ids.tvdb) || (ids.imdb && i.ids.imdb === ids.imdb))) ??
    (title ? library.find((i) => i.type === wanted && i.managed && norm(i.title) === norm(title) && (!year || !i.year || i.year === year)) : undefined);
  return { ok: true, alreadyAdded, key: item?.key };
});

// Asks Radarr/Sonarr to look for releases of titles already in the library (missing ones, usually).
app.post<{ Body: { serviceId?: string; arrIds?: unknown; monitor?: boolean } }>("/api/download-search", async (req) => {
  const service = managerService(req.body?.serviceId);
  const arrIds = req.body?.arrIds;
  if (!Array.isArray(arrIds) || arrIds.length === 0 || arrIds.length > 100 || !arrIds.every((n) => Number.isInteger(n) && n > 0)) {
    throw app.httpErrors.badRequest("Send between 1 and 100 titles to search for");
  }
  try {
    await adapterFor(service).searchDownloads!(arrIds as number[], { monitor: req.body?.monitor ?? false });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  // Turning monitoring on changes what the library should show, so don't serve the cached copy.
  if (req.body?.monitor) await refreshManagers();
  return { ok: true, count: arrIds.length };
});

// --- Manual release search ("interactive search") ---------------------------------------------

const intParam = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);

app.get<{ Querystring: { s?: string; id?: string } }>("/api/seasons", async (req) => {
  const service = managerService(req.query.s);
  const id = intParam(req.query.id);
  if (id === undefined || !adapterFor(service).seasons) throw app.httpErrors.badRequest("Seasons are only available for shows");
  try {
    return await adapterFor(service).seasons!(id);
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.get<{ Querystring: { s?: string; id?: string; season?: string; episode?: string } }>("/api/releases", async (req) => {
  const service = managerService(req.query.s);
  const id = intParam(req.query.id);
  if (id === undefined) throw app.httpErrors.badRequest("Missing title id");
  try {
    return await adapterFor(service).releases!(id, { season: intParam(req.query.season), episodeId: intParam(req.query.episode) });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
});

app.post<{ Body: { serviceId?: string; guid?: string; indexerId?: number } }>("/api/grab", async (req) => {
  const { serviceId, guid, indexerId } = req.body ?? {};
  const service = managerService(serviceId);
  if (!guid || typeof guid !== "string" || !Number.isInteger(indexerId)) throw app.httpErrors.badRequest("Missing release");
  try {
    await adapterFor(service).grab!({ guid, indexerId: indexerId as number });
  } catch (err) {
    throw app.httpErrors.badGateway(errorMessage(err));
  }
  return { ok: true };
});

// Artwork from Plex/Jellyfin/Audiobookshelf needs the service's token, so the browser asks us.
// Resized copies are cached on disk: Plex transcodes on every request, and a page of posters is a lot of requests.
const imageDir = join(configDir, "imgcache");
mkdirSync(imageDir, { recursive: true });
const IMAGE_CACHE_MAX_BYTES = 1_500_000_000;
const IMAGE_CACHE_ITEM_MAX = 4 * 1024 * 1024;
const MAX_PARALLEL_IMAGE_FETCHES = 6;

let activeFetches = 0;
const waiting: (() => void)[] = [];
async function withImageSlot<T>(job: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_PARALLEL_IMAGE_FETCHES) await new Promise<void>((resolve) => waiting.push(resolve));
  activeFetches++;
  try {
    return await job();
  } finally {
    activeFetches--;
    waiting.shift()?.();
  }
}

const imageFetches = new Map<string, Promise<{ bytes: Buffer; type: string }>>();

app.get<{ Querystring: { s?: string; p?: string } }>("/api/image", async (req, reply) => {
  const service = req.query.s ? getService(req.query.s) : undefined;
  const path = req.query.p ?? "";
  if (!service || !path.startsWith("/") || path.includes("..")) throw app.httpErrors.notFound();
  const id = createHash("sha1").update(`${service.id}|${path}`).digest("hex");
  reply.header("Cache-Control", "public, max-age=604800");
  try {
    const [bytes, type] = await Promise.all([readFile(join(imageDir, id)), readFile(join(imageDir, `${id}.type`), "utf8")]);
    reply.header("Content-Type", type);
    return reply.send(bytes);
  } catch {
    // Not cached yet.
  }
  let pending = imageFetches.get(id);
  if (!pending) {
    pending = withImageSlot(async () => {
      const res = await fetchChecked(service.url.replace(/\/+$/, "") + path, { headers: imageHeaders(service) });
      const bytes = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (bytes.length <= IMAGE_CACHE_ITEM_MAX) {
        await writeFile(join(imageDir, id), bytes).catch(() => {});
        await writeFile(join(imageDir, `${id}.type`), type).catch(() => {});
      }
      return { bytes, type };
    }).finally(() => imageFetches.delete(id));
    imageFetches.set(id, pending);
  }
  try {
    const { bytes, type } = await pending;
    reply.header("Content-Type", type);
    return reply.send(bytes);
  } catch {
    throw app.httpErrors.notFound();
  }
});

/** Keep the image cache bounded: when it grows past the limit, drop the least recently written files. */
async function pruneImageCache() {
  try {
    const names = (await readdir(imageDir)).filter((n) => !n.endsWith(".type"));
    const files = await Promise.all(names.map(async (n) => ({ n, st: await stat(join(imageDir, n)) })));
    let total = files.reduce((sum, f) => sum + f.st.size, 0);
    if (total <= IMAGE_CACHE_MAX_BYTES) return;
    for (const f of files.sort((a, b) => a.st.mtimeMs - b.st.mtimeMs)) {
      if (total <= IMAGE_CACHE_MAX_BYTES * 0.8) break;
      await Promise.all([unlink(join(imageDir, f.n)), unlink(join(imageDir, `${f.n}.type`))].map((p) => p.catch(() => {})));
      total -= f.st.size;
    }
  } catch {
    // Pruning is housekeeping only.
  }
}

// --- Home page layout -----------------------------------------------------------------------

interface HomeSettings { sections: unknown[] | null; pinned: string[] }

const homeFor = (req: import("fastify").FastifyRequest) =>
  getSetting<HomeSettings | undefined>(homeKeyFor(req), undefined) ?? getSetting<HomeSettings>("home", { sections: null, pinned: [] });

app.get("/api/settings/home", async (req) => homeFor(req));

app.put<{ Body: HomeSettings }>("/api/settings/home", async (req) => {
  const { sections, pinned } = req.body ?? {};
  if (sections !== null && !Array.isArray(sections)) throw app.httpErrors.badRequest("sections must be a list");
  const clean: HomeSettings = { sections, pinned: Array.isArray(pinned) ? pinned.filter((k) => typeof k === "string") : [] };
  setSetting(homeKeyFor(req), clean);
  return clean;
});

// --- Poster overrides -----------------------------------------------------------------------
// A replaced poster is stored in the config folder and used by Matinee only; it is not pushed to Plex.

async function savePoster(key: string, bytes: Buffer, contentType: string) {
  const ext = IMAGE_EXT[contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) throw app.httpErrors.unsupportedMediaType("Use a JPEG, PNG, WebP or GIF image");
  if (bytes.length > MAX_IMAGE_BYTES) throw app.httpErrors.payloadTooLarge("Image is larger than 15 MB");
  const file = `${createHash("sha1").update(key).digest("hex").slice(0, 16)}-${Date.now()}.${ext}`;
  await writeFile(join(postersDir, file), bytes);
  const overrides = posterOverrides();
  if (overrides[key]) await unlink(join(postersDir, overrides[key])).catch(() => {});
  setSetting("posters", { ...overrides, [key]: file });
  return { poster: `/posters/${file}` };
}

app.post<{ Querystring: { key?: string }; Body: Buffer | { key?: string; url?: string } }>("/api/poster", async (req) => {
  if (Buffer.isBuffer(req.body)) {
    if (!req.query.key) throw app.httpErrors.badRequest("Missing key");
    return savePoster(req.query.key, req.body, req.headers["content-type"] ?? "");
  }
  const { key, url } = req.body ?? {};
  if (!key || !url || !/^https?:\/\//.test(url)) throw app.httpErrors.badRequest("Send a key and an http(s) image URL");
  const res = await fetchChecked(url).catch((err) => {
    throw app.httpErrors.badGateway(errorMessage(err));
  });
  return savePoster(key, Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") ?? "");
});

// Put the poster chosen in Matinee onto the title's Plex/Jellyfin entries themselves.
app.post<{ Body: { key?: string } }>("/api/poster/push", async (req) => {
  const key = req.body?.key ?? "";
  const file = posterOverrides()[key];
  if (!file) throw app.httpErrors.badRequest("Choose a poster for this title first");
  await ensureLibrary(false);
  const item = currentMerged().byKey.get(key);
  if (!item) throw app.httpErrors.notFound();
  const entries = item.available.filter((a) => a.itemId && getService(a.serviceId)?.enabled);
  if (entries.length === 0) throw app.httpErrors.badRequest("This title isn't on Plex or Jellyfin");
  const bytes = await readFile(join(postersDir, file));
  const type = Object.entries(IMAGE_EXT).find(([, e]) => e === file.split(".").pop())?.[0] ?? "image/jpeg";
  const done: string[] = [];
  const failed: string[] = [];
  for (const e of entries) {
    const svc = getService(e.serviceId)!;
    try {
      await adapterFor(svc).setPoster!(e.itemId!, bytes, type);
      done.push(svc.name);
    } catch (err) {
      failed.push(`${svc.name}: ${errorMessage(err)}`);
    }
  }
  return { done, failed };
});

app.delete<{ Querystring: { key?: string } }>("/api/poster", async (req) => {
  const key = req.query.key ?? "";
  const { [key]: file, ...rest } = posterOverrides();
  if (file) await unlink(join(postersDir, file)).catch(() => {});
  setSetting("posters", rest);
  return { ok: true };
});

// In production the built web UI is served from the same port.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), process.env.WEB_DIST ?? "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  await app.register(fastifyStatic, { root: resolve(postersDir), prefix: "/posters/", decorateReply: false });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") || req.url.startsWith("/posters/")
      ? reply.code(404).send({ error: "Not found" })
      : reply.sendFile("index.html"),
  );
} else {
  await app.register(fastifyStatic, { root: resolve(postersDir), prefix: "/posters/" });
}

const port = Number(process.env.PORT ?? 7171);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  void ensureLibrary(false); // warm the cache so the first visit isn't a long wait
  void pruneImageCache();
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

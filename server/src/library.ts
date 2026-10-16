// Merges what the managers (Radarr/Sonarr) track with what the media servers
// (Plex/Jellyfin/Audiobookshelf) actually have, matching titles by external ID.
import type { MediaItem, RawCollection, RawItem } from "./services/types.js";

export interface Collection {
  name: string;
  /** Which services have a collection with this name, and how many of the merged titles it holds there. */
  services: { serviceId: string; count: number }[];
  poster?: string;
  memberKeys: string[];
  /** True when some server could hold more of these titles than its collection does (or has no such collection). */
  needsSync?: boolean;
}

const normalize = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");

function matchKeys(item: RawItem): string[] {
  const keys: string[] = [];
  const { tmdb, tvdb, imdb } = item.ids;
  if (tmdb) keys.push(`${item.type}:tmdb:${tmdb}`);
  if (tvdb) keys.push(`${item.type}:tvdb:${tvdb}`);
  if (imdb) keys.push(`${item.type}:imdb:${imdb}`);
  // Title+year is the last resort when a server item lacks agent IDs.
  if (item.year) keys.push(`${item.type}:title:${normalize(item.title)}:${item.year}`);
  else if (item.type === "book") keys.push(`book:title:${normalize(item.title)}`);
  return keys;
}

function itemKey(item: RawItem): string {
  const { tmdb, tvdb, imdb } = item.ids;
  const id = tmdb ? `tmdb-${tmdb}` : tvdb ? `tvdb-${tvdb}` : imdb ? `imdb-${imdb}` : `${normalize(item.title)}-${item.year ?? 0}`;
  return `${item.type}:${id}`;
}

const later = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : a ?? b);

/** Fills fields the manager lacked from the media server's copy of the same title. */
function absorb(target: MediaItem, from: RawItem) {
  target.available.push(...from.available);
  target.poster ??= from.poster;
  target.backdrop ??= from.backdrop;
  target.overview ??= from.overview;
  target.genres ??= from.genres;
  target.runtimeMinutes ??= from.runtimeMinutes;
  target.rating ??= from.rating;
  target.certification ??= from.certification;
  target.studio ??= from.studio;
  target.author ??= from.author;
  target.added = later(target.added, from.added);
}

/**
 * Folder names ("christmas", "kidstv") rarely match library names ("Christmas Movies").
 * Learn the mapping from titles that are on a server: whichever library most titles from
 * that folder landed in is what the folder means.
 */
function folderVotes(items: MediaItem[]) {
  const votes = new Map<string, Map<string, number>>();
  for (const item of items) {
    const folder = item.managed?.rootFolder;
    if (!folder || item.type === "book") continue;
    const key = `${item.type}:${folder.toLowerCase()}`;
    const tally = votes.get(key) ?? new Map<string, number>();
    for (const a of item.available) if (a.library) tally.set(a.library, (tally.get(a.library) ?? 0) + 1);
    votes.set(key, tally);
  }
  return (item: MediaItem): string | undefined => {
    const folder = item.managed?.rootFolder;
    const tally = folder && votes.get(`${item.type}:${folder.toLowerCase()}`);
    if (!tally || tally.size === 0) return folder;
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
}

function libraryNames(item: MediaItem, fallback: (i: MediaItem) => string | undefined): string[] {
  const seen = new Map<string, string>();
  const add = (name?: string) => name && !seen.has(name.toLowerCase()) && seen.set(name.toLowerCase(), name);
  item.available.forEach((a) => add(a.library));
  // Titles no server has yet still belong somewhere: use the library their folder maps to.
  if (item.available.length === 0) add(fallback(item));
  return [...seen.values()];
}

export function buildLibrary(managed: RawItem[], onServers: RawItem[]) {
  const items: MediaItem[] = [];
  const index = new Map<string, MediaItem>();
  const usedKeys = new Set<string>();

  const find = (raw: RawItem) => matchKeys(raw).map((k) => index.get(k)).find(Boolean);

  const add = (raw: RawItem) => {
    let key = itemKey(raw);
    for (let n = 2; usedKeys.has(key); n++) key = `${itemKey(raw)}~${n}`;
    usedKeys.add(key);
    const entry: MediaItem = { ...raw, key, ids: { ...raw.ids }, available: [...raw.available], libraries: [] };
    items.push(entry);
    for (const k of matchKeys(entry)) if (!index.has(k)) index.set(k, entry);
  };

  managed.forEach(add);

  for (const raw of onServers) {
    const match = find(raw);
    if (!match) {
      add(raw);
      continue;
    }
    absorb(match, raw);
    // Fill in IDs the manager lacked so later servers can match on them too.
    for (const [k, v] of Object.entries(raw.ids) as [keyof typeof raw.ids, string | undefined][]) {
      if (v && !match.ids[k]) {
        match.ids[k] = v;
        const key = `${match.type}:${k}:${v}`;
        if (!index.has(key)) index.set(key, match);
      }
    }
  }

  const folderLibrary = folderVotes(items);
  for (const item of items) {
    item.libraries = libraryNames(item, folderLibrary);
    if (item.libraries.length === 0) item.libraries = ["Unsorted"];
  }
  items.sort((a, b) => a.title.localeCompare(b.title));
  return { items, find };
}

/** Joins same-named collections from different servers so gaps between them are visible. */
export function mergeCollections(raw: RawCollection[], find: (r: RawItem) => MediaItem | undefined, serverIds: string[] = []): Collection[] {
  interface Entry extends Collection { perService: Map<string, Set<string>>; items: Map<string, MediaItem> }
  const byName = new Map<string, Entry>();
  for (const c of raw) {
    const matched = c.members.map((m) => find(m)).filter((i): i is MediaItem => Boolean(i));
    const keys = [...new Set(matched.map((i) => i.key))];
    if (keys.length === 0) continue;
    const id = normalize(c.name);
    const entry: Entry = byName.get(id) ?? { name: c.name, services: [], poster: c.poster, memberKeys: [], perService: new Map(), items: new Map() };
    entry.poster ??= c.poster;
    // A Plex collection can exist once per library section; count them together per server.
    const have = entry.perService.get(c.serviceId) ?? new Set<string>();
    keys.forEach((k) => have.add(k));
    entry.perService.set(c.serviceId, have);
    const existing = entry.services.find((s) => s.serviceId === c.serviceId);
    if (existing) existing.count = have.size;
    else entry.services.push({ serviceId: c.serviceId, count: have.size });
    matched.forEach((i) => entry.items.set(i.key, i));
    entry.memberKeys = [...new Set([...entry.memberKeys, ...keys])];
    byName.set(id, entry);
  }
  return [...byName.values()]
    .map(({ perService, items, ...c }): Collection => ({
      ...c,
      // Out of sync only counts titles a server could actually take: ones it has but its collection lacks.
      needsSync:
        serverIds.length > 0 &&
        [...items.values()].some((item) => serverIds.some((sid) => item.available.some((a) => a.serviceId === sid) && !perService.get(sid)?.has(item.key))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

import { ServiceError, fetchChecked, getJson, joinUrl } from "../http.js";
import { mapLimit } from "../util.js";
import { resolutionLabel } from "./resolution.js";
import type { ExternalIds, NativeMember, RawCollection, RawItem, ServiceAdapter, ServiceConfig, WatchState } from "./types.js";

interface Section { key: string; title: string; type: string }

interface PlexItem {
  ratingKey: string;
  title: string;
  year?: number;
  summary?: string;
  rating?: number;
  audienceRating?: number;
  contentRating?: string;
  studio?: string;
  duration?: number;
  addedAt?: number;
  thumb?: string;
  art?: string;
  Genre?: { tag: string }[];
  Guid?: { id: string }[];
  Media?: { videoResolution?: string; width?: number; videoCodec?: string }[];
  viewCount?: number; viewOffset?: number; viewedLeafCount?: number; leafCount?: number;
}

interface PlexCollection { ratingKey: string; title: string; thumb?: string }

const PAGE_SIZE = 250;
const WRITE_BATCH = 40;
const COLLECTION_CONCURRENCY = 4;

type Container<T> = { MediaContainer: T };

function parseGuids(guids: { id: string }[] = []): ExternalIds {
  const ids: ExternalIds = {};
  for (const { id } of guids) {
    const [scheme, value] = id.split("://");
    if (scheme === "tmdb" || scheme === "tvdb" || scheme === "imdb") ids[scheme] = value;
  }
  return ids;
}

export function plexAdapter(cfg: ServiceConfig): ServiceAdapter {
  const api = <T>(path: string) => getJson<Container<T>>(joinUrl(cfg.url, path), { "X-Plex-Token": cfg.apiKey });
  // Plex images need the token, so the browser fetches them through Matinee's /api/image proxy.
  // Plex's own thumbs are huge; its transcoder returns the size the UI really needs.
  const img = (path: string | undefined, kind: "poster" | "backdrop") => {
    if (!path) return undefined;
    const [w, h] = kind === "poster" ? [342, 513] : [1280, 720];
    const transcode = `/photo/:/transcode?width=${w}&height=${h}&minSize=1&upscale=1&url=${encodeURIComponent(path)}`;
    return `/api/image?s=${cfg.id}&p=${encodeURIComponent(transcode)}`;
  };

  const sections = async () =>
    (await api<{ Directory?: Section[] }>("/library/sections")).MediaContainer.Directory ?? [];

  const watchOf = (series: boolean, item: PlexItem): WatchState => {
    if (series) {
      const total = item.leafCount ?? 0;
      const seen = item.viewedLeafCount ?? 0;
      if (total > 0 && seen >= total) return { state: "watched", progress: 1, seen, total };
      return seen > 0 ? { state: "inprogress", progress: total ? seen / total : undefined, seen, total } : { state: "unwatched", seen: 0, total };
    }
    if ((item.viewCount ?? 0) > 0) return { state: "watched", progress: 1 };
    if ((item.viewOffset ?? 0) > 0 && item.duration) return { state: "inprogress", progress: Math.min(1, (item.viewOffset ?? 0) / item.duration) };
    return { state: "unwatched" };
  };

  const toItem = (section: Section, item: PlexItem): RawItem => {
    const media = item.Media?.[0];
    return {
      type: section.type === "movie" ? "movie" : "series",
      title: item.title,
      year: item.year,
      ids: parseGuids(item.Guid),
      poster: img(item.thumb, "poster"),
      backdrop: img(item.art, "backdrop"),
      overview: item.summary || undefined,
      genres: item.Genre?.map((g) => g.tag),
      runtimeMinutes: item.duration ? Math.round(item.duration / 60000) : undefined,
      rating: item.rating || item.audienceRating || undefined,
      certification: item.contentRating,
      studio: item.studio,
      added: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : undefined,
      available: [
        {
          serviceId: cfg.id,
          library: section.title,
          resolution: media?.width ? resolutionLabel(media.width) : media?.videoResolution,
          videoCodec: media?.videoCodec,
          itemId: item.ratingKey,
          sectionKey: section.key,
          watch: watchOf(section.type !== "movie", item),
        },
      ],
    };
  };

  // Big libraries in one response can take longer than a request is allowed, so read them in pages.
  async function pagedItems(section: Section): Promise<PlexItem[]> {
    const out: PlexItem[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const res = await api<{ Metadata?: PlexItem[]; totalSize?: number }>(
        `/library/sections/${section.key}/all?includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`,
      );
      const page = res.MediaContainer.Metadata ?? [];
      out.push(...page);
      const total = res.MediaContainer.totalSize;
      if (page.length < PAGE_SIZE || (total !== undefined && out.length >= total)) return out;
    }
  }

  let machineId: string | undefined;
  const uriFor = async (members: NativeMember[]) => {
    machineId ??= (await api<{ machineIdentifier?: string }>("/identity")).MediaContainer.machineIdentifier;
    if (!machineId) throw new ServiceError("Plex didn't report its machine identifier");
    return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${members.map((m) => m.itemId).join(",")}`;
  };
  const addBatch = async (id: string, members: NativeMember[]) => {
    await fetchChecked(joinUrl(cfg.url, `/library/collections/${id}/items?uri=${encodeURIComponent(await uriFor(members))}`), {
      method: "PUT",
      headers: { "X-Plex-Token": cfg.apiKey },
    });
  };

  const videoSections = async () => (await sections()).filter((s) => s.type === "movie" || s.type === "show");

  return {
    async test() {
      const identity = await api<{ version: string }>("/identity");
      await sections(); // /identity is public; this validates the token.
      return { ok: true, version: identity.MediaContainer.version };
    },

    async library(): Promise<RawItem[]> {
      const perSection = await Promise.all(
        (await videoSections()).map(async (section) => {
          return (await pagedItems(section)).map((item) => toItem(section, item));
        }),
      );
      return perSection.flat();
    },

    // Collection writes. Plex wants "server://<machine id>/com.plexapp.plugins.library/library/metadata/<keys>" URIs,
    // keeps each collection inside one library section, and is happier with modest batches.
    async collectionCreate(name: string, members: NativeMember[]): Promise<{ id: string }> {
      const sectionKey = members[0]?.sectionKey;
      if (!sectionKey) throw new ServiceError("Plex needs to know which library these titles are in; refresh the library once and try again");
      const first = members.slice(0, WRITE_BATCH);
      const res = await fetchChecked(
        joinUrl(cfg.url, `/library/collections?type=${members[0].type === "movie" ? 1 : 2}&title=${encodeURIComponent(name)}&smart=0&sectionId=${sectionKey}&uri=${encodeURIComponent(await uriFor(first))}`),
        { method: "POST", headers: { "X-Plex-Token": cfg.apiKey, Accept: "application/json" } },
      );
      const body = (await res.json().catch(() => undefined)) as { MediaContainer?: { Metadata?: { ratingKey?: string }[] } } | undefined;
      const id = body?.MediaContainer?.Metadata?.[0]?.ratingKey;
      if (!id) throw new ServiceError("Plex created the collection but didn't say which one it was");
      for (let i = WRITE_BATCH; i < members.length; i += WRITE_BATCH) await addBatch(id, members.slice(i, i + WRITE_BATCH));
      return { id };
    },

    async getPoster(itemId: string) {
      const res = await fetchChecked(joinUrl(cfg.url, `/library/metadata/${itemId}/thumb`), { headers: { "X-Plex-Token": cfg.apiKey } });
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/jpeg" };
    },

    // Plex takes the raw image and makes it the selected poster.
    async setPoster(itemId: string, image: Buffer, contentType: string): Promise<void> {
      await fetchChecked(joinUrl(cfg.url, `/library/metadata/${itemId}/posters`), {
        method: "POST", headers: { "X-Plex-Token": cfg.apiKey, "Content-Type": contentType }, body: new Uint8Array(image),
      });
    },

    async collectionAdd(collectionId: string, members: NativeMember[]): Promise<void> {
      for (let i = 0; i < members.length; i += WRITE_BATCH) await addBatch(collectionId, members.slice(i, i + WRITE_BATCH));
    },

    async collectionRemove(collectionId: string, members: NativeMember[]): Promise<void> {
      for (const m of members) {
        await fetchChecked(joinUrl(cfg.url, `/library/collections/${collectionId}/items/${m.itemId}`), { method: "DELETE", headers: { "X-Plex-Token": cfg.apiKey } });
      }
    },

    async collections(): Promise<RawCollection[]> {
      const perSection = await Promise.all(
        (await videoSections()).map(async (section) => {
          const list = await api<{ Metadata?: PlexCollection[] }>(`/library/sections/${section.key}/collections`);
          return mapLimit(
            list.MediaContainer.Metadata ?? [],
            COLLECTION_CONCURRENCY,
            async (c): Promise<RawCollection> => {
              const kids = await api<{ Metadata?: PlexItem[] }>(`/library/collections/${c.ratingKey}/children?includeGuids=1`);
              return {
                serviceId: cfg.id,
                id: c.ratingKey,
                sectionKey: section.key,
                name: c.title,
                poster: img(c.thumb, "poster"),
                members: (kids.MediaContainer.Metadata ?? []).map((item) => toItem(section, item)),
              };
            },
          );
        }),
      );
      return perSection.flat();
    },
  };
}

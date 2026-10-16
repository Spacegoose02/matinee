import { fetchChecked, getJson, joinUrl, request } from "../http.js";
import { mapLimit } from "../util.js";
import { resolutionLabel } from "./resolution.js";
import type { NativeMember, RawCollection, RawItem, ServiceAdapter, ServiceConfig, WatchState } from "./types.js";

interface Folder { Id: string; Name: string; CollectionType?: string }

interface JellyfinItem {
  Id: string;
  Name: string;
  Type: "Movie" | "Series" | "BoxSet";
  ProductionYear?: number;
  Overview?: string;
  Genres?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  DateCreated?: string;
  Studios?: { Name: string }[];
  BackdropImageTags?: string[];
  ImageTags?: { Primary?: string };
  ProviderIds?: Record<string, string>;
  MediaSources?: { MediaStreams?: { Type: string; Width?: number; Codec?: string }[] }[];
  UserData?: { Played?: boolean; PlaybackPositionTicks?: number; PlayedPercentage?: number; UnplayedItemCount?: number };
}

const FIELDS = "ProviderIds,MediaSources,Overview,Genres,Studios,DateCreated";
const WRITE_BATCH = 100;

export function jellyfinAdapter(cfg: ServiceConfig): ServiceAdapter {
  const api = <T>(path: string) =>
    getJson<T>(joinUrl(cfg.url, path), { Authorization: `MediaBrowser Token="${cfg.apiKey}"` });
  const img = (id: string, kind: "Primary" | "Backdrop") =>
    `/api/image?s=${cfg.id}&p=${encodeURIComponent(`/Items/${id}/Images/${kind}?maxWidth=${kind === "Primary" ? 342 : 1280}&quality=85`)}`;

  // Watch state is per user; use the first administrator's.
  let watchUser: string | null | undefined;
  const watchUserId = async (): Promise<string | undefined> => {
    if (watchUser === undefined) {
      try {
        const users = await api<{ Id: string; Policy?: { IsAdministrator?: boolean } }[]>("/Users");
        watchUser = (users.find((u) => u.Policy?.IsAdministrator) ?? users[0])?.Id ?? null;
      } catch {
        watchUser = null;
      }
    }
    return watchUser ?? undefined;
  };

  const watchOf = (item: JellyfinItem): WatchState | undefined => {
    const u = item.UserData;
    if (!u) return undefined;
    if (u.Played) return { state: "watched", progress: 1 };
    if (item.Type === "Series") return (u.PlayedPercentage ?? 0) > 0 ? { state: "inprogress", progress: (u.PlayedPercentage ?? 0) / 100 } : { state: "unwatched" };
    if ((u.PlaybackPositionTicks ?? 0) > 0 && item.RunTimeTicks) return { state: "inprogress", progress: Math.min(1, (u.PlaybackPositionTicks ?? 0) / item.RunTimeTicks) };
    return { state: "unwatched" };
  };

  const toItem = (folderName: string, item: JellyfinItem): RawItem => {
    const video = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === "Video");
    const p = item.ProviderIds ?? {};
    return {
      type: item.Type === "Movie" ? "movie" : "series",
      title: item.Name,
      year: item.ProductionYear,
      ids: { tmdb: p.Tmdb || undefined, tvdb: p.Tvdb || undefined, imdb: p.Imdb || undefined },
      poster: item.ImageTags?.Primary ? img(item.Id, "Primary") : undefined,
      backdrop: item.BackdropImageTags?.length ? img(item.Id, "Backdrop") : undefined,
      overview: item.Overview || undefined,
      genres: item.Genres?.length ? item.Genres : undefined,
      runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : undefined,
      rating: item.CommunityRating || undefined,
      certification: item.OfficialRating,
      studio: item.Studios?.[0]?.Name,
      added: item.DateCreated,
      available: [
        {
          serviceId: cfg.id,
          library: folderName,
          resolution: video?.Width ? resolutionLabel(video.Width) : undefined,
          videoCodec: video?.Codec,
          itemId: item.Id,
          watch: watchOf(item),
        },
      ],
    };
  };

  const addTo = async (id: string, members: NativeMember[]) => {
    await fetchChecked(joinUrl(cfg.url, `/Collections/${id}/Items?Ids=${members.map((m) => m.itemId).join(",")}`), {
      method: "POST",
      headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"` },
    });
  };

  const folders = async () =>
    (await api<{ Items: Folder[] }>("/Library/MediaFolders")).Items.filter(
      (f) => f.CollectionType === "movies" || f.CollectionType === "tvshows",
    );

  return {
    async test() {
      const info = await api<{ Version: string }>("/System/Info");
      return { ok: true, version: info.Version };
    },

    async library(): Promise<RawItem[]> {
      const uid = await watchUserId();
      const perFolder = await Promise.all(
        (await folders()).map(async (folder) => {
          const res = await api<{ Items: JellyfinItem[] }>(
            `/Items?ParentId=${folder.Id}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=${FIELDS}${uid ? `&UserId=${uid}` : ""}`,
          );
          return res.Items.map((item) => toItem(folder.Name, item));
        }),
      );
      return perFolder.flat();
    },

    // Collection writes: Jellyfin box sets can mix libraries, so no sections here.
    async collectionCreate(name: string, members: NativeMember[]): Promise<{ id: string }> {
      const first = members.slice(0, WRITE_BATCH);
      const { data } = await request<{ Id?: string }>(
        joinUrl(cfg.url, `/Collections?Name=${encodeURIComponent(name)}&Ids=${first.map((m) => m.itemId).join(",")}`),
        { method: "POST", headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"`, Accept: "application/json" } },
      );
      if (!data?.Id) throw new Error("Jellyfin created the collection but didn't say which one it was");
      for (let i = WRITE_BATCH; i < members.length; i += WRITE_BATCH) await addTo(data.Id, members.slice(i, i + WRITE_BATCH));
      return { id: data.Id };
    },

    async getPoster(itemId: string) {
      const res = await fetchChecked(joinUrl(cfg.url, `/Items/${itemId}/Images/Primary`), { headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"` } });
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "image/jpeg" };
    },

    // Jellyfin wants the image base64-encoded as the request body.
    async setPoster(itemId: string, image: Buffer, contentType: string): Promise<void> {
      await fetchChecked(joinUrl(cfg.url, `/Items/${itemId}/Images/Primary`), {
        method: "POST", headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"`, "Content-Type": contentType }, body: image.toString("base64"),
      });
    },

    async collectionAdd(collectionId: string, members: NativeMember[]): Promise<void> {
      for (let i = 0; i < members.length; i += WRITE_BATCH) await addTo(collectionId, members.slice(i, i + WRITE_BATCH));
    },

    async collectionRemove(collectionId: string, members: NativeMember[]): Promise<void> {
      for (let i = 0; i < members.length; i += WRITE_BATCH) {
        const ids = members.slice(i, i + WRITE_BATCH).map((m) => m.itemId).join(",");
        await fetchChecked(joinUrl(cfg.url, `/Collections/${collectionId}/Items?Ids=${ids}`), { method: "DELETE", headers: { Authorization: `MediaBrowser Token="${cfg.apiKey}"` } });
      }
    },

    async collections(): Promise<RawCollection[]> {
      const sets = await api<{ Items: JellyfinItem[] }>("/Items?IncludeItemTypes=BoxSet&Recursive=true");
      return mapLimit(sets.Items, 4, async (set): Promise<RawCollection> => {
          const kids = await api<{ Items: JellyfinItem[] }>(
            `/Items?ParentId=${set.Id}&Fields=${FIELDS}&IncludeItemTypes=Movie,Series`,
          );
          return {
            serviceId: cfg.id,
            id: set.Id,
            name: set.Name,
            poster: set.ImageTags?.Primary ? img(set.Id, "Primary") : undefined,
            members: kids.Items.map((item) => toItem("Collections", item)),
          };
      });
    },
  };
}

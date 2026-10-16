// Audiobookshelf: audiobooks and podcasts. Auth is a Bearer API token (Settings → Users → API token).
import { ServiceError, fetchChecked, getJson, joinUrl, postJson } from "../http.js";
import type { PodcastEpisode, PodcastTarget, RawItem, ServiceAdapter, ServiceConfig } from "./types.js";

interface Library { id: string; name: string; mediaType: "book" | "podcast"; folders?: { id: string; fullPath: string }[] }

interface AbsItem {
  id: string;
  addedAt?: number;
  media: {
    coverPath?: string;
    metadata: {
      title: string;
      authorName?: string;
      author?: string;
      publishedYear?: string | null;
      description?: string | null;
      genres?: string[];
    };
    duration?: number;
  };
}

interface FeedEpisode { title: string; description?: string; pubDate?: string; publishedAt?: number; enclosure?: { url?: string } }

export function audiobookshelfAdapter(cfg: ServiceConfig): ServiceAdapter {
  const api = <T>(path: string) => getJson<T>(joinUrl(cfg.url, path), { Authorization: `Bearer ${cfg.apiKey}` });

  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // The library item for a podcast, found by its feed address or, failing that, its title.
  const findPodcastItem = async (feedUrl: string, title: string): Promise<string | undefined> => {
    const { libraries } = await api<{ libraries: Library[] }>("/api/libraries");
    for (const lib of libraries.filter((l) => l.mediaType === "podcast")) {
      const found = await api<{ podcast?: { libraryItem?: { id: string; media?: { metadata?: { title?: string; feedUrl?: string } } } }[] }>(
        `/api/libraries/${lib.id}/search?q=${encodeURIComponent(title)}`,
      ).catch(() => ({ podcast: [] }));
      const hit = (found.podcast ?? []).map((p) => p.libraryItem).find((i) => i && (i.media?.metadata?.feedUrl === feedUrl || norm(i.media?.metadata?.title ?? "") === norm(title)));
      if (hit) return hit.id;
    }
    return undefined;
  };

  return {
    async test() {
      const libs = await api<{ libraries: Library[] }>("/api/libraries"); // validates the token
      const status = await getJson<{ serverVersion?: string }>(joinUrl(cfg.url, "/status")).catch(() => undefined);
      return { ok: true, version: status?.serverVersion, message: `${libs.libraries.length} libraries` };
    },

    // Podcast libraries and their folders: where "Add to Audiobookshelf" can put a new show.
    async podcastTargets(): Promise<PodcastTarget[]> {
      const { libraries } = await api<{ libraries: Library[] }>("/api/libraries");
      return libraries
        .filter((l) => l.mediaType === "podcast")
        .flatMap((l) => (l.folders ?? []).map((f) => ({
          serviceId: cfg.id, serviceName: cfg.name, libraryId: l.id, libraryName: l.name, folderId: f.id, folderPath: f.fullPath,
        })));
    },

    // The show's feed with a flag per episode for whether Audiobookshelf already holds it.
    async podcastEpisodes(feedUrl: string) {
      const headers = { Authorization: `Bearer ${cfg.apiKey}` };
      const feed = await postJson<{ podcast?: { metadata?: { title?: string }; episodes?: FeedEpisode[] } }>(joinUrl(cfg.url, "/api/podcasts/feed"), { rssFeed: feedUrl }, headers);
      const title = feed.podcast?.metadata?.title ?? "Podcast";
      const itemId = await findPodcastItem(feedUrl, title);
      let held: { id: string; title?: string; enclosure?: { url?: string } }[] = [];
      if (itemId) {
        const item = await api<{ media?: { episodes?: typeof held } }>(`/api/items/${itemId}?expanded=1`).catch(() => ({ media: undefined }));
        held = item.media?.episodes ?? [];
      }
      const episodes = (feed.podcast?.episodes ?? []).map((e): PodcastEpisode => {
        const have = held.find((h) => (e.enclosure?.url && h.enclosure?.url === e.enclosure.url) || (h.title && h.title === e.title));
        return {
          key: e.enclosure?.url ?? e.title,
          title: e.title,
          publishedAt: e.publishedAt ? new Date(e.publishedAt).toISOString() : e.pubDate,
          description: e.description ? e.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : undefined,
          downloaded: Boolean(have),
          episodeId: have?.id,
        };
      });
      return { itemId, title, episodes };
    },

    async downloadPodcastEpisodes(itemId: string, feedUrl: string, keys: string[]): Promise<number> {
      const headers = { Authorization: `Bearer ${cfg.apiKey}` };
      const feed = await postJson<{ podcast?: { episodes?: FeedEpisode[] } }>(joinUrl(cfg.url, "/api/podcasts/feed"), { rssFeed: feedUrl }, headers);
      const wanted = new Set(keys);
      const picked = (feed.podcast?.episodes ?? []).filter((e) => wanted.has(e.enclosure?.url ?? e.title));
      if (picked.length === 0) throw new ServiceError("Those episodes are no longer in the feed");
      await postJson(joinUrl(cfg.url, `/api/podcasts/${itemId}/download-episodes`), picked, headers);
      return picked.length;
    },

    async deletePodcastEpisodes(itemId: string, episodeIds: string[]): Promise<void> {
      for (const id of episodeIds) {
        await fetchChecked(joinUrl(cfg.url, `/api/podcasts/${itemId}/episode/${encodeURIComponent(id)}?hard=1`), { method: "DELETE", headers: { Authorization: `Bearer ${cfg.apiKey}` } });
      }
    },

    // Follows Audiobookshelf's own "add podcast" flow: read the feed for its details, then create the item.
    async addPodcast(req) {
      const headers = { Authorization: `Bearer ${cfg.apiKey}` };
      try {
        const feed = await postJson<{ podcast?: { metadata?: Record<string, unknown> } }>(joinUrl(cfg.url, "/api/podcasts/feed"), { rssFeed: req.feedUrl }, headers);
        const metadata: Record<string, unknown> = { ...(feed.podcast?.metadata ?? {}), feedUrl: req.feedUrl };
        const title = String(metadata.title ?? "Podcast");
        // Folder names can't hold these characters; Audiobookshelf creates the folder itself.
        const folder = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Podcast";
        const created = await postJson<{ id?: string }>(joinUrl(cfg.url, "/api/podcasts"), {
          path: `${req.folderPath.replace(/\/+$/, "")}/${folder}`,
          folderId: req.folderId,
          libraryId: req.libraryId,
          media: { metadata, autoDownloadEpisodes: req.autoDownload },
        }, headers);
        // Episodes picked in the add dialog are queued for download straight away.
        if (req.episodes?.length) {
          const id = created.id ?? (await findPodcastItem(req.feedUrl, title));
          if (id) await this.downloadPodcastEpisodes!(id, req.feedUrl, req.episodes);
        }
        return { title };
      } catch (err) {
        if (err instanceof ServiceError) {
          if (err.status === 403) throw new ServiceError("Audiobookshelf only lets admin users add podcasts. Use an admin API token for this connection.", 403);
          if (/already exists/i.test(err.message)) throw new ServiceError("That podcast is already in Audiobookshelf.", err.status);
        }
        throw err;
      }
    },

    async library(): Promise<RawItem[]> {
      const { libraries } = await api<{ libraries: Library[] }>("/api/libraries");
      const perLibrary = await Promise.all(
        libraries.map(async (lib) => {
          const res = await api<{ results: AbsItem[] }>(`/api/libraries/${lib.id}/items?limit=0&minified=1`);
          return res.results.map((item): RawItem => {
            const m = item.media.metadata;
            return {
              type: "book",
              title: m.title,
              year: m.publishedYear ? Number(m.publishedYear) || undefined : undefined,
              ids: {},
              author: m.authorName ?? m.author,
              // Covers need the token, so they go through Matinee's /api/image proxy.
              poster: item.media.coverPath
                ? `/api/image?s=${cfg.id}&p=${encodeURIComponent(`/api/items/${item.id}/cover?width=342`)}`
                : undefined,
              overview: m.description?.replace(/<[^>]*>/g, " ").trim() || undefined,
              genres: m.genres?.length ? m.genres : undefined,
              runtimeMinutes: item.media.duration ? Math.round(item.media.duration / 60) : undefined,
              added: item.addedAt ? new Date(item.addedAt).toISOString() : undefined,
              available: [{ serviceId: cfg.id, library: lib.name }],
            };
          });
        }),
      );
      return perLibrary.flat();
    },
  };
}

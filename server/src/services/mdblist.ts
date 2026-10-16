// MDBList (mdblist.com): curated and personal movie/show lists, with a free API key (query parameter "apikey").
import { ServiceError, getJson, joinUrl } from "../http.js";
import type { ExternalList, ServiceAdapter, ServiceConfig, TrendingItem } from "./types.js";

const BASE = "https://api.mdblist.com";

interface RawList { id: number | string; name: string; slug?: string; items?: number; mediatype?: string; user_name?: string; description?: string }
interface RawItem { id?: number; tmdb_id?: number; imdb_id?: string; tvdb_id?: number; title?: string; release_year?: number; mediatype?: string; rank?: number }

export function mdblistAdapter(cfg: ServiceConfig): ServiceAdapter {
  const get = async <T>(path: string): Promise<T> => {
    const sep = path.includes("?") ? "&" : "?";
    const data = await getJson<T & { error?: string }>(joinUrl(cfg.url || BASE, `${path}${sep}apikey=${encodeURIComponent(cfg.apiKey)}`));
    if (data && typeof data === "object" && !Array.isArray(data) && (data as { error?: string }).error) throw new ServiceError(String((data as { error?: string }).error));
    return data;
  };

  const normaliseLists = (raw: unknown): ExternalList[] => {
    const list = (Array.isArray(raw) ? raw : (raw as { lists?: RawList[] })?.lists ?? []) as RawList[];
    return list.map((l) => ({
      id: String(l.id), name: l.name, items: l.items, mediatype: l.mediatype, user: l.user_name, description: l.description || undefined,
    }));
  };

  return {
    async test() {
      await get("/user");
      return { ok: true };
    },

    async externalLists(scope: "mine" | "top" | "search", query?: string): Promise<ExternalList[]> {
      const path = scope === "mine" ? "/lists/user" : scope === "top" ? "/lists/top" : `/lists/search?query=${encodeURIComponent(query ?? "")}`;
      return normaliseLists(await get<unknown>(path)).slice(0, 100);
    },

    // A list page like mdblist.com/lists/<user>/<slug>, resolved to its list.
    async resolveList(user: string, slug: string): Promise<ExternalList | undefined> {
      return normaliseLists(await get<unknown>(`/lists/${encodeURIComponent(user)}/${encodeURIComponent(slug)}`))[0];
    },

    async externalListItems(listId: string, limit = 40, offset = 0): Promise<{ items: TrendingItem[]; more: boolean }> {
      const res = await get<{ movies?: RawItem[]; shows?: RawItem[] } | RawItem[]>(`/lists/${encodeURIComponent(listId)}/items?limit=${limit}&offset=${offset}`);
      const biggest = Array.isArray(res) ? res.length : Math.max(res.movies?.length ?? 0, res.shows?.length ?? 0);
      const tag = (items: RawItem[] | undefined, type: "movie" | "series") => (items ?? []).map((i) => ({ i, type }));
      const all = Array.isArray(res)
        ? res.map((i) => ({ i, type: (i.mediatype === "show" ? "series" : "movie") as "movie" | "series" }))
        : [...tag(res.movies, "movie"), ...tag(res.shows, "series")];
      const items = all
        .filter(({ i }) => i.title)
        .sort((a, b) => (a.i.rank ?? 0) - (b.i.rank ?? 0))
        .map(({ i, type }) => {
          const tmdb = i.tmdb_id ?? i.id;
          return {
            type,
            title: i.title!,
            year: i.release_year,
            ids: { tmdb: tmdb ? String(tmdb) : undefined, imdb: i.imdb_id || undefined, tvdb: i.tvdb_id ? String(i.tvdb_id) : undefined },
          };
        });
      return { items, more: biggest >= limit };
    },
  };
}

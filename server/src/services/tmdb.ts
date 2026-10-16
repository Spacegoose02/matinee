// TMDB (themoviedb.org): where "trending" and "popular" come from. Radarr/Sonarr have no such feed.
// Accepts either a v3 API key or a v4 "API Read Access Token" (the long one starting with eyJ).
import { getJson, joinUrl } from "../http.js";
import type { ListKind, ServiceAdapter, ServiceConfig, TrendingItem } from "./types.js";

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
}

const IMG = "https://image.tmdb.org/t/p";

const today = () => new Date().toISOString().slice(0, 10);

/** TMDB endpoint for each list. TV has no "upcoming" feed, so it uses premieres from today on, most popular first. */
const LIST_PATHS: Record<ListKind, { movie: () => string; series: () => string }> = {
  trending: { movie: () => "/trending/movie/week", series: () => "/trending/tv/week" },
  popular: { movie: () => "/movie/popular", series: () => "/tv/popular" },
  top_rated: { movie: () => "/movie/top_rated", series: () => "/tv/top_rated" },
  now: { movie: () => "/movie/now_playing", series: () => "/tv/on_the_air" },
  upcoming: {
    movie: () => "/movie/upcoming",
    series: () => `/discover/tv?first_air_date.gte=${today()}&sort_by=popularity.desc&include_null_first_air_dates=false`,
  },
};

export function tmdbAdapter(cfg: ServiceConfig): ServiceAdapter {
  const bearer = cfg.apiKey.startsWith("eyJ");
  const api = <T>(path: string) => {
    const sep = path.includes("?") ? "&" : "?";
    const url = joinUrl(cfg.url, `/3${path}${bearer ? "" : `${sep}api_key=${encodeURIComponent(cfg.apiKey)}`}`);
    return getJson<T>(url, bearer ? { Authorization: `Bearer ${cfg.apiKey}` } : {});
  };

  return {
    async test() {
      await api("/configuration");
      return { ok: true };
    },

    async details(type, tmdbId) {
      const r = await api<{ poster_path?: string; backdrop_path?: string; overview?: string; vote_average?: number; release_date?: string; first_air_date?: string }>(
        `/${type === "movie" ? "movie" : "tv"}/${tmdbId}`,
      );
      const date = r.release_date ?? r.first_air_date;
      return {
        poster: r.poster_path ? `${IMG}/w342${r.poster_path}` : undefined,
        backdrop: r.backdrop_path ? `${IMG}/w1280${r.backdrop_path}` : undefined,
        overview: r.overview || undefined,
        rating: r.vote_average || undefined,
        releaseDate: date || undefined,
        year: date ? Number(date.slice(0, 4)) || undefined : undefined,
      };
    },

    async posterOptions(type, tmdbId) {
      const res = await api<{ posters: { file_path: string; iso_639_1: string | null; vote_average: number }[] }>(
        `/${type === "movie" ? "movie" : "tv"}/${tmdbId}/images?include_image_language=en,null`,
      );
      return res.posters
        .sort((a, b) => b.vote_average - a.vote_average)
        .slice(0, 40)
        .map((p) => ({ thumb: `${IMG}/w185${p.file_path}`, url: `${IMG}/w780${p.file_path}`, language: p.iso_639_1 ?? undefined }));
    },

    async trailerUrl(type, tmdbId, hint): Promise<string | undefined> {
      // Search results from Sonarr often only carry a TVDB id, so find the title on TMDB by name.
      if (!tmdbId && hint) {
        const q = encodeURIComponent(hint.title);
        const year = hint.year ? `&${type === "movie" ? "year" : "first_air_date_year"}=${hint.year}` : "";
        const found = await api<{ results: { id: number }[] }>(`/search/${type === "movie" ? "movie" : "tv"}?query=${q}${year}`);
        tmdbId = found.results[0] && String(found.results[0].id);
      }
      if (!tmdbId) return undefined;
      const res = await api<{ results: { site: string; type: string; key: string; official?: boolean; published_at?: string }[] }>(
        `/${type === "movie" ? "movie" : "tv"}/${tmdbId}/videos`,
      );
      const best = res.results
        .filter((v) => v.site === "YouTube" && v.type === "Trailer")
        .sort((a, b) => Number(b.official ?? false) - Number(a.official ?? false) || (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
      return best && `https://www.youtube.com/watch?v=${best.key}`;
    },

    async trending(type, list = "trending", opts): Promise<TrendingItem[]> {
      const pages = Math.max(1, Math.min(opts?.pages ?? 1, 10));
      const base = LIST_PATHS[list][type]();
      const fetched = await Promise.all(
        Array.from({ length: pages }, (_, n) => api<{ results: TmdbResult[] }>(`${base}${base.includes("?") ? "&" : "?"}page=${(opts?.page ?? 1) + n}`).catch(() => ({ results: [] as TmdbResult[] }))),
      );
      const seen = new Set<number>();
      let results = fetched.flatMap((r) => r.results).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      // "Upcoming" can include titles that already came out; keep what has not released yet, soonest first.
      if (list === "upcoming") {
        results = results
          .filter((r) => (r.release_date ?? r.first_air_date ?? "") >= today())
          .sort((a, b) => (a.release_date ?? a.first_air_date ?? "").localeCompare(b.release_date ?? b.first_air_date ?? ""));
      }
      return results.slice(0, pages * 20).map((r) => {
        const date = r.release_date ?? r.first_air_date;
        return {
          type,
          title: r.title ?? r.name ?? "Untitled",
          year: date ? Number(date.slice(0, 4)) || undefined : undefined,
          releaseDate: date || undefined,
          ids: { tmdb: String(r.id) },
          poster: r.poster_path ? `${IMG}/w342${r.poster_path}` : undefined,
          backdrop: r.backdrop_path ? `${IMG}/w780${r.backdrop_path}` : undefined,
          overview: r.overview || undefined,
          rating: r.vote_average || undefined,
        };
      });
    },
  };
}

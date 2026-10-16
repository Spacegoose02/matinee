// Radarr and Sonarr share the v3 API shape closely enough for one adapter.
import { ServiceError, fetchChecked, getJson, joinUrl, postJson, putJson } from "../http.js";
import type {
  AddOptions, AddRequest, EpisodeInfo, HistoryItem, ImportCandidate, ImportIssue, ManagerTask, RenumberRow, QueueItem, RemotePathMapping, RenameChange, RawItem, ReleaseInfo, SearchResult, SeasonInfo, ServiceAdapter, ServiceConfig,
} from "./types.js";

type Image = { coverType: string; remoteUrl?: string };

interface Common {
  id?: number;
  tags?: number[];
  title: string; year: number; imdbId?: string; tmdbId?: number;
  monitored: boolean; path: string; images: Image[]; added?: string;
  overview?: string; genres?: string[]; runtime?: number; certification?: string;
  ratings?: { imdb?: { value: number }; tmdb?: { value: number }; value?: number };
}

interface RadarrMovie extends Common {
  hasFile: boolean; sizeOnDisk: number; studio?: string;
  movieFile?: { id?: number; quality?: { quality?: { name: string } } };
}

interface SonarrSeries extends Common {
  tvdbId: number; network?: string;
  statistics?: { episodeFileCount: number; episodeCount: number; sizeOnDisk: number };
}

interface ArrQueueRecord {
  id: number; title: string; status: string; size: number; sizeleft: number;
  timeleft?: string; downloadClient?: string; trackedDownloadStatus?: string; trackedDownloadState?: string;
  outputPath?: string;
  statusMessages?: { title: string; messages: string[] }[];
}

// The managers hand back TMDB's "original" artwork (often over a megabyte each); ask for sizes the UI actually shows.
const TMDB_SIZES: Record<string, string> = { poster: "w342", fanart: "w1280" };
const RELEASE_TIMEOUT_MS = 150_000; // indexers are queried live and some are slow
// Adding a title makes the manager fetch metadata and create folders (slow on a network share), well past the usual limit.
const ADD_TIMEOUT_MS = 180_000;

const importPhase = (state?: string) =>
  state === "importing" ? "Importing into library" : state === "importPending" ? "Waiting to import" : state === "importBlocked" ? "Import blocked" : state === "importFailed" ? "Import failed" : state === "imported" ? "Imported" : undefined;

const labelsFor = (ids: number[] | undefined, names: Map<number, string>): string[] | undefined => {
  const labels = (ids ?? []).map((id) => names.get(id)).filter((l): l is string => Boolean(l));
  return labels.length ? labels : undefined;
};

const image = (images: Image[], type: string) => {
  const url = images.find((i) => i.coverType === type)?.remoteUrl;
  const size = TMDB_SIZES[type];
  return url && size ? url.replace(/\/t\/p\/(?:original|w\d+)\//, `/t/p/${size}/`) : url;
};

interface ArrRelease {
  guid: string; indexerId: number; indexer?: string; title: string; size: number; age?: number; ageHours?: number;
  protocol?: string; seeders?: number; leechers?: number; releaseGroup?: string;
  quality?: { quality?: { name: string } }; languages?: { name: string }[];
  approved?: boolean; rejected?: boolean; rejections?: string[]; customFormatScore?: number;
  fullSeason?: boolean; seasonNumber?: number; episodeNumbers?: number[];
}

const rating = (r: Common["ratings"]) => r?.tmdb?.value || r?.imdb?.value || r?.value || undefined;

/** "/movies/Kids Movies/Frozen (2013)" -> "Kids Movies" */
function rootFolder(path?: string): string | undefined {
  const parts = (path ?? "").split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
}

/** "1.02:03:04" or "02:03:04" -> seconds */
function parseTimeleft(t?: string): number | undefined {
  if (!t) return undefined;
  const [dayPart, rest] = t.includes(".") ? t.split(".") : ["0", t];
  const [h, m, s] = rest.split(":").map(Number);
  return Number(dayPart) * 86400 + h * 3600 + m * 60 + s;
}

function base(c: Common): Pick<RawItem, "title" | "year" | "poster" | "backdrop" | "overview" | "genres" | "runtimeMinutes" | "rating" | "certification" | "added" | "available"> {
  return {
    title: c.title,
    year: c.year || undefined,
    poster: image(c.images, "poster"),
    backdrop: image(c.images, "fanart"),
    overview: c.overview || undefined,
    genres: c.genres?.length ? c.genres : undefined,
    runtimeMinutes: c.runtime || undefined,
    rating: rating(c.ratings),
    certification: c.certification || undefined,
    added: c.added,
    available: [],
  };
}

/** Lookup results carry an id only when the title is already in the library. */
interface LookupMovie extends RadarrMovie { id?: number }
interface LookupSeries extends SonarrSeries { id?: number; status?: string; seasonCount?: number; seasons?: unknown[] }

export function arrAdapter(cfg: ServiceConfig): ServiceAdapter {
  const api = <T>(path: string) => getJson<T>(joinUrl(cfg.url, `/api/v3${path}`), { "X-Api-Key": cfg.apiKey });

  interface ManualItem {
    path: string; name?: string; relativePath?: string; size?: number; quality?: unknown; languages?: unknown; releaseGroup?: string; downloadId?: string;
    movie?: { id: number; title: string; year?: number };
    series?: { id: number; title: string };
    episodes?: { id: number; seasonNumber: number; episodeNumber: number; title?: string }[];
    rejections?: { reason: string }[];
  }
  const manualScan = async (folder: string) => {
    const items = await api<ManualItem[]>(`/manualimport?folder=${encodeURIComponent(folder)}&filterExistingFiles=true`);
    return items.map((i) => {
      const eps = i.episodes ?? [];
      const match = cfg.kind === "radarr"
        ? i.movie && `${i.movie.title}${i.movie.year ? ` (${i.movie.year})` : ""}`
        : i.series && eps.length ? `${i.series.title} · ${eps.map((e) => `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`).join(", ")}` : undefined;
      const common = { path: i.path, quality: i.quality, languages: i.languages, releaseGroup: i.releaseGroup, downloadId: i.downloadId ?? "" };
      const file = cfg.kind === "radarr"
        ? i.movie && { ...common, movieId: i.movie.id }
        : i.series && eps.length ? { ...common, seriesId: i.series.id, episodeIds: eps.map((e) => e.id) } : undefined;
      const candidate: ImportCandidate = {
        path: i.path,
        name: i.name ?? i.relativePath ?? i.path.split(/[\\/]/).pop() ?? i.path,
        sizeBytes: i.size,
        match: match || undefined,
        rejections: (i.rejections ?? []).map((r) => r.reason),
      };
      return { candidate, file };
    });
  };

  return {
    async test() {
      const s = await api<{ version: string }>("/system/status");
      return { ok: true, version: s.version };
    },

    async library(): Promise<RawItem[]> {
      const loadTags = async () => new Map((await api<{ id: number; label: string }[]>("/tag").catch(() => [])).map((t) => [t.id, t.label] as [number, string]));
      if (cfg.kind === "radarr") {
        const [movies, tagNames] = await Promise.all([api<RadarrMovie[]>("/movie"), loadTags()]);
        return movies.map((m) => ({
          ...base(m),
          type: "movie" as const,
          studio: m.studio || undefined,
          tags: labelsFor(m.tags, tagNames),
          ids: { tmdb: m.tmdbId ? String(m.tmdbId) : undefined, imdb: m.imdbId || undefined },
          managed: {
            serviceId: cfg.id,
            arrId: m.id,
            monitored: m.monitored,
            hasFile: m.hasFile,
            quality: m.movieFile?.quality?.quality?.name,
            fileId: m.movieFile?.id,
            sizeBytes: m.sizeOnDisk,
            path: m.path,
            rootFolder: rootFolder(m.path),
          },
        }));
      }
      const [series, tagNames] = await Promise.all([api<SonarrSeries[]>("/series"), loadTags()]);
      return series.map((s) => {
        const st = s.statistics;
        return {
          ...base(s),
          type: "series" as const,
          studio: s.network || undefined,
          tags: labelsFor(s.tags, tagNames),
          ids: {
            tvdb: s.tvdbId ? String(s.tvdbId) : undefined,
            tmdb: s.tmdbId ? String(s.tmdbId) : undefined,
            imdb: s.imdbId || undefined,
          },
          managed: {
            serviceId: cfg.id,
            arrId: s.id,
            monitored: s.monitored,
            hasFile: (st?.episodeFileCount ?? 0) > 0,
            sizeBytes: st?.sizeOnDisk ?? 0,
            episodes: st && { have: st.episodeFileCount, total: st.episodeCount },
            path: s.path,
            rootFolder: rootFolder(s.path),
          },
        };
      });
    },

    async search(term: string): Promise<SearchResult[]> {
      const q = encodeURIComponent(term);
      if (cfg.kind === "radarr") {
        const found = await api<LookupMovie[]>(`/movie/lookup?term=${q}`);
        return found.slice(0, 30).map((m) => ({
          serviceId: cfg.id,
          type: "movie" as const,
          title: m.title,
          year: m.year || undefined,
          ids: { tmdb: m.tmdbId ? String(m.tmdbId) : undefined, imdb: m.imdbId || undefined },
          overview: m.overview || undefined,
          poster: image(m.images, "poster"),
          genres: m.genres?.length ? m.genres : undefined,
          rating: rating(m.ratings),
          runtimeMinutes: m.runtime || undefined,
          certification: m.certification || undefined,
          studio: m.studio || undefined,
          inLibrary: Boolean(m.id),
        }));
      }
      const found = await api<LookupSeries[]>(`/series/lookup?term=${q}`);
      return found.slice(0, 30).map((s) => ({
        serviceId: cfg.id,
        type: "series" as const,
        title: s.title,
        year: s.year || undefined,
        ids: { tvdb: s.tvdbId ? String(s.tvdbId) : undefined, tmdb: s.tmdbId ? String(s.tmdbId) : undefined, imdb: s.imdbId || undefined },
        overview: s.overview || undefined,
        poster: image(s.images, "poster"),
        genres: s.genres?.length ? s.genres : undefined,
        rating: rating(s.ratings),
        runtimeMinutes: s.runtime || undefined,
        certification: s.certification || undefined,
        studio: s.network || undefined,
        status: s.status,
        seasons: s.seasonCount ?? s.seasons?.length,
        inLibrary: Boolean(s.id),
      }));
    },

    async addOptions(): Promise<AddOptions> {
      const [roots, profiles] = await Promise.all([
        api<{ path: string; freeSpace?: number }[]>("/rootfolder"),
        api<{ id: number; name: string }[]>("/qualityprofile"),
      ]);
      return {
        rootFolders: roots.map((r) => ({ path: r.path, freeBytes: r.freeSpace })),
        qualityProfiles: profiles.map((p) => ({ id: p.id, name: p.name })),
      };
    },

    // Re-runs the lookup by ID so the payload is exactly what the manager itself produced.
    async add(req: AddRequest): Promise<void> {
      const headers = { "X-Api-Key": cfg.apiKey };
      const url = (path: string) => joinUrl(cfg.url, `/api/v3${path}`);
      if (cfg.kind === "radarr") {
        if (!req.ids.tmdb) throw new ServiceError("This title has no TMDB id, so Radarr cannot add it");
        const [found] = await api<LookupMovie[]>(`/movie/lookup?term=${encodeURIComponent(`tmdb:${req.ids.tmdb}`)}`);
        if (!found) throw new ServiceError("Radarr could not find that title any more");
        await postJson(url("/movie"), {
          ...found,
          qualityProfileId: req.qualityProfileId,
          rootFolderPath: req.rootFolderPath,
          monitored: req.monitored,
          minimumAvailability: "released",
          addOptions: { searchForMovie: req.searchNow },
        }, headers, ADD_TIMEOUT_MS);
        return;
      }
      const term = req.ids.tvdb ? `tvdb:${req.ids.tvdb}` : req.ids.tmdb ? `tmdb:${req.ids.tmdb}` : undefined;
      if (!term) throw new ServiceError("This show has no TVDB or TMDB id, so Sonarr cannot add it");
      const [found] = await api<LookupSeries[]>(`/series/lookup?term=${encodeURIComponent(term)}`);
      if (!found) throw new ServiceError("Sonarr could not find that show any more");
      await postJson(url("/series"), {
        ...found,
        qualityProfileId: req.qualityProfileId,
        rootFolderPath: req.rootFolderPath,
        monitored: req.monitored,
        seasonFolder: true,
        addOptions: { monitor: req.monitored ? "all" : "none", searchForMissingEpisodes: req.searchNow, searchForCutoffUnmetEpisodes: false },
      }, headers, ADD_TIMEOUT_MS);
    },

    async episodes(arrId: number): Promise<EpisodeInfo[]> {
      interface Ep {
        id: number; seasonNumber: number; episodeNumber: number; title?: string; airDateUtc?: string; airDate?: string;
        hasFile: boolean; monitored: boolean; runtime?: number;
        episodeFile?: { id?: number; size?: number; quality?: { quality?: { name: string } } };
      }
      const list = await api<Ep[]>(`/episode?seriesId=${arrId}&includeEpisodeFile=true`);
      const now = Date.now();
      return list
        .map((e) => ({
          id: e.id,
          season: e.seasonNumber,
          episode: e.episodeNumber,
          title: e.title || `Episode ${e.episodeNumber}`,
          airDate: e.airDateUtc ?? e.airDate,
          aired: Boolean(e.airDateUtc ?? e.airDate) && Date.parse((e.airDateUtc ?? e.airDate)!) <= now,
          monitored: e.monitored,
          hasFile: e.hasFile,
          quality: e.episodeFile?.quality?.quality?.name,
          sizeBytes: e.episodeFile?.size,
          runtimeMinutes: e.runtime || undefined,
          fileId: e.episodeFile?.id,
        }))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);
    },

    async searchEpisodes(episodeIds: number[]): Promise<void> {
      await postJson(joinUrl(cfg.url, "/api/v3/command"), { name: "EpisodeSearch", episodeIds }, { "X-Api-Key": cfg.apiKey });
    },

    async searchSeason(arrId: number, season: number): Promise<void> {
      await postJson(joinUrl(cfg.url, "/api/v3/command"), { name: "SeasonSearch", seriesId: arrId, seasonNumber: season }, { "X-Api-Key": cfg.apiKey });
    },

    async setEpisodesMonitored(episodeIds: number[], monitored: boolean): Promise<void> {
      await putJson(joinUrl(cfg.url, "/api/v3/episode/monitor"), { episodeIds, monitored }, { "X-Api-Key": cfg.apiKey });
    },

    async history(): Promise<HistoryItem[]> {
      interface Rec {
        id: number; eventType: string; date: string; sourceTitle?: string;
        quality?: { quality?: { name: string } };
        data?: { indexer?: string; downloadClient?: string; message?: string; reason?: string; size?: string };
        movie?: { title: string; year?: number };
        series?: { title: string };
        episode?: { seasonNumber: number; episodeNumber: number; title?: string };
      }
      const include = cfg.kind === "radarr" ? "includeMovie=true" : "includeSeries=true&includeEpisode=true";
      const page = await api<{ records: Rec[] }>(`/history?page=1&pageSize=80&sortKey=date&sortDirection=descending&${include}`);
      const events: Record<string, HistoryItem["event"]> = {
        grabbed: "grabbed", downloadFolderImported: "imported", movieFolderImported: "imported",
        downloadFailed: "failed", movieFileDeleted: "deleted", episodeFileDeleted: "deleted",
      };
      return page.records.flatMap((r): HistoryItem[] => {
        const event = events[r.eventType];
        if (!event) return [];
        const ep = r.episode;
        const title = r.movie
          ? `${r.movie.title}${r.movie.year ? ` (${r.movie.year})` : ""}`
          : r.series
            ? `${r.series.title}${ep ? ` · S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}` : ""}`
            : r.sourceTitle ?? "Unknown";
        const detail =
          event === "failed" ? r.data?.message ?? r.data?.reason
          : event === "grabbed" ? [r.data?.indexer && `from ${r.data.indexer}`, r.data?.downloadClient && `to ${r.data.downloadClient}`].filter(Boolean).join(" ") || undefined
          : r.sourceTitle;
        return [{
          id: `${cfg.id}-${r.id}`, serviceId: cfg.id, source: cfg.kind, title, event, at: r.date,
          sizeBytes: r.data?.size ? Number(r.data.size) || undefined : undefined,
          quality: r.quality?.quality?.name, detail,
        }];
      });
    },

    async seasons(arrId: number): Promise<SeasonInfo[]> {
      const series = await api<{ seasons?: { seasonNumber: number; monitored: boolean; statistics?: { episodeFileCount: number; totalEpisodeCount: number } }[] }>(`/series/${arrId}`);
      return (series.seasons ?? [])
        .map((s) => ({ season: s.seasonNumber, have: s.statistics?.episodeFileCount ?? 0, total: s.statistics?.totalEpisodeCount ?? 0, monitored: s.monitored }))
        .sort((a, b) => a.season - b.season);
    },

    // Same as the "interactive search" in Radarr/Sonarr: ask every indexer, let the person choose.
    async releases(arrId: number, opts: { season?: number; episodeId?: number }): Promise<ReleaseInfo[]> {
      let path: string;
      if (cfg.kind === "radarr") path = `/release?movieId=${arrId}`;
      else if (opts.episodeId !== undefined) path = `/release?episodeId=${opts.episodeId}`;
      else if (opts.season === undefined) throw new ServiceError("Pick a season to search");
      else path = `/release?seriesId=${arrId}&seasonNumber=${opts.season}`;
      const list = await getJson<ArrRelease[]>(joinUrl(cfg.url, `/api/v3${path}`), { "X-Api-Key": cfg.apiKey }, RELEASE_TIMEOUT_MS);
      return list.slice(0, 200).map((r) => ({
        guid: r.guid,
        indexerId: r.indexerId,
        title: r.title,
        indexer: r.indexer,
        protocol: r.protocol,
        sizeBytes: r.size,
        ageDays: r.age ?? (r.ageHours !== undefined ? r.ageHours / 24 : undefined),
        seeders: r.seeders,
        leechers: r.leechers,
        quality: r.quality?.quality?.name,
        languages: r.languages?.map((l) => l.name),
        releaseGroup: r.releaseGroup,
        detail: r.fullSeason ? "Season pack" : r.seasonNumber !== undefined && r.episodeNumbers?.length
          ? `S${String(r.seasonNumber).padStart(2, "0")}E${r.episodeNumbers.map((n) => String(n).padStart(2, "0")).join("-E")}`
          : undefined,
        approved: r.approved ?? !r.rejected,
        rejections: r.rejections ?? [],
        customFormatScore: r.customFormatScore,
      }));
    },

    async grab(release: { guid: string; indexerId: number }): Promise<void> {
      await postJson(joinUrl(cfg.url, "/api/v3/release"), { guid: release.guid, indexerId: release.indexerId }, { "X-Api-Key": cfg.apiKey });
    },

    // Radarr takes all movie ids in one command; Sonarr searches one series per command.
    async searchDownloads(arrIds: number[], opts: { monitor: boolean }): Promise<void> {
      const headers = { "X-Api-Key": cfg.apiKey };
      const url = (path: string) => joinUrl(cfg.url, `/api/v3${path}`);
      if (cfg.kind === "radarr") {
        if (opts.monitor) {
          // A search on an unmonitored movie would be ignored, so switch monitoring on first.
          for (const id of arrIds) {
            const movie = await api<RadarrMovie>(`/movie/${id}`);
            if (!movie.monitored) await putJson(url(`/movie/${id}`), { ...movie, monitored: true }, headers);
          }
        }
        await postJson(url("/command"), { name: "MoviesSearch", movieIds: arrIds }, headers);
        return;
      }
      for (const seriesId of arrIds) {
        await postJson(url("/command"), { name: "SeriesSearch", seriesId }, headers);
      }
    },

    // Delete files from disk so they can be fetched again (for example a wrong-language release).
    // With "blocklist" the release that was imported is marked failed first, so the same one isn't grabbed again.
    async deleteFiles(arrId: number, fileIds: number[], opts: { blocklist: boolean; episodeIds: number[] }): Promise<void> {
      const headers = { "X-Api-Key": cfg.apiKey };
      const url = (path: string) => joinUrl(cfg.url, `/api/v3${path}`);
      const toBlocklist: { id: number }[] = [];
      if (opts.blocklist) {
        interface Rec { id: number; date: string }
        const subjects = cfg.kind === "radarr" ? [arrId] : opts.episodeIds;
        for (const s of subjects) {
          try {
            const history = cfg.kind === "radarr"
              ? await api<Rec[]>(`/history/movie?movieId=${s}&eventType=1`)
              : await api<Rec[]>(`/history/series?seriesId=${arrId}&episodeId=${s}&eventType=1`);
            const latest = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
            if (latest) toBlocklist.push({ id: latest.id });
          } catch { /* no history for it: nothing to blocklist */ }
        }
      }
      for (const id of fileIds) {
        await fetchChecked(url(`/${cfg.kind === "radarr" ? "moviefile" : "episodefile"}/${id}`), { method: "DELETE", headers });
      }
      for (const h of toBlocklist) {
        try { await postJson(url(`/history/failed/${h.id}`), {}, headers); } catch { /* best effort */ }
      }
    },

    // Rename: the manager works out the new names and renames the files itself.
    async renamePreview(arrId: number): Promise<RenameChange[]> {
      if (cfg.kind === "radarr") {
        const list = await api<{ movieFileId: number; existingPath: string; newPath: string }[]>(`/rename?movieId=${arrId}`);
        return list.map((r) => ({ fileId: r.movieFileId, existingPath: r.existingPath, newPath: r.newPath }));
      }
      const list = await api<{ episodeFileId: number; existingPath: string; newPath: string }[]>(`/rename?seriesId=${arrId}`);
      return list.map((r) => ({ fileId: r.episodeFileId, existingPath: r.existingPath, newPath: r.newPath }));
    },

    // Give the title's folder a new name: the manager moves everything into it and updates its records.
    async renameFolder(arrId: number, name: string): Promise<void> {
      const kind = cfg.kind === "radarr" ? "movie" : "series";
      const current = await api<{ path: string } & Record<string, unknown>>(`/${kind}/${arrId}`);
      const cut = Math.max(current.path.lastIndexOf("/"), current.path.lastIndexOf("\\"));
      if (cut < 0) throw new ServiceError("Couldn't work out the folder this title is in");
      const path = `${current.path.slice(0, cut + 1)}${name}`;
      if (path === current.path) throw new ServiceError("That is already the folder's name");
      await putJson(joinUrl(cfg.url, `/api/v3/${kind}/${arrId}?moveFiles=true`), { ...current, path }, { "X-Api-Key": cfg.apiKey });
    },

    // Sonarr only: files that landed in the wrong season (or off by some episodes) are re-assigned with Sonarr's
    // own manual import, which moves and renames them to match.
    async renumber(arrId: number, opts: { fromSeason: number; toSeason: number; offset: number }, apply: boolean): Promise<RenumberRow[]> {
      if (cfg.kind !== "sonarr") throw new ServiceError("Renumbering is for shows");
      interface Ep {
        id: number; seasonNumber: number; episodeNumber: number; title?: string; hasFile: boolean; episodeFileId?: number;
        episodeFile?: { id: number; path: string; relativePath?: string; releaseGroup?: string; quality?: unknown; languages?: unknown };
      }
      const eps = await api<Ep[]>(`/episode?seriesId=${arrId}&includeEpisodeFile=true`);
      const label = (s: number, e: number) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
      const rows: RenumberRow[] = [];
      const moves: Record<string, unknown>[] = [];
      for (const src of eps.filter((e) => e.seasonNumber === opts.fromSeason && e.hasFile && e.episodeFile)) {
        const file = src.episodeFile!;
        const target = eps.find((e) => e.seasonNumber === opts.toSeason && e.episodeNumber === src.episodeNumber + opts.offset);
        const row: RenumberRow = {
          fileName: file.relativePath?.split("/").pop() ?? file.path.split(/[\\/]/).pop() ?? file.path,
          from: label(src.seasonNumber, src.episodeNumber),
          status: "ok",
        };
        if (!target) row.status = "no-target";
        else {
          row.to = label(target.seasonNumber, target.episodeNumber);
          row.title = target.title;
          if (target.hasFile) row.status = "occupied";
          else moves.push({
            path: file.path, seriesId: arrId, episodeIds: [target.id], episodeFileId: file.id,
            quality: file.quality, languages: file.languages, releaseGroup: file.releaseGroup, downloadId: "",
          });
        }
        rows.push(row);
      }
      if (apply && moves.length) {
        await postJson(joinUrl(cfg.url, "/api/v3/command"), { name: "ManualImport", importMode: "move", files: moves }, { "X-Api-Key": cfg.apiKey });
      }
      return rows;
    },

    async renameApply(arrId: number, fileIds: number[]): Promise<void> {
      await postJson(
        joinUrl(cfg.url, "/api/v3/command"),
        cfg.kind === "radarr" ? { name: "RenameFiles", movieId: arrId, files: fileIds } : { name: "RenameFiles", seriesId: arrId, files: fileIds },
        { "X-Api-Key": cfg.apiKey },
      );
    },

    // Moving to another root folder: the manager moves the files and updates its own records.
    async moveTo(arrId: number, rootFolderPath: string): Promise<void> {
      const body = cfg.kind === "radarr"
        ? { movieIds: [arrId], rootFolderPath, moveFiles: true }
        : { seriesIds: [arrId], rootFolderPath, moveFiles: true };
      await putJson(joinUrl(cfg.url, `/api/v3/${cfg.kind === "radarr" ? "movie" : "series"}/editor`), body, { "X-Api-Key": cfg.apiKey });
    },

    async rescan(arrId: number): Promise<void> {
      await postJson(
        joinUrl(cfg.url, "/api/v3/command"),
        cfg.kind === "radarr" ? { name: "RescanMovie", movieId: arrId } : { name: "RescanSeries", seriesId: arrId },
        { "X-Api-Key": cfg.apiKey },
      );
    },

    async removeTitle(arrId: number, opts: { deleteFiles: boolean; exclude: boolean }): Promise<void> {
      const flag = cfg.kind === "radarr" ? "addImportExclusion" : "addImportListExclusion";
      await fetchChecked(
        joinUrl(cfg.url, `/api/v3/${cfg.kind === "radarr" ? "movie" : "series"}/${arrId}?deleteFiles=${opts.deleteFiles}&${flag}=${opts.exclude}`),
        { method: "DELETE", headers: { "X-Api-Key": cfg.apiKey } },
        60_000,
      );
    },

    // What the manager is doing in the background right now (and just finished): imports, moves, renames, rescans.
    async tasks(): Promise<ManagerTask[]> {
      interface Cmd { id: number; name: string; commandName?: string; status: string; message?: string; started?: string; ended?: string; duration?: string }
      const wanted: Record<string, string> = {
        DownloadedMoviesScan: "Importing a finished download", DownloadedEpisodesScan: "Importing a finished download",
        MoveMovie: "Moving files", MoveSeries: "Moving files", RenameFiles: "Renaming files", RenameMovie: "Renaming files", RenameSeries: "Renaming files",
        RescanMovie: "Rescanning files", RescanSeries: "Rescanning files", ManualImport: "Importing files",
      };
      const cutoff = Date.now() - 15 * 60_000;
      // Automatic imports of finished downloads happen inside the queue, not as commands, so read them from there.
      const importing: ManagerTask[] = (await api<{ records: ArrQueueRecord[] }>("/queue?pageSize=200").catch(() => ({ records: [] as ArrQueueRecord[] }))).records
        .filter((r) => r.trackedDownloadState === "importing" || r.trackedDownloadState === "importPending")
        .map((r) => ({
          serviceId: cfg.id,
          id: 1_000_000_000 + r.id,
          name: r.trackedDownloadState === "importing" ? "Moving a finished download into the library" : "Finished download waiting to be imported",
          status: r.trackedDownloadState === "importing" ? "started" as const : "queued" as const,
          message: r.title,
        }));
      const commands = (await api<Cmd[]>("/command"))
        .filter((c) => wanted[c.name] && (c.status === "queued" || c.status === "started" || Date.parse(c.ended ?? "") > cutoff))
        .map((c) => ({
          serviceId: cfg.id,
          id: c.id,
          name: wanted[c.name],
          status: (["queued", "started", "completed", "failed"].includes(c.status) ? c.status : "failed") as ManagerTask["status"],
          message: c.message,
          startedAt: c.started,
          endedAt: c.ended,
        }))
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
      return [...importing, ...commands];
    },

    // Take a download out of the manager's queue; optionally also out of the download client (which deletes its files).
    async removeFromQueue(queueId: string, opts: { removeFromClient: boolean; blocklist: boolean }): Promise<void> {
      await fetchChecked(
        joinUrl(cfg.url, `/api/v3/queue/${queueId}?removeFromClient=${opts.removeFromClient}&blocklist=${opts.blocklist}&skipRedownload=${!opts.blocklist}`),
        { method: "DELETE", headers: { "X-Api-Key": cfg.apiKey } },
      );
    },

    // Folders as the manager itself sees them, so the right path can be picked without typing it.
    async browseFolders(path: string) {
      const r = await api<{ parent?: string | null; directories?: { name: string; path: string }[] }>(`/filesystem?path=${encodeURIComponent(path)}&includeFiles=false`);
      return { path, parent: r.parent || undefined, directories: (r.directories ?? []).map((d) => ({ name: d.name, path: d.path })) };
    },

    // What the manager makes of the files in a folder (its "manual import" scan).
    async scanFolder(path: string): Promise<ImportCandidate[]> {
      return (await manualScan(path)).map(({ candidate }) => candidate);
    },

    async importFiles(folder: string, paths: string[], mode: "move" | "copy"): Promise<number> {
      const wanted = new Set(paths);
      const files = (await manualScan(folder)).filter(({ candidate, file }) => wanted.has(candidate.path) && file).map(({ file }) => file!);
      if (files.length === 0) throw new ServiceError("None of those files can be imported (they may have moved, or the manager can't match them to a title)");
      await postJson(joinUrl(cfg.url, "/api/v3/command"), { name: "ManualImport", importMode: mode, files }, { "X-Api-Key": cfg.apiKey });
      return files.length;
    },

    // Finished downloads the manager could not import, with the client's idea of where they are.
    async importIssues(): Promise<ImportIssue[]> {
      const page = await api<{ records: ArrQueueRecord[] }>("/queue?pageSize=200");
      const stuck = page.records.filter((r) => ["importPending", "importBlocked", "importFailed"].includes(r.trackedDownloadState ?? ""));
      if (stuck.length === 0) return [];
      const hosts = new Map<string, string>();
      try {
        const clients = await api<{ name: string; fields?: { name: string; value?: unknown }[] }[]>("/downloadclient");
        for (const c of clients) {
          const host = c.fields?.find((f) => f.name === "host")?.value;
          if (typeof host === "string") hosts.set(c.name, host);
        }
      } catch { /* the host is only a suggestion for the path mapping form */ }
      return stuck.map((r) => ({
        serviceId: cfg.id,
        id: String(r.id),
        title: r.title,
        state: r.trackedDownloadState ?? "importPending",
        messages: r.statusMessages?.flatMap((m) => m.messages) ?? [],
        outputPath: r.outputPath,
        client: r.downloadClient,
        clientHost: r.downloadClient ? hosts.get(r.downloadClient) : undefined,
      }));
    },

    // Ask the manager to scan the finished download again; it does the renaming and moving itself.
    async retryImport(queueId: string): Promise<void> {
      const rec = await api<ArrQueueRecord & { downloadId?: string }>(`/queue/${queueId}`).catch(async () => {
        const page = await api<{ records: (ArrQueueRecord & { downloadId?: string })[] }>("/queue?pageSize=200");
        const found = page.records.find((r) => String(r.id) === queueId);
        if (!found) throw new ServiceError("That download is no longer in the queue");
        return found;
      });
      if (!rec.outputPath) throw new ServiceError("The download client did not report where the files are");
      await postJson(
        joinUrl(cfg.url, "/api/v3/command"),
        { name: cfg.kind === "radarr" ? "DownloadedMoviesScan" : "DownloadedEpisodesScan", path: rec.outputPath, downloadClientId: rec.downloadId },
        { "X-Api-Key": cfg.apiKey },
      );
    },

    async remotePaths(): Promise<RemotePathMapping[]> {
      return api<RemotePathMapping[]>("/remotepathmapping");
    },

    async addRemotePath(m: { host: string; remotePath: string; localPath: string }): Promise<void> {
      await postJson(joinUrl(cfg.url, "/api/v3/remotepathmapping"), m, { "X-Api-Key": cfg.apiKey });
    },

    // The *arr queue mirrors what the download clients hold; it is surfaced mainly
    // for import problems (a "warning" tracked status) that the clients cannot see.
    async queue(): Promise<QueueItem[]> {
      const page = await api<{ records: ArrQueueRecord[] }>("/queue?pageSize=200");
      return page.records.map((r) => ({
        serviceId: cfg.id,
        client: cfg.kind,
        id: String(r.id),
        name: r.title,
        status: importPhase(r.trackedDownloadState) ?? r.status,
        progress: r.size ? 1 - r.sizeleft / r.size : 0,
        sizeBytes: r.size,
        etaSeconds: parseTimeleft(r.timeleft),
        category: r.downloadClient,
        warning:
          r.trackedDownloadStatus === "warning" || r.trackedDownloadStatus === "error"
            ? r.statusMessages?.flatMap((m) => m.messages).join("; ") || "Import needs attention"
            : undefined,
      }));
    },
  };
}

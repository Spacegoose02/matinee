// Mirrors server/src/services/types.ts.
export type ServiceKind =
  | "radarr" | "sonarr" | "sabnzbd" | "qbittorrent" | "deluge" | "shelfmark" | "plex" | "jellyfin" | "audiobookshelf" | "tmdb" | "readmeabook" | "mdblist" | "calibreweb";
export type CredentialField = "apiKey" | "username" | "password";
export type MediaType = "movie" | "series" | "book";

export interface ServiceConfig {
  id: string;
  kind: ServiceKind;
  name: string;
  url: string;
  apiKey: string;
  username: string;
  password: string;
  enabled: boolean;
}

export interface ServicesResponse {
  kinds: ServiceKind[];
  credentialFields: Record<ServiceKind, CredentialField[]>;
  services: ServiceConfig[];
}

export interface ServerEntry { serviceId: string; library: string; resolution?: string; videoCodec?: string; watch?: WatchState }

export interface MediaItem {
  key: string;
  type: MediaType;
  title: string;
  year?: number;
  ids: { tmdb?: string; tvdb?: string; imdb?: string };
  poster?: string;
  backdrop?: string;
  overview?: string;
  genres?: string[];
  runtimeMinutes?: number;
  rating?: number;
  certification?: string;
  studio?: string;
  author?: string;
  added?: string;
  /** Radarr/Sonarr tags. */
  tags?: string[];
  managed?: {
    serviceId: string; monitored: boolean; hasFile: boolean; quality?: string; sizeBytes: number;
    episodes?: { have: number; total: number }; path?: string; rootFolder?: string; arrId?: number; fileId?: number;
  };
  available: ServerEntry[];
  libraries: string[];
}

export interface Collection {
  needsSync?: boolean;
  name: string;
  services: { serviceId: string; count: number }[];
  poster?: string;
  memberKeys: string[];
}

export interface QueueItem {
  serviceId: string; client: ServiceKind; id: string; name: string; status: string; progress: number;
  sizeBytes?: number; etaSeconds?: number; speedBytes?: number; category?: string; warning?: string; controllable?: boolean;
}

export interface ExternalIds { tmdb?: string; tvdb?: string; imdb?: string }

/** A title found by Radarr/Sonarr lookup, whether or not it is in the library yet. */
export interface SearchResult {
  serviceId: string;
  type: "movie" | "series";
  title: string;
  year?: number;
  ids: ExternalIds;
  overview?: string;
  poster?: string;
  genres?: string[];
  rating?: number;
  runtimeMinutes?: number;
  certification?: string;
  studio?: string;
  status?: string;
  seasons?: number;
  inLibrary: boolean;
}

export type ListKind = "trending" | "popular" | "upcoming" | "now" | "top_rated";

export interface PodcastItem {
  added?: boolean;
  itunesId: string;
  title: string;
  artist: string;
  image?: string;
  summary?: string;
  genre?: string;
  url?: string;
}

export interface PodcastTarget {
  serviceId: string;
  serviceName: string;
  libraryId: string;
  libraryName: string;
  folderId: string;
  folderPath: string;
}

export interface TrendingItem {
  type: "movie" | "series";
  title: string;
  year?: number;
  releaseDate?: string;
  ids: ExternalIds;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
}

export interface EpisodeInfo {
  id: number;
  season: number;
  episode: number;
  title: string;
  airDate?: string;
  aired: boolean;
  monitored: boolean;
  hasFile: boolean;
  quality?: string;
  sizeBytes?: number;
  runtimeMinutes?: number;
  fileId?: number;
}

export type HistoryEvent = "grabbed" | "imported" | "failed" | "completed" | "deleted" | "requested";

export interface AudiobookResult {
  serviceId: string;
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
  durationMinutes?: number;
  releaseDate?: string;
  rating?: number;
  series?: string;
  availability: "available" | "requested" | "unknown";
}

export interface AudiobookRequestInfo {
  id: string;
  serviceId: string;
  title: string;
  author: string;
  narrator?: string;
  coverArtUrl?: string;
  series?: string;
  status: string;
  progress: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  type: "audiobook" | "ebook";
  requestedBy?: string;
}
export interface HistoryItem {
  id: string;
  serviceId: string;
  source: ServiceKind;
  title: string;
  event: HistoryEvent;
  at: string;
  sizeBytes?: number;
  quality?: string;
  detail?: string;
}

export interface StorageRow {
  serviceId: string;
  serviceName: string;
  kind: ServiceKind;
  path: string;
  reportedFreeBytes?: number;
  mappedPath?: string;
  freeBytes?: number;
  totalBytes?: number;
  problem?: string;
}
export interface StorageResponse {
  rows: StorageRow[];
  errors: { serviceId: string; name: string; message: string }[];
  mediaDir: string;
  mediaMounted: boolean;
  /** Folders Matinee can see directly under the media mount. */
  mediaEntries: string[];
  mediaReadError?: string;
}
export interface DetectResult { serviceId: string; serviceName: string; path: string; localPath: string | null; hits: number; tried: number; samples: string[] }

export interface AddOptions {
  rootFolders: { path: string; freeBytes?: number; totalBytes?: number; freeSource?: "manager" | "mounted" }[];
  qualityProfiles: { id: number; name: string }[];
}

export interface AddPayload {
  title?: string;
  year?: number;
  serviceId: string;
  ids: ExternalIds;
  rootFolderPath: string;
  qualityProfileId: number;
  monitored: boolean;
  searchNow: boolean;
}

export interface ReleaseInfo {
  guid: string;
  indexerId: number;
  title: string;
  indexer?: string;
  protocol?: string;
  sizeBytes: number;
  ageDays?: number;
  seeders?: number;
  leechers?: number;
  quality?: string;
  languages?: string[];
  releaseGroup?: string;
  detail?: string;
  approved: boolean;
  rejections: string[];
  customFormatScore?: number;
}

export interface SeasonInfo { season: number; have: number; total: number; monitored: boolean }

export interface EnsureOp { name: string; memberKeys: string[]; serviceIds: string[]; mirror?: boolean }
export interface GroupPlan { sectionKey?: string; sectionName?: string; existing: boolean; add: number; remove: number; sampleAdd: string[] }
export interface ServicePlan { serviceId: string; serviceName: string; groups: GroupPlan[]; skipped: string[] }
export interface OpResult { name: string; plans: ServicePlan[]; errors: string[] }
export interface CollectionRule { tag: string; name: string; serviceIds: string[]; mirror: boolean; enabled: boolean }
export interface RulesResponse {
  rules: CollectionRule[];
  auto: boolean;
  tags: { tag: string; count: number }[];
  servers: { id: string; name: string; kind: string }[];
}

export interface ImportIssue {
  serviceId: string; id: string; title: string; state: string; messages: string[];
  outputPath?: string; client?: string; clientHost?: string;
}
export interface RemotePathMapping { id: number; serviceId: string; host: string; remotePath: string; localPath: string }
export interface TrailerRow { key: string; title: string; year?: number; type: MediaType; state: "have" | "missing" | "unmapped" | "readonly"; file?: string; sizeBytes?: number }
export interface TrailerJob { key: string; title: string; status: "queued" | "running" | "done" | "failed"; message?: string }
export interface TrailersResponse { ytDlp: string | null; mediaMounted: boolean; tmdb: boolean; items: TrailerRow[]; jobs: TrailerJob[] }
export interface RenameChange { fileId: number; existingPath: string; newPath: string }
export interface ManagerTask { serviceId: string; id: number; name: string; status: "queued" | "started" | "completed" | "failed"; message?: string; startedAt?: string; endedAt?: string }
export interface RenumberRow { fileName: string; from: string; to?: string; title?: string; status: "ok" | "no-target" | "occupied" }
export interface ImportCandidate { path: string; name: string; sizeBytes?: number; match?: string; rejections: string[] }
export interface TorrentInfo {
  serviceId: string; id: string; name: string; state: string; paused: boolean; seeding: boolean; progress: number; sizeBytes: number;
  ratio: number; downBytes: number; upBytes: number; savePath: string; category?: string; addedAt?: string;
}
export type DownloadAction = "pause" | "resume" | "remove" | "pause-all" | "resume-all" | "set-location";
export interface WatchState { state: "watched" | "unwatched" | "inprogress"; progress?: number; seen?: number; total?: number }
export interface ExternalList { id: string; name: string; items?: number; mediatype?: string; user?: string; description?: string }
export interface BookItem { id: string; title: string; author?: string; summary?: string; cover?: string; url?: string; year?: string; format?: string; size?: string; language?: string; inLibrary?: boolean; serviceId?: string }
export interface PodcastEpisode { key: string; title: string; publishedAt?: string; description?: string; downloaded: boolean; episodeId?: string }
export interface AuthUser { id: string; name: string; role: "admin" | "user" }
export interface AuthStatus { authEnabled: boolean; user: AuthUser | null; prefs: { theme: string | null } }
export interface UserSummary { id: string; name: string; role: "admin" | "user"; createdAt: string }
export interface ServiceError { serviceId: string; name: string; message: string }
export interface TestResult { ok: boolean; version?: string; message?: string }

export type SectionKind = "recent" | "library" | "collection" | "collections" | "downloading" | "attention" | "trending" | "list" | "audiobooks" | "podcasts" | "mdblist" | "ebooks";
export interface HomeSection {
  id: string;
  kind: SectionKind;
  /** recent: media type or "all"; library: library name; collection: collection name; trending: "movie" or "series". */
  ref?: string;
  visible: boolean;
}
export interface HomeSettings { sections: HomeSection[] | null; pinned: string[] }

export interface LibraryResponse { items: MediaItem[]; collections: Collection[]; errors: ServiceError[]; fetchedAt: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  // A lapsed session sends people back to the sign-in page (not for the sign-in call itself).
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("matinee-unauthorized"));
  if (!res.ok) throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  services: () => call<ServicesResponse>("/api/services"),
  createService: (s: Partial<ServiceConfig>) => call<ServiceConfig>("/api/services", json("POST", s)),
  updateService: (s: ServiceConfig) => call<ServiceConfig>(`/api/services/${s.id}`, json("PUT", s)),
  deleteService: (id: string) => call<{ ok: true }>(`/api/services/${id}`, { method: "DELETE" }),
  testService: (s: Partial<ServiceConfig>, force = false) =>
    call<TestResult>(`/api/services/test${force ? "?force=1" : ""}`, json("POST", s)),
  library: (refresh = false) => call<LibraryResponse>(`/api/library${refresh ? "?refresh=1" : ""}`),
  queue: () => call<{ items: QueueItem[]; errors: ServiceError[] }>("/api/queue"),
  search: (q: string) => call<{ items: SearchResult[]; errors: ServiceError[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  addOptions: (serviceId: string) => call<AddOptions>(`/api/add-options?s=${encodeURIComponent(serviceId)}`),
  add: (p: AddPayload) => call<{ ok: true; alreadyAdded?: boolean; key?: string }>("/api/add", json("POST", p)),
  searchDownloads: (serviceId: string, arrIds: number[], monitor = false) =>
    call<{ ok: true; count: number }>("/api/download-search", json("POST", { serviceId, arrIds, monitor })),
  item: (key: string) => call<MediaItem>(`/api/item?key=${encodeURIComponent(key)}`),
  seasons: (serviceId: string, arrId: number) => call<SeasonInfo[]>(`/api/seasons?s=${encodeURIComponent(serviceId)}&id=${arrId}`),
  releases: (serviceId: string, arrId: number, season?: number, episodeId?: number) =>
    call<ReleaseInfo[]>(
      `/api/releases?s=${encodeURIComponent(serviceId)}&id=${arrId}${season !== undefined ? `&season=${season}` : ""}${episodeId !== undefined ? `&episode=${episodeId}` : ""}`,
    ),
  mdblistLists: (q: { scope?: "mine" | "top" | "search"; q?: string; url?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    return call<{ configured: boolean; lists: ExternalList[] }>(`/api/mdblist/lists?${p}`);
  },
  searchBooks: (q: string) =>
    call<{ calibre: boolean; shelfmark: boolean; library: BookItem[]; download: BookItem[]; errors: ServiceError[] }>(`/api/books/search?q=${encodeURIComponent(q)}`),
  requestBook: (serviceId: string, id: string) => call<{ ok: true }>("/api/books/request", json("POST", { serviceId, id })),
  recentBooks: () => call<{ configured: boolean; items: BookItem[] }>("/api/calibre/recent"),
  mdblistItems: (id: string, full = false, offset = 0) =>
    call<{ configured: boolean; items: TrendingItem[]; hasMore?: boolean }>(`/api/mdblist/items?id=${encodeURIComponent(id)}${full ? `&full=1&offset=${offset}` : ""}`),
  trending: (type: "movie" | "series", list: ListKind = "trending", full = false, page = 1) =>
    call<{ configured: boolean; items: TrendingItem[]; hasMore?: boolean }>(`/api/trending?type=${type}&list=${list}${full ? `&full=1&page=${page}` : ""}`),
  audiobookList: (list: "popular" | "new") =>
    call<{ configured: boolean; items: AudiobookResult[]; message?: string }>(`/api/audiobook-lists?list=${list}`),
  topPodcasts: (genre: string) => call<{ items: PodcastItem[] }>(`/api/podcasts/top?genre=${encodeURIComponent(genre)}`),
  podcastTargets: () => call<{ items: PodcastTarget[]; errors: ServiceError[] }>("/api/podcasts/targets"),
  addPodcast: (p: { serviceId: string; libraryId: string; folderId: string; folderPath: string; itunesId: string; autoDownload: boolean; episodes?: string[] }) =>
    call<{ ok: true; title: string }>("/api/podcasts/add", json("POST", p)),
  podcastEpisodes: (serviceId: string, itunesId: string) =>
    call<{ itemId?: string; title: string; episodes: PodcastEpisode[] }>(`/api/podcasts/episodes?serviceId=${encodeURIComponent(serviceId)}&itunesId=${encodeURIComponent(itunesId)}`),
  downloadPodcastEpisodes: (serviceId: string, itunesId: string, keys: string[]) =>
    call<{ ok: true; count: number }>("/api/podcasts/download", json("POST", { serviceId, itunesId, keys })),
  deletePodcastEpisodes: (serviceId: string, itunesId: string, episodeIds: string[]) =>
    call<{ ok: true; count: number }>("/api/podcasts/delete-episodes", json("POST", { serviceId, itunesId, episodeIds })),
  episodes: (serviceId: string, arrId: number) => call<EpisodeInfo[]>(`/api/episodes?s=${encodeURIComponent(serviceId)}&id=${arrId}`),
  searchEpisodes: (serviceId: string, episodeIds: number[]) => call<{ ok: true }>("/api/episode-search", json("POST", { serviceId, episodeIds })),
  searchSeason: (serviceId: string, arrId: number, season: number) => call<{ ok: true }>("/api/season-search", json("POST", { serviceId, arrId, season })),
  setEpisodesMonitored: (serviceId: string, episodeIds: number[], monitored: boolean) =>
    call<{ ok: true }>("/api/episode-monitor", json("PUT", { serviceId, episodeIds, monitored })),
  importIssues: () => call<{ items: ImportIssue[]; mappings: RemotePathMapping[]; errors: ServiceError[] }>("/api/import-issues"),
  retryImport: (serviceId: string, ids: string[]) => call<{ ok: true; count: number }>("/api/import-retry", json("POST", { serviceId, ids })),
  torrents: () => call<{ items: TorrentInfo[]; errors: ServiceError[]; configured: boolean }>("/api/torrents"),
  controlDownload: (serviceId: string, action: DownloadAction, id?: string, opts: { deleteFiles?: boolean; path?: string } = {}) =>
    call<{ ok: true }>("/api/downloads/control", json("POST", { serviceId, id, action, ...opts })),
  removeImport: (serviceId: string, id: string, removeFromClient: boolean, blocklist: boolean) =>
    call<{ ok: true }>("/api/import-remove", json("POST", { serviceId, id, removeFromClient, blocklist })),
  browseFolders: (serviceId: string, path: string) =>
    call<{ path: string; parent?: string; directories: { name: string; path: string }[] }>(`/api/import-browse?serviceId=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(path)}`),
  scanFolder: (serviceId: string, path: string) => call<{ items: ImportCandidate[] }>(`/api/import-scan?serviceId=${encodeURIComponent(serviceId)}&path=${encodeURIComponent(path)}`),
  importFolder: (serviceId: string, folder: string, paths: string[], mode: "move" | "copy") =>
    call<{ ok: true; count: number }>("/api/import-folder", json("POST", { serviceId, folder, paths, mode })),
  addRemotePath: (p: { serviceId: string; host: string; remotePath: string; localPath: string }) => call<{ ok: true }>("/api/remote-path", json("POST", p)),
  trailerOnline: (q: { key?: string; type?: string; tmdb?: string; title?: string; year?: number }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
    return call<{ youtubeId: string | null }>(`/api/trailer-online?${p}`);
  },
  posterOptions: (key: string) => call<{ configured: boolean; items: { thumb: string; url: string; language?: string }[] }>(`/api/poster-options?key=${encodeURIComponent(key)}`),
  deleteFiles: (key: string, fileIds: number[], blocklist: boolean, search: boolean) =>
    call<{ ok: true; count: number }>("/api/manage/delete-files", json("POST", { key, fileIds, blocklist, search })),
  renamePreview: (key: string) => call<{ changes: RenameChange[] }>(`/api/manage/rename?key=${encodeURIComponent(key)}`),
  renameApply: (key: string, fileIds: number[]) => call<{ ok: true }>("/api/manage/rename", json("POST", { key, fileIds })),
  renameFolder: (key: string, name: string) => call<{ ok: true }>("/api/manage/rename-folder", json("POST", { key, name })),
  renumber: (key: string, fromSeason: number, toSeason: number, offset: number, apply: boolean) =>
    call<{ rows: RenumberRow[] }>("/api/manage/renumber", json("POST", { key, fromSeason, toSeason, offset, apply })),
  moveTitle: (key: string, rootFolder: string) => call<{ ok: true }>("/api/manage/move", json("POST", { key, rootFolder })),
  rescanTitle: (key: string) => call<{ ok: true }>("/api/manage/rescan", json("POST", { key })),
  removeTitle: (key: string, deleteFiles: boolean, exclude: boolean, confirm: string) =>
    call<{ ok: true }>("/api/manage/remove", json("POST", { key, deleteFiles, exclude, confirm })),
  activity: () => call<{ items: ManagerTask[]; errors: ServiceError[] }>("/api/activity"),
  authStatus: () => call<AuthStatus>("/api/auth/status"),
  login: (name: string, password: string) => call<{ user: AuthUser }>("/api/auth/login", json("POST", { name, password })),
  setupLogin: (name: string, password: string) => call<{ user: AuthUser }>("/api/auth/setup", json("POST", { name, password })),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  savePrefs: (prefs: { theme: string }) => call<{ ok: true }>("/api/auth/prefs", json("PUT", prefs)),
  users: () => call<{ users: UserSummary[] }>("/api/users"),
  addUser: (name: string, password: string, role: "admin" | "user") => call<{ user: AuthUser }>("/api/users", json("POST", { name, password, role })),
  setUserPassword: (id: string, password: string) => call<{ ok: true }>(`/api/users/${id}/password`, json("PUT", { password })),
  deleteUser: (id: string) => call<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  disableLogin: () => call<{ ok: true }>("/api/auth/disable", { method: "POST" }),
  trailers: (refresh = false) => call<TrailersResponse>(`/api/trailers${refresh ? "?refresh=1" : ""}`),
  trailerJobs: () => call<{ jobs: TrailerJob[] }>("/api/trailers/jobs"),
  downloadTrailers: (keys: string[], url?: string) => call<{ ok: true; queued: number }>("/api/trailers/download", json("POST", { keys, url })),
  history: () => call<{ items: HistoryItem[]; errors: ServiceError[] }>("/api/history"),
  audiobookSearch: (q: string) =>
    call<{ items: AudiobookResult[]; errors: ServiceError[]; configured: boolean }>(`/api/audiobook-search?q=${encodeURIComponent(q)}`),
  requestAudiobook: (serviceId: string, book: AudiobookResult) => {
    const { serviceId: _s, availability: _a, ...details } = book;
    return call<{ ok: true }>("/api/audiobook-request", json("POST", { serviceId, book: details }));
  },
  audiobookRequests: () => call<{ items: AudiobookRequestInfo[]; errors: ServiceError[]; configured: boolean }>("/api/audiobook-requests"),
  storage: () => call<StorageResponse>("/api/storage"),
  setMapping: (serviceId: string, path: string, localPath: string | null) =>
    call<{ ok: true }>("/api/storage/mapping", json("PUT", { serviceId, path, localPath })),
  detectStorage: () => call<{ results: DetectResult[]; mediaDir: string; mediaMounted: boolean; mediaEntries: string[]; mediaReadError?: string }>("/api/storage/detect", { method: "POST" }),
  grab: (serviceId: string, guid: string, indexerId: number) =>
    call<{ ok: true }>("/api/grab", json("POST", { serviceId, guid, indexerId })),
  collectionCover: (name: string, action: "send" | "copy", from?: string, to?: string) =>
    call<{ done: string[]; failed: string[] }>("/api/collections/cover", json("POST", { name, action, from, to })),
  fillCollectionCovers: () => call<{ filled: number; failed: string[] }>("/api/collections/cover-fill", json("POST", {})),
  collectionPosterFromUrl: (name: string, url: string) => call<{ poster: string }>("/api/poster", json("POST", { key: `collection:${name}`, url })),
  collectionPosterFromFile: (name: string, file: File) =>
    call<{ poster: string }>(`/api/poster?key=${encodeURIComponent(`collection:${name}`)}`, { method: "POST", headers: { "Content-Type": file.type }, body: file }),
  resetCollectionPoster: (name: string) => call<{ ok: true }>(`/api/poster?key=${encodeURIComponent(`collection:${name}`)}`, { method: "DELETE" }),
  runCollections: (body: { ops?: EnsureOp[]; sync?: string[]; tagRules?: boolean; dryRun?: boolean }) =>
    call<{ dryRun: boolean; results: OpResult[] }>("/api/collections/run", json("POST", body)),
  collectionRules: () => call<RulesResponse>("/api/collections/rules"),
  saveCollectionRules: (r: { rules: CollectionRule[]; auto: boolean }) => call<{ rules: CollectionRule[]; auto: boolean }>("/api/collections/rules", json("PUT", r)),
  home: () => call<HomeSettings>("/api/settings/home"),
  saveHome: (h: HomeSettings) => call<HomeSettings>("/api/settings/home", json("PUT", h)),
  posterFromUrl: (key: string, url: string) => call<{ poster: string }>("/api/poster", json("POST", { key, url })),
  posterFromFile: (key: string, file: File) =>
    call<{ poster: string }>(`/api/poster?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    }),
  pushPoster: (key: string) => call<{ done: string[]; failed: string[] }>("/api/poster/push", json("POST", { key })),
  resetPoster: (key: string) => call<{ ok: true }>(`/api/poster?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
};

export const KIND_LABELS: Record<ServiceKind, string> = {
  radarr: "Radarr", sonarr: "Sonarr", sabnzbd: "SABnzbd", qbittorrent: "qBittorrent", deluge: "Deluge",
  shelfmark: "Shelfmark", plex: "Plex", jellyfin: "Jellyfin", audiobookshelf: "Audiobookshelf", tmdb: "TMDB", readmeabook: "ReadMeABook", mdblist: "MDBList", calibreweb: "Calibre-Web",
};

export const DEFAULT_PORTS: Record<ServiceKind, number> = {
  radarr: 7878, sonarr: 8989, sabnzbd: 8080, qbittorrent: 8080, deluge: 8112, shelfmark: 8084,
  plex: 32400, jellyfin: 8096, audiobookshelf: 13378, tmdb: 443, readmeabook: 3030, mdblist: 443, calibreweb: 8083,
};

export const TYPE_LABELS: Record<MediaType, string> = { movie: "Movie", series: "Show", book: "Audiobook" };

export type Status = "available" | "on-disk" | "missing" | "unmanaged";

export const STATUS_LABELS: Record<Status, string> = {
  available: "On server",
  "on-disk": "Not on a server",
  missing: "Missing",
  unmanaged: "Not in Radarr/Sonarr",
};

export function statusOf(item: MediaItem): Status {
  if (!item.managed) return "unmanaged";
  if (item.available.length > 0) return "available";
  return item.managed.hasFile ? "on-disk" : "missing";
}

/** Watch progress for a title, combining every server that has it: watched anywhere counts as watched. */
export function watchOf(item: MediaItem): WatchState | undefined {
  const all = item.available.map((a) => a.watch).filter((w): w is WatchState => Boolean(w));
  if (all.length === 0) return undefined;
  if (all.some((w) => w.state === "watched")) return { state: "watched", progress: 1 };
  const partial = all.filter((w) => w.state === "inprogress").sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];
  return partial ?? { state: "unwatched" };
}

export const WATCH_LABELS = { watched: "Watched", inprogress: "In progress", unwatched: "Not watched" } as const;

export function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

export function formatEta(seconds?: number): string {
  if (seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(seconds % 60)}s`;
}

export function formatRuntime(minutes?: number): string | undefined {
  if (!minutes) return undefined;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

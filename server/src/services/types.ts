export const SERVICE_KINDS = [
  "radarr", "sonarr", "sabnzbd", "qbittorrent", "deluge", "shelfmark", "plex", "jellyfin", "audiobookshelf", "tmdb", "readmeabook", "mdblist", "calibreweb",
] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

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

export type MediaType = "movie" | "series" | "book";

/** External IDs used to match the same title across Radarr/Sonarr and Plex/Jellyfin. */
export interface ExternalIds {
  tmdb?: string;
  tvdb?: string;
  imdb?: string;
}

/** What a manager (Radarr/Sonarr) knows about a title. */
export interface ManagedEntry {
  serviceId: string;
  monitored: boolean;
  hasFile: boolean;
  quality?: string;
  sizeBytes: number;
  /** Sonarr only: episodes on disk / episodes expected. */
  episodes?: { have: number; total: number };
  path?: string;
  /** The manager's own id for this title (Radarr movie id / Sonarr series id), needed for commands. */
  arrId?: number;
  /** Radarr only: the id of the movie's file on disk, needed to delete it. */
  fileId?: number;
  /** Parent folder of `path`, e.g. "Kids Movies" for /movies/Kids Movies/Frozen (2013). */
  rootFolder?: string;
}

/** What a media server (Plex, Jellyfin, Audiobookshelf) has available. */
/** How far someone has got with a title on a media server. */
export interface WatchState {
  state: "watched" | "unwatched" | "inprogress";
  /** 0..1 through a movie, or the share of a show's episodes watched. */
  progress?: number;
  seen?: number;
  total?: number;
}

export interface ServerEntry {
  watch?: WatchState;
  serviceId: string;
  library: string;
  /** The server's own id for this title (Plex ratingKey, Jellyfin Id): needed to put it in a collection. */
  itemId?: string;
  /** Plex only: the library section the title lives in (a Plex collection belongs to exactly one section). */
  sectionKey?: string;
  resolution?: string;
  videoCodec?: string;
}

export interface MediaItem {
  /** Stable id for linking and pinning; filled in by the merge step. */
  key: string;
  type: MediaType;
  title: string;
  year?: number;
  ids: ExternalIds;
  poster?: string;
  backdrop?: string;
  overview?: string;
  genres?: string[];
  runtimeMinutes?: number;
  rating?: number; // 0..10
  certification?: string;
  studio?: string;
  author?: string;
  /** ISO date the title was added to the manager or server. */
  added?: string;
  managed?: ManagedEntry;
  /** Radarr/Sonarr tags, e.g. "marvel" or "christmas". */
  tags?: string[];
  /** One entry per media server (Plex, Jellyfin) that has the title. */
  available: ServerEntry[];
  /** Display names of every library/folder the title lives in; filled in by the merge step. */
  libraries: string[];
}

/** A server-side collection (Plex collection / Jellyfin box set). */
export interface RawCollection {
  serviceId: string;
  /** The server's own id for the collection. */
  id?: string;
  /** Plex only: the library section this collection belongs to. */
  sectionKey?: string;
  name: string;
  poster?: string;
  members: RawItem[];
}

/** An ebook in Calibre-Web, as shown on the Home page. */
export interface BookItem { id: string; title: string; author?: string; summary?: string; cover?: string; url?: string; year?: string; format?: string; size?: string; language?: string; inLibrary?: boolean }

/** A list kept on an outside site (MDBList), as a person can pick it for the Home page. */
export interface ExternalList { id: string; name: string; items?: number; mediatype?: string; user?: string; description?: string }

export interface QueueItem {
  serviceId: string;
  client: ServiceKind;
  id: string;
  name: string;
  status: string;
  progress: number; // 0..1
  sizeBytes?: number;
  etaSeconds?: number;
  speedBytes?: number;
  category?: string;
  warning?: string;
  /** What can be done to it from here (SABnzbd and qBittorrent only). */
  controllable?: boolean;
}

/** A torrent in the client, finished or not (the queue only lists unfinished ones). */
export interface TorrentInfo {
  serviceId: string;
  id: string;
  name: string;
  state: string;
  paused: boolean;
  seeding: boolean;
  progress: number;
  sizeBytes: number;
  ratio: number;
  downBytes: number;
  upBytes: number;
  savePath: string;
  category?: string;
  addedAt?: string;
}

export type DownloadAction = "pause" | "resume" | "remove" | "pause-all" | "resume-all" | "set-location";

export interface TestResult {
  ok: boolean;
  version?: string;
  message?: string;
}

/** A title found by Radarr/Sonarr lookup (TMDB/TVDB), whether or not it is in the library yet. */
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
  /** Series only: "continuing" / "ended" and number of seasons. */
  status?: string;
  seasons?: number;
  inLibrary: boolean;
}

/** A podcast from a public chart. */
export interface PodcastItem {
  itunesId: string;
  title: string;
  artist: string;
  image?: string;
  summary?: string;
  genre?: string;
  /** Its Apple Podcasts page. */
  url?: string;
  /** Already added to Audiobookshelf through Matinee. */
  added?: boolean;
}

/** One episode in a podcast's feed, and whether Audiobookshelf already holds it. */
export interface PodcastEpisode { key: string; title: string; publishedAt?: string; description?: string; downloaded: boolean; episodeId?: string }

/** A podcast library folder in Audiobookshelf where a new show can be added. */
export interface PodcastTarget {
  serviceId: string;
  serviceName: string;
  libraryId: string;
  libraryName: string;
  folderId: string;
  folderPath: string;
}

/** The kinds of discovery list TMDB can provide. */
export type ListKind = "trending" | "popular" | "upcoming" | "now" | "top_rated";

/** A title as a media server knows it, for adding to or removing from one of its collections. */
export interface NativeMember {
  itemId: string;
  sectionKey?: string;
  type: MediaType;
}

/** A title from one of TMDB's discovery lists. */
export interface TrendingItem {
  type: "movie" | "series";
  title: string;
  year?: number;
  /** Full ISO date, so "coming soon" lists can show when something arrives. */
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
  /** Sonarr only: the id of this episode's file on disk, needed to delete it. */
  fileId?: number;
}

/** One line of download history, from a manager (grabbed/imported/failed) or a download client. */
export interface HistoryItem {
  id: string;
  serviceId: string;
  source: ServiceKind;
  title: string;
  event: "grabbed" | "imported" | "failed" | "completed" | "deleted" | "requested";
  at: string;
  sizeBytes?: number;
  quality?: string;
  detail?: string;
}

/** One file a rename would change. */
export interface RenameChange { fileId: number; existingPath: string; newPath: string }

/** One episode file a renumber would re-assign to a different episode. */
export interface RenumberRow {
  fileName: string;
  from: string;
  to?: string;
  title?: string;
  /** ok = will be moved; the others are skipped. */
  status: "ok" | "no-target" | "occupied";
}

/** A file found in a folder that could be imported into the library. */
export interface ImportCandidate { path: string; name: string; sizeBytes?: number; match?: string; rejections: string[] }

/** A background job in Radarr/Sonarr (rename, move, rescan, import). */
export interface ManagerTask {
  serviceId: string;
  id: number;
  name: string;
  status: "queued" | "started" | "completed" | "failed";
  message?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
}

/** A finished download that Radarr/Sonarr could not import (usually a folder it cannot see or write). */
export interface ImportIssue {
  serviceId: string;
  id: string;
  title: string;
  state: string;
  messages: string[];
  /** Where the download client says the files are (as the client sees it). */
  outputPath?: string;
  client?: string;
  clientHost?: string;
}

export interface RemotePathMapping { id: number; host: string; remotePath: string; localPath: string }

/** An audiobook found by ReadMeABook's (Audible-backed) search. */
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
  progress: number; // 0..100
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  type: "audiobook" | "ebook";
  requestedBy?: string;
}

/** What a manager needs to be told when adding a title. */
export interface AddOptions {
  rootFolders: { path: string; freeBytes?: number; totalBytes?: number; freeSource?: "manager" | "mounted" }[];
  qualityProfiles: { id: number; name: string }[];
}

export interface AddRequest {
  ids: ExternalIds;
  rootFolderPath: string;
  qualityProfileId: number;
  monitored: boolean;
  /** Start looking for a release immediately instead of waiting for the next scheduled search. */
  searchNow: boolean;
}

/** One release an indexer offered for a title (Radarr/Sonarr "interactive search"). */
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
  /** "Season pack", "S02E05" and so on (Sonarr). */
  detail?: string;
  approved: boolean;
  rejections: string[];
  customFormatScore?: number;
}

export interface SeasonInfo { season: number; have: number; total: number; monitored: boolean }

export interface ServiceAdapter {
  /** `force` is an explicit user retry: it skips any back-off after earlier failures. */
  test(opts?: { force?: boolean }): Promise<TestResult>;
  library?(): Promise<RawItem[]>;
  collections?(): Promise<RawCollection[]>;
  queue?(): Promise<QueueItem[]>;
  search?(term: string): Promise<SearchResult[]>;
  addOptions?(): Promise<AddOptions>;
  add?(req: AddRequest): Promise<void>;
  /** Ask the manager to look for releases of titles it already has. */
  releases?(arrId: number, opts: { season?: number; episodeId?: number }): Promise<ReleaseInfo[]>;
  trending?(type: "movie" | "series", list?: ListKind, opts?: { pages?: number; page?: number }): Promise<TrendingItem[]>;
  /** Poster artwork choices for a title. */
  posterOptions?(type: "movie" | "series", tmdbId: string): Promise<{ thumb: string; url: string; language?: string }[]>;
  /** YouTube trailer address for a title, if the source knows one. */
  trailerUrl?(type: "movie" | "series", tmdbId: string | undefined, hint?: { title: string; year?: number }): Promise<string | undefined>;
  /** The current cover image of an item (a collection, for example) as the server holds it. */
  getPoster?(itemId: string): Promise<{ bytes: Buffer; contentType: string } | undefined>;
  /** Replace a title's poster on the server itself. */
  setPoster?(itemId: string, image: Buffer, contentType: string): Promise<void>;
  collectionCreate?(name: string, members: NativeMember[]): Promise<{ id: string }>;
  collectionAdd?(collectionId: string, members: NativeMember[]): Promise<void>;
  collectionRemove?(collectionId: string, members: NativeMember[]): Promise<void>;
  podcastTargets?(): Promise<PodcastTarget[]>;
  addPodcast?(req: { libraryId: string; folderId: string; folderPath: string; feedUrl: string; autoDownload: boolean; episodes?: string[] }): Promise<{ title: string }>;
  podcastEpisodes?(feedUrl: string): Promise<{ itemId?: string; title: string; episodes: PodcastEpisode[] }>;
  downloadPodcastEpisodes?(itemId: string, feedUrl: string, keys: string[]): Promise<number>;
  deletePodcastEpisodes?(itemId: string, episodeIds: string[]): Promise<void>;
  audiobookList?(list: "popular" | "new"): Promise<{ items: AudiobookResult[]; message?: string }>;
  episodes?(arrId: number): Promise<EpisodeInfo[]>;
  searchEpisodes?(episodeIds: number[]): Promise<void>;
  searchSeason?(arrId: number, season: number): Promise<void>;
  setEpisodesMonitored?(episodeIds: number[], monitored: boolean): Promise<void>;
  history?(): Promise<HistoryItem[]>;
  searchAudiobooks?(term: string): Promise<AudiobookResult[]>;
  requestAudiobook?(book: Omit<AudiobookResult, "serviceId" | "availability">): Promise<void>;
  audiobookRequests?(): Promise<AudiobookRequestInfo[]>;
  seasons?(arrId: number): Promise<SeasonInfo[]>;
  grab?(release: { guid: string; indexerId: number }): Promise<void>;
  renameFolder?(arrId: number, name: string): Promise<void>;
  renumber?(arrId: number, opts: { fromSeason: number; toSeason: number; offset: number }, apply: boolean): Promise<RenumberRow[]>;
  externalLists?(scope: "mine" | "top" | "search", query?: string): Promise<ExternalList[]>;
  resolveList?(user: string, slug: string): Promise<ExternalList | undefined>;
  externalListItems?(listId: string, limit?: number, offset?: number): Promise<{ items: TrendingItem[]; more: boolean }>;
  /** Poster, summary and rating for one title, by TMDB id. */
  details?(type: "movie" | "series", tmdbId: string): Promise<Pick<TrendingItem, "poster" | "backdrop" | "overview" | "rating" | "releaseDate" | "year"> | undefined>;
  recentBooks?(limit?: number): Promise<BookItem[]>;
  searchBooks?(term: string): Promise<BookItem[]>;
  requestBook?(id: string): Promise<void>;
  deleteFiles?(arrId: number, fileIds: number[], opts: { blocklist: boolean; episodeIds: number[] }): Promise<void>;
  renamePreview?(arrId: number): Promise<RenameChange[]>;
  renameApply?(arrId: number, fileIds: number[]): Promise<void>;
  moveTo?(arrId: number, rootFolderPath: string): Promise<void>;
  rescan?(arrId: number): Promise<void>;
  removeTitle?(arrId: number, opts: { deleteFiles: boolean; exclude: boolean }): Promise<void>;
  tasks?(): Promise<ManagerTask[]>;
  control?(id: string, action: DownloadAction, opts?: { deleteFiles?: boolean; path?: string }): Promise<void>;
  torrents?(): Promise<TorrentInfo[]>;
  removeFromQueue?(queueId: string, opts: { removeFromClient: boolean; blocklist: boolean }): Promise<void>;
  browseFolders?(path: string): Promise<{ path: string; parent?: string; directories: { name: string; path: string }[] }>;
  scanFolder?(path: string): Promise<ImportCandidate[]>;
  importFiles?(folder: string, paths: string[], mode: "move" | "copy"): Promise<number>;
  importIssues?(): Promise<ImportIssue[]>;
  retryImport?(queueId: string): Promise<void>;
  remotePaths?(): Promise<RemotePathMapping[]>;
  addRemotePath?(m: { host: string; remotePath: string; localPath: string }): Promise<void>;
  searchDownloads?(arrIds: number[], opts: { monitor: boolean }): Promise<void>;
}

/** An item as an adapter produces it, before the merge step assigns key/libraries. */
export type RawItem = Omit<MediaItem, "key" | "libraries">;

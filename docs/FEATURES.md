<!-- brand:start -->
<p align="center"><a href="../README.md"><img src="../brand/logo.svg" alt="Matinee" height="56"></a></p>

<p align="center"><a href="../README.md">Home</a> · <a href="HANDOVER.md">Handover</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="DEVELOPMENT.md">Development</a> · <a href="EXTENDING.md">Extending</a> · <a href="FEATURES.md">Features</a> · <a href="SERVICES.md">Services</a> · <a href="API.md">API</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="OPERATIONS.md">Operations</a></p>

---
<!-- brand:end -->

# Feature map

For each feature: where it appears in the UI, the web files, the server routes, the server modules/adapters, and the
external calls behind it. Use it to jump from "this button is broken" to the code. Paths are relative to `web/src`
(UI) and `server/src` (server). Routes are listed in full in [API.md](API.md).

| Feature | UI | Routes | Server code | Notes |
| --- | --- | --- | --- | --- |
| **Library merge** | `pages/Library.tsx`, `store.tsx`, `components/Cards.tsx` | `GET /api/library`, `/api/item` | `library.ts`, `index.ts` (cache), adapters' `library()` | Merge by TMDB/TVDB/IMDb id; slim list + full item |
| **Home** | `pages/Home.tsx`, `components/Shelf.tsx`, `Hero.tsx` | `GET/PUT /api/settings/home` | `index.ts` (`homeFor`) | Sections are data, per user |
| **Top-bar search** | `components/SearchBox.tsx` | `GET /api/search` | `services/arr.ts` `search()` | Library hits plus lookup for titles you could add |
| **Discover / add** | `pages/Discover.tsx`, `components/AddModal.tsx` | `/api/search`, `/api/add-options`, `POST /api/add` | `services/arr.ts` | 180 s add timeout; "already added" is a result, not an error |
| **Trending and list shelves** | `components/Trending.tsx`, `lists.ts` | `GET /api/trending` | `services/tmdb.ts` | `full=1&page=N` for the whole list page |
| **See all list page** | `pages/ListPage.tsx` | `/api/trending`, `/api/mdblist/items` | same | Route `#/list/tmdb:<kind>:<type>` or `#/list/mdb:<id>:<name>` |
| **MDBList on Home** | `pages/Home.tsx`, `components/Trending.tsx` | `/api/mdblist/lists`, `/api/mdblist/items` | `services/mdblist.ts` | Posters borrowed from TMDB `details()` |
| **Details drawer** | `components/Details.tsx` | `/api/item` | `index.ts` | Hosts Manage, Trailer, Poster, Episodes |
| **Poster change and send** | `Details.tsx` (`PosterEditor`) | `POST/DELETE /api/poster`, `/api/poster/push`, `/api/poster-options` | `index.ts`, adapters' `setPoster()`; `tmdb.ts` `posterOptions()` | Overrides stored in `posters/` + setting `posters` |
| **Watch status** | `Cards.tsx`, `Details.tsx`, `pages/Library.tsx` | in `/api/library` | `plex.ts`/`jellyfin.ts` `watchOf()` | `ServerEntry.watch`; aggregate `watchOf()` in `api.ts` |
| **Manage media** | `components/Manage.tsx` | `/api/manage/*` | `services/arr.ts` | Rename, folder rename, move, rescan, renumber, delete files, remove |
| **Episodes** | `components/EpisodeList.tsx`, `ReleasesModal.tsx` | `/api/episodes`, `/api/episode-search`, `/api/season-search`, `/api/episode-monitor`, `/api/seasons`, `/api/releases`, `/api/grab` | `arr.ts` | Per-episode delete and bulk seasons call `/api/manage/delete-files` |
| **Trailers** | `components/Trailers.tsx` (page, per-title section, player) | `/api/trailers*`, `/api/trailer-file`, `/api/trailer-online` | `trailers.ts`, `index.ts`, `tmdb.ts` `trailerUrl()` | Needs `/media` rw and path mapping |
| **Downloads: Active** | `pages/Downloads.tsx`, `components/Activity.tsx`, `DownloadControls.tsx` | `/api/queue`, `/api/downloads/control`, `/api/activity` | `sabnzbd.ts`, `qbittorrent.ts`, `arr.ts` `tasks()` | Sidebar badge counts non-manager queue items |
| **Torrents tab** | `DownloadControls.tsx` (`Torrents`) | `GET /api/torrents`, control route | `qbittorrent.ts` | Includes seeding torrents |
| **Stuck imports** | `components/StuckImports.tsx` | `/api/import-*`, `/api/remote-path` | `arr.ts` | Retry, remove, path mapping, import from folder |
| **History** | `pages/Downloads.tsx` (`History`) | `GET /api/history` | adapters' `history()` | Merged and sorted |
| **Storage / free space** | `pages/StorageSettings.tsx` | `/api/storage*` | `storage.ts`, `index.ts` | Mapping key is `serviceId|rootFolderPath` |
| **Collections** | `pages/Collections.tsx`, `CollectionBuilder.tsx`, `PlanView.tsx`, `TagRules.tsx` | `/api/collections/*` | `collections.ts`, `library.ts` `mergeCollections()` | Dry-run first; never deletes a collection |
| **Collection covers** | `components/CollectionCover.tsx` | `/api/collections/cover`, `cover-fill`, poster routes | `index.ts`, adapters' `getPoster()`/`setPoster()` | Override key `collection:<name>` |
| **Podcasts** | `components/PodcastShelf.tsx`, `EpisodePicker.tsx` | `/api/podcasts/*` | `podcasts.ts`, `audiobookshelf.ts` | Apple chart + ABS add/episodes |
| **Audiobook requests** | `components/AudiobookResults.tsx`, `AudiobookRequests.tsx` | `/api/audiobook-*` | `readmeabook.ts` | Needs an `rmab_` token |
| **Books page / Home row** | `pages/Ebooks.tsx`, `components/BookShelf.tsx` | `/api/books/*`, `/api/calibre/recent` | `calibreweb.ts`, `shelfmark.ts` | OPDS + Shelfmark direct download |
| **Sign-in and users** | `auth.tsx`, `components/UsersSettings.tsx` | `/api/auth/*`, `/api/users*` | `auth.ts`, `db.ts` | Optional; first account is admin |
| **Services settings** | `pages/Settings.tsx` | `/api/services*` | `index.ts` (`fromBody`), `db.ts` | Secrets masked and round-tripped |
| **Themes** | `themes.ts`, `styles.css`, `Settings.tsx` | `PUT /api/auth/prefs` (saved per user) | `auth.ts` | Applied before first paint in `main.tsx` |
| **Image proxy** | all posters | `GET /api/image?s=&p=` | `index.ts` | Adds auth headers, resizes upstream, disk cache |

## Frequently touched constants

| Constant | File | Meaning |
| --- | --- | --- |
| `MANAGERS_TTL_MS` / `SERVERS_TTL_MS` | `index.ts` | Library refresh intervals (2 min / 15 min) |
| `CACHE_VERSION` | `index.ts` | Bump when the raw item shape changes |
| `ADD_TIMEOUT_MS` / `RELEASE_TIMEOUT_MS` | `services/arr.ts` | Slow Radarr/Sonarr calls |
| `PAGE_SIZE`, `WRITE_BATCH`, `COLLECTION_CONCURRENCY` | `services/plex.ts` | Plex paging and write sizes |
| `WRITE_BATCH` | `services/jellyfin.ts` | Jellyfin collection write batch (100) |
| `BACKOFF_MS` | `services/qbittorrent.ts` | Login back-off after a rejection (10 min) |
| `ADMIN_ANY` / `ADMIN_WRITE` | `auth.ts` | Which routes need an administrator |
| `MAX_FAILS` / `LOCK_MS` | `auth.ts` | Login lockout (6 tries, 15 min) |
| `MDB_PAGE` | `index.ts` | MDBList page size for "see all" (100) |
| Trailer limits (`1080`, `600M`, `duration<600`) | `trailers.ts` | yt-dlp format and size rules |

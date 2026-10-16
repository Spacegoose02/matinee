# Services and integrations

For every service: what Matinee uses it for, which credentials it needs, the exact endpoints called, known quirks, and
how well each call has been verified (see the legend in [HANDOVER.md](HANDOVER.md)). Files are in `server/src/services/`.

General rules: URLs are the address you open in a browser (no trailing path). Secrets are masked in the UI. The
*Test* button calls the adapter's `test()`. HTTP helpers apply timeouts (default 20 s; long calls pass their own).

---

## Radarr and Sonarr (`arr.ts`, one adapter for both)

- **Credentials:** API key (Settings → General).
- **Used for:** library (movies, series with tags and file ids), add, search, interactive release search and grab,
  episodes, history, queue, stuck imports, rename, move, rescan, delete, renumber, delete files, manual import.
- **Endpoints (API v3, header `X-Api-Key`):**
  - Library: `GET /movie`, `GET /series`, `GET /tag`
  - Add: `GET /movie/lookup`, `GET /series/lookup?term=tvdb:ID|tmdb:ID`, `POST /movie`, `POST /series`,
    `GET /rootfolder`, `GET /qualityprofile`
  - Search: `POST /command` (`MoviesSearch`, `SeriesSearch`, `EpisodeSearch`, `SeasonSearch`), `PUT /movie/:id`
  - Releases: `GET /release?movieId|episodeId|seriesId&seasonNumber`, `POST /release`
  - Episodes: `GET /episode?seriesId&includeEpisodeFile=true`, `PUT /episode/monitor`
  - History: `GET /history`, `GET /history/movie`, `GET /history/series`, `POST /history/failed/:id` (blocklist)
  - Queue: `GET /queue`, `DELETE /queue/:id?removeFromClient&blocklist`; import state from `trackedDownloadState`
  - Stuck-import helpers: `GET /downloadclient`, `GET|POST /remotepathmapping`, `GET /filesystem`,
    `GET /manualimport?folder=`, `POST /command` `ManualImport`, `DownloadedMoviesScan`/`DownloadedEpisodesScan`
  - Manage: `GET /rename`, `POST /command` `RenameFiles`, `PUT /movie|series/editor` (root folder + `moveFiles`),
    `PUT /movie|series/:id?moveFiles=true` (folder rename), `POST /command` `RescanMovie|RescanSeries`,
    `DELETE /movie|series/:id`, `DELETE /moviefile|episodefile/:id`
  - Activity: `GET /command` (rename/move/rescan/import jobs)
- **Quirks:**
  - Free space reported by the managers is often wrong on Unraid (unmapped share). Settings → Storage replaces it.
  - Sonarr accepts a TMDB lookup term, which is how trending titles are added.
  - Adds can take over a minute (folders, metadata); the add call allows 180 s and the UI treats "already added" as a
    normal result.
  - TMDB artwork arrives as `original`; the adapter rewrites URLs to `w342`/`w1280`.
  - Blocklisting can make the manager start its own search, so a "delete and search again" may search twice.
- **Verification:** library/queue/add/search/history live; everything under stuck imports, manage and delete is fake-only.

## SABnzbd (`sabnzbd.ts`)

- **Credentials:** API key.
- **Endpoints:** `GET /api?mode=version|queue|history&output=json&apikey=`; control: `mode=queue&name=pause|resume|delete&value=<nzo>`
  (`del_files=1`), `mode=pause`, `mode=resume`.
- **Quirk:** one overall speed is reported; the adapter attributes it to the first active slot.
- **Verification:** read endpoints live; control fake-only.

## qBittorrent (`qbittorrent.ts`)

- **Credentials:** Web UI username and password (empty if the client bypasses auth for your network).
- **Endpoints (`/api/v2`):** `POST /auth/login`, `GET /app/version`, `GET /torrents/info`, `POST /torrents/stop|pause`,
  `/start|resume`, `/delete`, `/setLocation`.
- **Quirks (important):**
  - Sends `Referer` and `Origin` headers (CSRF protection rejects requests without them).
  - Newer versions answer a successful login with **204 and no body**; older ones with `Ok.`.
  - **It bans an IP after a few failed logins.** The adapter backs off for 10 minutes after a rejection
    (cleared by pressing *Test*, which sends `force`). Do not remove this; the queue is polled every 3 s.
  - v5 renamed pause/resume to stop/start; the adapter tries the new name first and falls back on 404.
  - Many users call it "Deluge" because of a shared proxy; if a "Deluge" test returns `400 Bad Request`, it is qBittorrent.
- **Verification:** login, queue, history live; control fake-only.

## Deluge (`deluge.ts`)

Written for the Deluge Web UI JSON-RPC. **Never verified against a real instance.** Treat as unsupported until tested.

## Shelfmark (`shelfmark.ts`)

- **Credentials:** optional username/password (HTTP Basic). Shelfmark's own auth mode can be `none`.
- **Endpoints:**
  - `GET /api/status` (groups `queued/downloading/complete/error/...`): queue.
  - Search: `GET /api/releases?source=direct_download&query=...` returns `{ releases: [...] }`. Slow (10 to 40 s).
  - Download: `POST /api/releases/download` with the release record plus `content_type: "ebook"`.
- **Quirks:** cover URLs are relative (`/api/covers/...`) and are proxied through `/api/image`. Search results are
  remembered in memory for 30 minutes so *Download* only needs an id (the page never supplies the download URL).
  `/api/search` and `/request/api/search` do **not** exist in current versions (older docs mention them).
- **Verification:** status and search live; download copied from the app's own front end and never executed.

## Plex (`plex.ts`)

- **Credentials:** `X-Plex-Token`.
- **Endpoints:** `GET /library/sections`, `/library/sections/:id/all?includeGuids=1` (paged 250), `/library/sections/:id/collections`,
  `/library/collections/:id/children`, `/photo/:/transcode` (resized artwork).
  Collection writes: `POST /library/collections?type&title&smart=0&sectionId&uri=server://<machineId>/com.plexapp.plugins.library/library/metadata/<keys>`,
  `PUT /library/collections/:id/items?uri=`, `DELETE /library/collections/:id/items/:key`.
  Posters: `GET /library/metadata/:id/thumb`, `POST /library/metadata/:id/posters` (raw image body).
  Watch state: `viewCount`, `viewOffset`, `viewedLeafCount`, `leafCount` on library items.
- **Quirks:** collections are per **library section**; large libraries need paging and bounded concurrency
  (`COLLECTION_CONCURRENCY = 4`) or requests time out (timeout is 45 s with a clear message).
- **Verification:** reads live; writes fake-only.

## Jellyfin (`jellyfin.ts`)

- **Credentials:** API key (Dashboard → API Keys). Header `Authorization: MediaBrowser Token="..."`.
- **Endpoints:** `GET /Library/MediaFolders`, `/Items?ParentId&Recursive&IncludeItemTypes=Movie,Series&Fields=...&UserId=`,
  `/Users` (first administrator for watch state), box sets via `/Items?IncludeItemTypes=BoxSet`; writes:
  `POST /Collections?Name&Ids`, `POST|DELETE /Collections/:id/Items?Ids`, `GET /Items/:id/Images/Primary`,
  `POST /Items/:id/Images/Primary` (base64 body).
- **Quirks:** box sets span libraries. Library names come from media folders.
- **Verification:** reads live; writes and watch state fake-only.

## Audiobookshelf (`audiobookshelf.ts`)

- **Credentials:** API token (admin token needed to add/download/delete podcasts). Header `Authorization: Bearer`.
- **Endpoints:** `GET /api/libraries`, library items for the library merge; podcasts:
  `POST /api/podcasts/feed`, `POST /api/podcasts`, `GET /api/libraries/:id/search?q=`, `GET /api/items/:id?expanded=1`,
  `POST /api/podcasts/:id/download-episodes`, `DELETE /api/podcasts/:id/episode/:eid?hard=1`.
- **Quirks:** adding a podcast follows ABS's own two-step flow (read the feed, then create). A new show appears after
  the next library pull; Matinee remembers adds in the `podcastsAdded` setting so the chart says "Added" immediately.
- **Verification:** reads live; add user-confirmed; episode endpoints fake-only.

## Calibre-Web / Calibre-Web Automated (`calibreweb.ts`)

- **Credentials:** the web login's username and password (HTTP Basic against the OPDS feed). OPDS must be enabled in
  Calibre-Web's admin settings.
- **Endpoints:** `GET /opds`, `GET /opds/new`, `GET /opds/search/<term>`, covers at `/opds/cover/<id>` (proxied).
- **Quirks:** the Atom feed is parsed with small regular expressions, not an XML library.
- **Verification:** `/opds/new` live; search fake-only.

## ReadMeABook (`readmeabook.ts`)

- **Credentials:** API token starting `rmab_` (admin token also exposes active downloads).
- **Allow-listed endpoints:** `GET /api/auth/me`, `GET /api/audiobooks/search?q=`, `GET|POST /api/requests`,
  `GET /api/admin/downloads/active`; popular and new-release lists are public.
- **Quirk:** its lists are empty until its Audible data refresh job has run.
- **Verification:** user-confirmed.

## TMDB (`tmdb.ts`)

- **Credentials:** the v4 Read Access Token (starts `eyJ`, sent as Bearer) or a v3 key (sent as `api_key`).
- **Endpoints:** `/trending/{movie|tv}/week`, `/movie|tv/popular|top_rated|upcoming|now_playing|on_the_air`,
  `/discover/tv`, `/movie|tv/:id`, `/movie|tv/:id/videos`, `/movie|tv/:id/images`, `/search/movie|tv`.
- **Used for:** discovery lists, artwork for MDBList items, poster choices, trailers.
- **Verification:** lists user-confirmed; the rest fake-only.

## MDBList (`mdblist.ts`)

- **Credentials:** API key (`?apikey=`), free at mdblist.com.
- **Endpoints (from memory of the public docs):** `GET /user`, `/lists/user`, `/lists/top`, `/lists/search?query=`,
  `/lists/:user/:slug`, `/lists/:id/items?limit&offset` returning `{ movies, shows }` (TMDB id in `id`).
- **Quirk:** items carry no artwork; Matinee borrows it from TMDB when TMDB is connected.
- **Verification:** fake-only. Check the paging parameters first if a long list looks short.

## Apple podcast charts and iTunes lookup (`podcasts.ts`, no key)

- `https://itunes.apple.com/{country}/rss/toppodcasts/limit=24/genre=<id>/json` for charts,
  `https://itunes.apple.com/lookup?id=<id>&entity=podcast` to find a show's RSS feed. Country from `PODCAST_COUNTRY`.
- Popular chart websites (Podtail and others) block bots and are not used.
- **Verification:** live.

## yt-dlp and ffmpeg (`trailers.ts`)

Installed in the image by `apk add ffmpeg yt-dlp`. Trailers are saved as `<folder name>-trailer.mp4` (Plex and
Jellyfin both read that), 1080p max, under 10 minutes and 600 MB. The source is TMDB's official YouTube trailer, or a
`ytsearch1:` query when TMDB has none. **Rebuild the image regularly:** yt-dlp breaks when YouTube changes.

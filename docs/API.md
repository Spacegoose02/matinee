# HTTP API

Routes exposed by Matinee itself. The web app is the only intended client, so this is a reference for development and
debugging rather than a stable public API. **Generated from the route declarations** by
`docs/gen-api.cjs`; run `node docs/gen-api.cjs` after adding or changing routes.

Access levels (enforced in `server/src/auth.ts`):

- **public**: no sign-in needed (login screen helpers).
- **signed in**: needs a session when sign-in is turned on; always open when no accounts exist.
- **admin**: administrators only when sign-in is on. Chosen by the `ADMIN_ANY` / `ADMIN_WRITE` prefix lists in `auth.ts`.

Errors are JSON `{ "statusCode", "error", "message" }`. A 502 means an upstream service failed; its message is passed through.
A 401 from `/api/*` means the session lapsed.

## Library cache

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/services` | signed in | `server/src/index.ts:242` |
| POST | `/api/services` | admin | `server/src/index.ts:248` |
| PUT | `/api/services/:id` | admin | `server/src/index.ts:255` |
| DELETE | `/api/services/:id` | admin | `server/src/index.ts:265` |
| POST | `/api/services/test` | admin | `server/src/index.ts:274` |
| GET | `/api/library` | signed in | `server/src/index.ts:283` |
| GET | `/api/item` | signed in | `server/src/index.ts:307` |

## Download clients: pause, resume, remove and move what SABnzbd and qBittorrent are holding

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/torrents` | signed in | `server/src/index.ts:319` |
| POST | `/api/downloads/control` | admin | `server/src/index.ts:324` |
| GET | `/api/queue` | signed in | `server/src/index.ts:341` |

## Trailers: find which titles lack a local trailer and download them with yt-dlp

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/trailers` | signed in | `server/src/index.ts:429` |
| GET | `/api/trailer-file` | signed in | `server/src/index.ts:442` |
| GET | `/api/trailer-online` | signed in | `server/src/index.ts:463` |
| GET | `/api/poster-options` | signed in | `server/src/index.ts:482` |
| GET | `/api/trailers/jobs` | signed in | `server/src/index.ts:495` |
| POST | `/api/trailers/download` | admin | `server/src/index.ts:497` |

## Manage media: rename, move, rescan and remove titles through Radarr/Sonarr

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/manage/rename` | signed in | `server/src/index.ts:530` |
| POST | `/api/manage/rename` | admin | `server/src/index.ts:540` |
| POST | `/api/manage/rename-folder` | admin | `server/src/index.ts:554` |
| POST | `/api/manage/renumber` | admin | `server/src/index.ts:569` |
| POST | `/api/manage/delete-files` | admin | `server/src/index.ts:586` |
| POST | `/api/manage/move` | admin | `server/src/index.ts:621` |
| POST | `/api/manage/rescan` | admin | `server/src/index.ts:639` |
| POST | `/api/manage/remove` | admin | `server/src/index.ts:651` |
| GET | `/api/activity` | signed in | `server/src/index.ts:665` |

## Stuck imports: finished downloads Radarr/Sonarr could not import

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/import-issues` | admin | `server/src/index.ts:672` |
| POST | `/api/import-retry` | admin | `server/src/index.ts:681` |
| POST | `/api/import-remove` | admin | `server/src/index.ts:695` |
| GET | `/api/import-browse` | admin | `server/src/index.ts:707` |
| GET | `/api/import-scan` | admin | `server/src/index.ts:716` |
| POST | `/api/import-folder` | admin | `server/src/index.ts:726` |
| POST | `/api/remote-path` | admin | `server/src/index.ts:738` |

## Discover: search Radarr/Sonarr lookup and add titles

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/search` | signed in | `server/src/index.ts:758` |

## Storage: map the managers' folders to folders Matinee can see, to measure real free space

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/add-options` | signed in | `server/src/index.ts:789` |
| GET | `/api/storage` | admin | `server/src/index.ts:798` |
| PUT | `/api/storage/mapping` | admin | `server/src/index.ts:827` |
| POST | `/api/storage/detect` | admin | `server/src/index.ts:846` |

## Calibre-Web: recently added ebooks for the Home page

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/books/search` | signed in | `server/src/index.ts:888` |
| POST | `/api/books/request` | signed in | `server/src/index.ts:907` |
| GET | `/api/calibre/recent` | signed in | `server/src/index.ts:919` |
| GET | `/api/mdblist/lists` | signed in | `server/src/index.ts:929` |
| GET | `/api/mdblist/items` | signed in | `server/src/index.ts:948` |
| GET | `/api/trending` | signed in | `server/src/index.ts:984` |

## Episodes

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/episodes` | signed in | `server/src/index.ts:1014` |
| POST | `/api/episode-search` | signed in | `server/src/index.ts:1025` |
| POST | `/api/season-search` | signed in | `server/src/index.ts:1036` |
| PUT | `/api/episode-monitor` | signed in | `server/src/index.ts:1048` |

## Collection covers: set one in Matinee, send it to the servers, copy between Plex and Jellyfin

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| POST | `/api/collections/cover` | admin | `server/src/index.ts:1142` |
| POST | `/api/collections/cover-fill` | admin | `server/src/index.ts:1171` |
| GET | `/api/collections/rules` | signed in | `server/src/index.ts:1198` |
| PUT | `/api/collections/rules` | admin | `server/src/index.ts:1209` |
| POST | `/api/collections/run` | admin | `server/src/index.ts:1231` |

## Audiobooks (ReadMeABook)

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/audiobook-search` | signed in | `server/src/index.ts:1288` |
| POST | `/api/audiobook-request` | signed in | `server/src/index.ts:1296` |
| GET | `/api/audiobook-lists` | signed in | `server/src/index.ts:1312` |

## Podcasts: public charts, and adding a show to Audiobookshelf

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/podcasts/episodes` | signed in | `server/src/index.ts:1338` |
| POST | `/api/podcasts/download` | signed in | `server/src/index.ts:1348` |
| POST | `/api/podcasts/delete-episodes` | admin | `server/src/index.ts:1363` |
| GET | `/api/podcasts/top` | signed in | `server/src/index.ts:1382` |
| GET | `/api/podcasts/targets` | signed in | `server/src/index.ts:1392` |
| POST | `/api/podcasts/add` | signed in | `server/src/index.ts:1397` |
| GET | `/api/audiobook-requests` | signed in | `server/src/index.ts:1416` |

## Download history

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/history` | signed in | `server/src/index.ts:1424` |
| POST | `/api/add` | signed in | `server/src/index.ts:1429` |
| POST | `/api/download-search` | signed in | `server/src/index.ts:1460` |

## Manual release search ("interactive search")

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/seasons` | signed in | `server/src/index.ts:1480` |
| GET | `/api/releases` | signed in | `server/src/index.ts:1491` |
| POST | `/api/grab` | signed in | `server/src/index.ts:1502` |
| GET | `/api/image` | signed in | `server/src/index.ts:1537` |

## Home page layout

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/settings/home` | signed in | `server/src/index.ts:1597` |
| PUT | `/api/settings/home` | signed in | `server/src/index.ts:1599` |

## Poster overrides

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| POST | `/api/poster` | admin | `server/src/index.ts:1622` |
| POST | `/api/poster/push` | admin | `server/src/index.ts:1636` |
| DELETE | `/api/poster` | admin | `server/src/index.ts:1661` |

## Sign-in and users

| Method | Path | Access | Source |
| --- | --- | --- | --- |
| GET | `/api/auth/status` | public | `server/src/auth.ts:84` |
| POST | `/api/auth/setup` | public | `server/src/auth.ts:97` |
| POST | `/api/auth/login` | public | `server/src/auth.ts:105` |
| POST | `/api/auth/logout` | signed in | `server/src/auth.ts:120` |
| PUT | `/api/auth/prefs` | signed in | `server/src/auth.ts:127` |
| GET | `/api/users` | admin | `server/src/auth.ts:145` |
| POST | `/api/users` | admin | `server/src/auth.ts:147` |
| PUT | `/api/users/:id/password` | admin | `server/src/auth.ts:152` |
| DELETE | `/api/users/:id` | admin | `server/src/auth.ts:161` |
| POST | `/api/auth/disable` | admin | `server/src/auth.ts:171` |

## Static

- `/posters/*`: poster and cover overrides saved in the config folder (public).
- Everything else serves the built web app (`web/dist`) with an SPA fallback.

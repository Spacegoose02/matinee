# Handover guide

Read this first if you are taking the project over. It says what exists, how trustworthy each part is,
where the sharp edges are, and what to do next.

## In one paragraph

Matinee is a Fastify + React app that aggregates a self-hosted media stack. It reads from Radarr, Sonarr, Plex,
Jellyfin, Audiobookshelf and friends, merges the results into one library, and sends instructions back (add, search,
rename, move, delete, pause, collections, posters, trailers). State is one SQLite file plus caches. It runs as one
Docker image.

## Ten-minute orientation

1. `README.md` for what it does and how it is deployed.
2. `docs/ARCHITECTURE.md` for the shape of the code (adapters, library cache, merge, auth).
3. Run it: `npm install && npm run dev:server` and `npm run dev:web` (see `DEVELOPMENT.md`).
4. Open `server/src/services/types.ts`. Every cross-cutting type lives there, including the `ServiceAdapter` interface.
5. Open `server/src/index.ts` and skim the `// --- Section ---` banners. Then `web/src/api.ts` to see the matching
   client calls. Together those two files are a complete table of contents of the product.
6. Pick one feature end to end using `docs/FEATURES.md` (e.g. "Trailers": page, routes, adapter, external calls).

## Verification status: what has actually been proven

This project was built mostly against **fake servers** (small scripts mimicking an API) plus read-only probes of a
real home setup. Where an external API was written from documentation or memory, it is marked below. When something
breaks in production, suspect the *unverified* items first, and fix them by looking at what the real service sends.

Legend: **Live** = exercised against a real instance. **User-confirmed** = the owner reported it works.
**Fake only** = tested against a hand-written fake that follows the API as remembered; real behaviour may differ.

| Area | Status |
| --- | --- |
| Radarr/Sonarr library, queue, add, search, releases, episodes, history | Live / user-confirmed |
| Radarr/Sonarr stuck imports list, retry, remote path mappings (`/remotepathmapping`) | Fake only (a wrong endpoint name was found and fixed from a live 404) |
| Radarr/Sonarr rename preview/apply, root-folder move, rescan, delete, renumber (manual import), delete files, blocklist | Fake only |
| Radarr/Sonarr manual import / "import from a folder" | Fake only |
| Plex library, images, watch state fields, collections read | Live (read) |
| Plex collection writes, poster upload (`/library/metadata/:id/posters`) | Fake only |
| Jellyfin library, images | Live (read) |
| Jellyfin collection writes, poster upload, watch state via first admin `UserId` | Fake only |
| SABnzbd queue/history | Live (read); pause/resume/delete URLs Fake only |
| qBittorrent login, queue, history | Live (incl. ban back-off and 204 login); control (pause/stop, delete, setLocation) Fake only |
| Deluge | Written, never verified. Treat as unsupported. |
| Audiobookshelf library read | Live (read) |
| Audiobookshelf podcast add / episode download / delete | User-confirmed add; episode endpoints Fake only |
| ReadMeABook search/request/lists | User-confirmed |
| TMDB lists, details, videos, images | User-confirmed (lists); others Fake only |
| MDBList lists/items | Fake only (endpoints from memory of the public docs) |
| Calibre-Web OPDS (`/opds`, `/opds/new`) | Live; `/opds/search/<term>` Fake only |
| Shelfmark search (`GET /api/releases?source=direct_download&query=`) | Live |
| Shelfmark download (`POST /api/releases/download`) | Copied from Shelfmark's own web app code; **never executed** |
| Shelfmark status/queue | Live (empty queue) |
| Apple podcast charts, iTunes feed lookup | Live |
| yt-dlp trailer download | Never run end to end here (no yt-dlp on the dev machine); detection/folder logic tested |
| Sign-in, roles, lockout | Tested with curl on a throwaway instance |

## Known gaps and sharp edges

- **No automated test suite.** Verification was manual and with throwaway fake servers. Adding tests is the single
  most valuable investment (see "Next steps"). `docs/DEVELOPMENT.md` shows the fake-server technique.
- **`server/src/index.ts` is ~1,700 lines.** It is organised by banner comments, but it should be split into route
  modules when someone next touches a large part of it.
- **Plain-text credentials** in SQLite (the services need them). Masked in the UI; protect the config folder.
- **Sign-in has no CSRF token** (SameSite=Lax cookies and JSON bodies are the mitigation) and no HTTPS of its own;
  put it behind a reverse proxy if exposed beyond the LAN.
- **Trailer queue is in memory.** A restart forgets queued jobs.
- **Path mapping is needed for anything that touches disk** (trailers, free space). Matinee sees folders through the
  `/media` mount while Radarr/Sonarr see their own container paths; Settings → Storage maps one to the other.
- **Collections on Plex are per library section** (a Plex limitation). The engine creates one per section.
- **Ebooks are not in the main library.** Calibre-Web is only used for the Home row and the Books page.
- **Jellyfin watch state** is the first administrator's. Plex watch state is the token owner's.
- **Upstream changes break adapters.** yt-dlp goes stale quickly (rebuild the image), and *arr/Plex/Jellyfin APIs
  occasionally change. Errors from services are surfaced verbatim so a screenshot usually identifies the cause.

## Decisions worth knowing

- **Radarr/Sonarr/Plex do the work.** Matinee never moves, renames or deletes files itself. This keeps their databases
  correct. The one exception is writing trailer files.
- **Everything is a preview first** when it can be (collection changes, rename, renumber, stuck-import scans).
- **Stale-while-revalidate** instead of spinners: the UI paints from cache and updates when the pull finishes.
- **Slim list + full item endpoint** keeps the library payload small enough for 10,000+ titles.
- **Hash routing** so the SPA needs no server-side route handling and works behind any path.
- **No UI framework or CSS library**: plain React and hand-written CSS with theme tokens.
- **Optional auth** so existing single-user installs keep working without a login screen.
- **Hand-parsed OPDS (XML) in `calibreweb.ts`** to avoid a dependency; if Calibre-Web output gets more complex,
  swap in a real XML parser.

## Next steps (backlog)

Roughly in value order. None of these are started.

1. **Tests.** Start with `library.ts` (pure merge logic), `auth.ts` routes, and each adapter against recorded fixtures.
2. **Split `index.ts`** into `routes/*.ts`.
3. **Verify the unverified** table above against real services and fix adapters; record fixtures while doing it.
4. **Ebooks in the library** (Calibre-Web items as a media type) and a Shelfmark to Calibre-Web hand-off view.
5. **Persist the trailer queue** and add automatic trailer download for newly added titles.
6. **More list providers** (Trakt has a proper free API; IMDb and TVDB do not).
7. **Per-user watch state** (map each Matinee user to a Plex/Jellyfin user).
8. **Delete-collection** and collection ordering (deliberately omitted so far).
9. **Notifications** (Discord/webhook) when downloads finish or imports get stuck.
10. **Hardening**: CSRF token, optional HTTPS guidance, encrypted credentials at rest.

## How to work safely

- Prefer additive changes to `ServiceAdapter` (new optional methods) over changing existing ones.
- After changing the shape of a raw item (`RawItem`, `ServerEntry`, `RawCollection`) bump `CACHE_VERSION`.
- After adding a route, run `node docs/gen-api.cjs` and decide its access level in `auth.ts`.
- Before changing a destructive action, read the matching `Manage.tsx` modal and the server confirmation together.
- Never log secrets; `fromBody()` in `index.ts` shows how masked values are round-tripped.

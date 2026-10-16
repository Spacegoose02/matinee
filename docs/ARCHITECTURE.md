<!-- brand:start -->
<p align="center"><a href="../README.md"><img src="../brand/logo.svg" alt="Matinee" height="56"></a></p>

<p align="center"><a href="../README.md">Home</a> · <a href="HANDOVER.md">Handover</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="DEVELOPMENT.md">Development</a> · <a href="EXTENDING.md">Extending</a> · <a href="FEATURES.md">Features</a> · <a href="SERVICES.md">Services</a> · <a href="API.md">API</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="OPERATIONS.md">Operations</a></p>

---
<!-- brand:end -->

# Architecture

Matinee is a Node.js server plus a React single-page app, shipped together in one Docker image.

```
 Browser (React SPA, hash routes)
        │  fetch /api/...        cookie: matinee_session (only when sign-in is on)
        ▼
 Fastify server (server/src/index.ts)
   ├─ auth hook (auth.ts)  ── users/sessions in SQLite
   ├─ library cache (managers ⟷ servers) ── library.ts merge
   ├─ adapters (server/src/services/*)  ── one per external service
   └─ SQLite + files in CONFIG_DIR
        │
        ▼
 Radarr · Sonarr · SABnzbd · qBittorrent · Deluge · Shelfmark · Plex · Jellyfin ·
 Audiobookshelf · Calibre-Web · ReadMeABook · TMDB · MDBList · Apple podcast charts · yt-dlp
```

## Repository layout

```
server/                    Node 24, TypeScript (ESM, NodeNext), Fastify 5, node:sqlite
  src/index.ts             All HTTP routes, the library cache, background jobs (large; see "index.ts map")
  src/auth.ts              Optional sign-in, roles, per-user settings keys
  src/db.ts                SQLite schema + small key/value settings store
  src/library.ts           Merge of managers and media servers into MediaItem[] and collections
  src/collections.ts       The collection engine (create / add / remove with dry-run)
  src/trailers.ts          Finding existing trailers, yt-dlp wrapper, local folder resolution
  src/storage.ts           Real disk space, /media inspection, folder auto-detect
  src/podcasts.ts          Apple podcast charts, iTunes feed lookup
  src/http.ts              fetch wrappers with timeouts and readable errors
  src/util.ts              mapLimit (bounded concurrency)
  src/services/            One adapter per service + types.ts (the shared contracts) + registry.ts
web/                       React 19, Vite 8, TypeScript, hand-written CSS
  src/main.tsx             Boot: theme, AuthGate, StoreProvider, App
  src/App.tsx              Shell: sidebar, top bar, hash router
  src/api.ts               Every client type and every call to /api (single file)
  src/store.tsx            Global state: library, services, home layout, toasts, queue hook
  src/auth.tsx             AuthGate, login page, useAuth
  src/pages/               One file per top-level page
  src/components/          Everything reusable (modals, shelves, cards, panels)
  src/styles.css           All styling, theme tokens at the top
  src/themes.ts            Theme list (ids must match [data-theme="..."] blocks in styles.css)
unraid/my-matinee.xml      Unraid container template
brand/                     Logo sources and generator
docs/                      This documentation
```

## The adapter pattern

Every external service is an *adapter*: a function `(cfg: ServiceConfig) => ServiceAdapter`.
`ServiceAdapter` (in `server/src/services/types.ts`) is one interface with many **optional** methods
(`test`, `library`, `collections`, `queue`, `search`, `add`, `releases`, `episodes`, `history`,
`collectionCreate`, `setPoster`, `control`, `torrents`, `recentBooks`, ...).
An adapter implements only the methods that make sense for it. Routes call `adapterFor(service).method?.()` and
the web app never talks to a service directly.

`registry.ts` maps `ServiceKind` to its factory and lists which credential fields each kind uses. Adding a kind
is described in [EXTENDING.md](EXTENDING.md).

`fanOut()` in `index.ts` runs one method across several services at once and returns `{ items, errors }`, so one
broken service shows as a banner while the others still work. This is the standard way to aggregate.

## Data flow: the library

1. **Pull.** Two groups are pulled separately:
   - *managers* (Radarr, Sonarr): fast, TTL 2 minutes.
   - *servers* (Plex, Jellyfin, Audiobookshelf): slow on big libraries, TTL 15 minutes; also pull collections.
2. **Cache.** Results live in memory and in `config/library-cache.json` (versioned by `CACHE_VERSION` in
   `index.ts`; bump it whenever the shape of a raw item changes). Stale data is served immediately while a refresh
   runs in the background (stale-while-revalidate). Loads are de-duplicated while in flight.
3. **Merge.** `library.ts: buildLibrary` matches managed titles and server titles by TMDB, TVDB or IMDb id
   (falling back to normalised title+year), assigns a stable `key` (e.g. `movie:tmdb-603`), and votes folder
   names into library names (so `christmas` folders fold into the right library).
4. **Serve.** `/api/library` returns a *slim* list (no overviews/backdrops/paths) pre-serialised and gzipped once per
   change, plus `collections`. `/api/item?key=` returns the full record when a detail drawer opens. Poster overrides
   and per-user pins are applied at serve time so changing them needs no re-pull.

Invalidate after writes with `refreshManagers()` (Radarr/Sonarr changed) or by clearing the server cache
(`invalidate(kind)`), never by restarting.

## Writing to services

Routes that change things follow a pattern:

1. Validate input (ids are integers, paths are strings, lists are capped).
2. Resolve the title from the server's own cache by `key` (never trust ids from the page for destructive steps).
3. Call the adapter method; map failures to `502` with a readable message (`httpErrors.badGateway`).
4. Refresh the relevant cache.

Destructive routes add server-side confirmation (`/api/manage/remove` requires the exact title) and the UI mirrors it.

## Authentication

`auth.ts` registers an `onRequest` hook **before any route** (Fastify applies hooks only to routes registered
after them; do not move `registerAuth(app)` below the routes).

- No users in the database means sign-in is off and every request passes.
- Once a user exists, every `/api/*` path except `/api/auth/status|login|setup` needs a valid session cookie.
- Passwords: scrypt with a per-user salt. Sessions: random 32-byte token in an HttpOnly, SameSite=Lax cookie;
  only the SHA-256 of the token is stored. Login is rate limited per IP+name.
- Roles: `admin` and `user`. `ADMIN_ANY` and `ADMIN_WRITE` prefix lists in `auth.ts` decide which routes are
  admin-only. **When you add a route that reads secrets, paths or changes files, add its prefix to those lists.**
- Per-user data uses settings keys `home:<userId>` and `theme:<userId>`.

## Front end

- **Routing**: hash routes (`#/movies`, `#/collections/Name`, `#/downloads/torrents`, `#/list/tmdb:popular:movie`).
  `App.tsx: parseRoute` splits into `page` and a single `arg`. Add a page by extending `PAGES` and the render list.
- **State**: `StoreProvider` (`store.tsx`) loads library, services and home settings. Actions are in a separate
  stable context (`useActions`) so memoised cards do not re-render on unrelated updates. Polling hooks (`useQueue`)
  live there too.
- **Calls**: all through `api` in `api.ts`. `call()` throws `Error(message)` using the server's `message`, and fires a
  `matinee-unauthorized` window event on 401 so `AuthGate` can show the login page.
- **Performance rules** that matter: lists render in chunks (`useIncremental`), cards are memoised, artwork is
  resized by the adapters and proxied through `/api/image` with a disk cache, shelves load lazily
  (`useNearViewport`), no `backdrop-filter` anywhere (it made fixed-position modals relative to the top bar).
- **Modals** that must escape stacking contexts use `createPortal(..., document.body)`.
- **Themes**: CSS custom properties per `[data-theme]`; retro themes add overrides further down `styles.css`.

## Background jobs

- Library refresh (on demand, TTL based).
- Tag-rule collection sync: `setInterval` every 30 minutes, only when enabled in settings.
- Trailer downloads: a sequential in-memory queue (`runTrailerQueue`); a restart clears it.
- Image proxy: bounded concurrency (`withImageSlot`) and disk cache in `imgcache/`.

## State on disk (`CONFIG_DIR`)

| Path | Contents | Rebuildable? |
| --- | --- | --- |
| `marquee.db` | `services`, `settings` (JSON key/value), `users`, `sessions` | No, back it up |
| `posters/` | Poster and collection-cover overrides (keyed in settings `posters`) | No |
| `imgcache/` | Proxied artwork cache | Yes |
| `library-cache.json` | Last library pull | Yes |

Settings keys in use: `home`, `home:<userId>`, `theme:<userId>`, `posters`, `pathMappings`, `collectionRules`,
`podcastsAdded`.

## index.ts map

`index.ts` is intentionally one file of routes grouped by banner comments (`// --- Section ---`). Search for those
banners: services CRUD, library cache, image proxy, discover/add, releases and episodes, history, storage, trending,
trailers, stuck imports, manage media, collections, covers, audiobooks, podcasts, books, MDBList, download control,
settings. If it grows further, split by section into `server/src/routes/*.ts` and keep `fanOut`, `targets` and the
cache helpers in a shared module.

## Naming note

The project began as "Marquee" and was renamed **Matinee**. Internals deliberately keep the old name where
renaming would break saved data: the npm workspaces are `@marquee/*`, the database is `marquee.db`, and browser
`localStorage` keys start with `marquee.`. The display name is `web/src/brand.ts` (`APP_NAME`) and `web/index.html`.

# Matinee

A self-hosted dashboard that ties a home media stack together: **Radarr, Sonarr, SABnzbd, qBittorrent, Deluge,
Shelfmark, Plex, Jellyfin, Audiobookshelf, Calibre-Web, ReadMeABook, TMDB and MDBList** in one fast web app.
It ships as a single Docker image (built with Unraid in mind) and keeps its own small state in one folder.

Matinee does not replace your apps. It reads from them, merges what they know about each title, and sends
instructions back to them (add, search, rename, move, delete, pause...). The apps stay the source of truth.

> New to the code? Start with [docs/HANDOVER.md](docs/HANDOVER.md), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [First run](#first-run)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Safety model](#safety-model)
- [Development quick start](#development-quick-start)

## What it does

| Area | Highlights |
| --- | --- |
| **Home** | Featured banner, shelves for recent additions, libraries, collections, downloads, trending lists (TMDB), MDBList lists, podcasts, audiobooks, new ebooks. Everything is re-orderable under *Customize home*, per user. |
| **Library** | Movies, TV and audiobooks merged across Radarr/Sonarr and Plex/Jellyfin by TMDB/TVDB/IMDb id, split by library or root folder. Filters for status and watch state (watched / in progress / not watched). |
| **Details** | Summary, quality, folders, which servers have it, trailer (play or download), episode list, poster picker (TMDB or your own image), send posters to Plex/Jellyfin. |
| **Manage media** | Rename files or the folder, move to another root folder, rescan, fix season/episode numbering, delete files to re-download, remove a title. All carried out by Radarr/Sonarr. |
| **Discover** | Search and add movies/shows with a chosen folder and quality profile, manual release search, audiobook requests, podcast charts with episode picking, ebook search with Shelfmark. |
| **Downloads** | Live queues (SABnzbd, qBittorrent, Deluge, Shelfmark), pause/resume/remove, a torrent manager, stuck-import repair, import from a folder, history, library activity, trailers. |
| **Collections** | Plex collections and Jellyfin box sets merged by name; create, sync between servers, tag rules, covers. |
| **Users** | Optional sign-in with administrator and user roles. |
| **Themes** | 20 themes, modern and retro. |

Full feature-to-code map: [docs/FEATURES.md](docs/FEATURES.md).

## Install

### Docker (any host)

```bash
docker run -d --name matinee \
  -p 7171:7171 \
  -v /path/for/matinee-config:/config \
  -v /path/to/your/media:/media \
  ghcr.io/spacegoose02/matinee:latest
```

The `/media` mount is optional: it lets Matinee measure real free space and save trailers next to your titles.

To build the image yourself instead:

```bash
git clone https://github.com/Spacegoose02/matinee.git
cd matinee
docker build -t matinee .
```

### Unraid

1. Copy [`unraid/my-matinee.xml`](unraid/my-matinee.xml) to `/boot/config/plugins/dockerMan/templates-user/`.
2. In the Docker tab choose **Add Container**, pick the *matinee* template.
3. The template pulls the published image `ghcr.io/spacegoose02/matinee:latest`. To use an image you built yourself,
   change *Repository* to `matinee:latest`.
4. Set the **Config** path (default `/mnt/user/appdata/matinee`) and, optionally, the **Media** path.
   Use *Read/Write* on Media if you want trailers downloaded; *Read Only - Slave* for remote/Unassigned shares.
5. Open `http://SERVER-IP:7171`.

### Updating

```bash
docker pull ghcr.io/spacegoose02/matinee:latest      # or: git pull && docker build -t matinee .
```

Then recreate the container (on Unraid: *Edit*, then *Apply*). Settings live in the config folder and survive.
The first page load after an upgrade can take a while because the library cache is rebuilt.

## First run

1. Open the web UI, go to **Settings → Services** and add what you have. Each service has a *Test* button.
   Typical minimum: Radarr, Sonarr, Plex or Jellyfin.
2. Optional extras: **TMDB** (free key, trending lists, poster choices, trailers), **MDBList** (free key),
   **Calibre-Web**, **Shelfmark**, **ReadMeABook**, **Audiobookshelf**.
3. **Settings → Storage** maps each Radarr/Sonarr root folder to a folder Matinee can see under `/media`.
4. Optional: **Settings → Users** turns on sign-in. The first account becomes the administrator.

Per-service credential hints are in [docs/SERVICES.md](docs/SERVICES.md).

## Configuration

Matinee has almost no environment variables because nearly everything is configured in the UI.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7171` | HTTP port inside the container |
| `CONFIG_DIR` | `/config` (image) / `./config` (dev) | Where state is kept |
| `MEDIA_DIR` | `/media` | Where the media share is mounted |
| `PODCAST_COUNTRY` | `us` | Country for the Apple podcast charts |
| `WEB_DIST` | `../../web/dist` | Location of the built web app, relative to the compiled server |
| `LOG_LEVEL` | `info` | Fastify log level |
| `MATINEE_RESET_AUTH` | unset | Set to `1` for one start to delete all accounts and turn sign-in off (lockout recovery) |

The config folder holds `marquee.db` (SQLite: services, settings, users), `posters/`, `imgcache/` and
`library-cache.json`. Back up `marquee.db` and `posters/`; the rest is a rebuildable cache.
Details: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

| Document | Read it when |
| --- | --- |
| [docs/HANDOVER.md](docs/HANDOVER.md) | You are taking the project over. Status, what is verified, known gaps, backlog. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | You want to know how the pieces fit: server, web app, cache, merge, auth. |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | You want to run it locally, test against fakes, build and release. |
| [docs/EXTENDING.md](docs/EXTENDING.md) | You want to add a service, an API route or a page. Step-by-step recipes. |
| [docs/FEATURES.md](docs/FEATURES.md) | You want to find the code behind a feature, or the external calls it makes. |
| [docs/SERVICES.md](docs/SERVICES.md) | You are debugging an integration: endpoints used, credentials, quirks, verification status. |
| [docs/API.md](docs/API.md) | You want the HTTP routes Matinee itself exposes. |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Something is empty, slow, 404s or refuses to log in. |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Backups, upgrades, resets, caches. |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release. |

## Safety model

- Matinee only changes your services when a button is pressed. Nothing runs unattended except the optional
  tag-rule collection sync (off by default, every 30 minutes).
- Anything destructive (delete files, remove a title, remove torrents with data) needs an explicit tick box and,
  for removing a title, typing its name. The server re-checks that, not just the page.
- File changes go through Radarr/Sonarr/Plex/Jellyfin APIs. Matinee itself writes files in exactly one place:
  trailers saved next to a title (needs `/media` mounted read/write).
- Sign-in is optional and off by default. With it on, regular users cannot change settings, manage files,
  control downloads or see service addresses.
- API keys and passwords are stored in `marquee.db` in plain text (they are needed to call the services) and are
  masked in the UI. Protect the config folder and do not expose Matinee to the internet without a reverse proxy
  and sign-in.

## Development quick start

```bash
npm install
npm run dev:server   # API on http://localhost:7171
npm run dev:web      # UI on http://localhost:5173 (proxies /api)
npm run typecheck
npm run build
```

More in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Logo

The mark is a manatee silhouette. `brand/` holds the SVGs and PNG icon; `brand/gen-logo.cjs` regenerates them from one
outline (run it from that folder). Copies live in `web/public/`.

<!-- brand:start -->
<p align="center"><a href="../README.md"><img src="../brand/logo.svg" alt="Matinee" height="56"></a></p>

<p align="center"><a href="../README.md">Home</a> · <a href="HANDOVER.md">Handover</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="DEVELOPMENT.md">Development</a> · <a href="EXTENDING.md">Extending</a> · <a href="FEATURES.md">Features</a> · <a href="SERVICES.md">Services</a> · <a href="API.md">API</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="OPERATIONS.md">Operations</a></p>

---
<!-- brand:end -->

# Operations

## What lives where

Inside the container the config folder is `/config` (host path of your choice). The media share, if mounted, is `/media`.

| Path | Content | Back up? |
| --- | --- | --- |
| `/config/marquee.db` | Service connections (with keys), settings, users, sessions | **Yes** |
| `/config/posters/` | Poster and collection-cover overrides | **Yes** |
| `/config/imgcache/` | Proxied artwork cache | No (safe to delete) |
| `/config/library-cache.json` | Last library pull | No (rebuilt automatically) |

Stop the container before copying `marquee.db` (SQLite) or use `sqlite3 marquee.db ".backup copy.db"`.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `7171` | Container port |
| `CONFIG_DIR` | `/config` | State folder |
| `MEDIA_DIR` | `/media` | Where the media share is mounted |
| `WEB_DIST` | `../../web/dist` | Where the built web app is (relative to the compiled server); rarely changed |
| `PODCAST_COUNTRY` | `us` | Apple chart country |
| `LOG_LEVEL` | `info` | `debug` for request detail |
| `MATINEE_RESET_AUTH` | unset | `1` removes all accounts at startup (lockout recovery). Remove it afterwards. |
| `NODE_ENV` | `production` | Set by the image |

## Upgrading

1. Pull the new image (or rebuild from source) and recreate the container.
2. Open the UI. The first load may be slow (cache rebuild). Settings and users are kept.
3. If anything looks wrong, restore `marquee.db` from your backup and run the previous image tag.

Schema changes use `CREATE TABLE IF NOT EXISTS` in `server/src/db.ts`. There is no migration framework; if you change a
table, write the `ALTER TABLE` yourself, guarded, in `db.ts`, and note it in `CHANGELOG.md`.

## Sign-in

- Turn on: Settings → Users (the first account becomes administrator).
- Turn off: Settings → Users → *Turn off sign-in*, which deletes every account.
- Lost the administrator password: start once with `MATINEE_RESET_AUTH=1`, then unset it and set up sign-in again.
  Per-user Home layouts and themes are removed with the accounts.

## Mounting media

- Container path `/media`, host path your media share (for example `/mnt/user`).
- Read/Write if you want trailers saved; Read Only is enough for free-space measurement.
- Remote or Unassigned Devices shares need *Read Only - Slave* (or *Read/Write - Slave*) so the container sees them.
- Then Settings → Storage → *Detect folders*, or map each root folder manually.

## Resetting things

| Goal | How |
| --- | --- |
| Force a full re-pull of Plex/Jellyfin | Delete `library-cache.json` (container stopped), or press refresh in the UI |
| Clear artwork cache | Delete `/config/imgcache` |
| Forget a poster override | Details → Change poster → *Reset*, or delete the file and the entry in setting `posters` |
| Start from scratch | Stop, delete the config folder contents, start |

## Security notes

- Do not expose port 7171 to the internet directly. Use a reverse proxy with HTTPS and turn on sign-in.
- Keys and passwords are stored in plain text in `marquee.db`; protect backups.
- Regular users cannot see service addresses or change anything destructive; administrators can do everything.
- The image proxy (`/api/image`) only fetches paths from already configured services and rejects `..`.

## Health

`GET /api/auth/status` is public and cheap; use it for a container health check.

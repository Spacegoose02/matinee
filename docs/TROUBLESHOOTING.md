# Troubleshooting

Matinee shows each service's error text instead of hiding it. Start with the exact message, then use this table.
Logs: `docker logs matinee` (set `LOG_LEVEL=debug` for more).

## Quick table

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| A service shows **404 Not Found** on a page | Matinee called an endpoint that service does not have (wrong name or version) | Find the call in `docs/SERVICES.md`, compare with the service's own web app (browser dev tools, Network tab), fix the adapter |
| **"Could not reach ... timeout"** for Plex | Very large library | Paging and concurrency already apply; raise the timeout in `plex.ts` or reduce `COLLECTION_CONCURRENCY` |
| qBittorrent **403** or "not retrying for N min" | Too many failed logins banned the IP | Fix the username/password, wait out the ban (or restart qBittorrent), press *Test* (forces a retry) |
| qBittorrent test says **400 Bad Request** | The URL points at a reverse proxy in front of qBittorrent, or the Referer/Origin did not match | Use the address you use in a browser; Matinee sends matching `Referer`/`Origin` |
| First page load is very slow after an upgrade | Library cache version changed, full re-pull | Wait once; it is cached afterwards |
| Library is empty but services test OK | Pull still running or failed | Check the red banner; press the refresh button; check logs |
| Poster tiles show letters | Image proxy cannot reach the service, or no artwork | Open the image URL (`/api/image?...`) in a tab to see the error |
| **Free space looks wrong** | Mapping missing or `/media` not mounted | Settings → Storage; mount `/media`; use *Read Only - Slave* for remote shares |
| Storage detect finds nothing | `/media` is empty inside the container | See the message in Settings → Storage (it lists what is visible); remote shares need the Slave access mode |
| Trailers say "Folder not found" | Titles cannot be located under `/media` | Map each root folder in Settings → Storage |
| Trailers say "Folder is read-only" | `/media` mounted read-only | Edit the container, set the Media path to Read/Write |
| Trailer download fails immediately | `yt-dlp` missing or stale | Rebuild the image (installs the latest `yt-dlp`) |
| "Stuck imports" lists nothing but downloads are stuck | The manager considers them still downloading, or the problem is in the client | Check the manager's Activity queue; use *Import from a folder* |
| Remote path mapping saved but import still fails | The path on the manager side is not mounted, or permissions | The mapping only translates paths; the container must actually see the folder |
| Added a podcast but the tag still says "+ Add" | Older build, or library not refreshed | Rebuild; the chart remembers adds in the `podcastsAdded` setting |
| MDBList list shorter than expected | MDBList paging parameters differ from what the adapter assumes | Check `externalListItems()` in `services/mdblist.ts` against a real response |
| Shelfmark search finds nothing | Shelfmark's sources are disabled or slow | Search in Shelfmark's own UI; Matinee uses the *Direct Download* source |
| Shelfmark **Download** says the result expired | Results are kept for 30 minutes | Search again, then press Download |
| Can't sign in | Wrong name or password; locked out after 6 tries | Wait 15 minutes. Forgot the admin password: start once with `MATINEE_RESET_AUTH=1` |
| 401 errors everywhere | Session expired | Reload; sign in again |
| 403 "Only an administrator can do that" | Signed in as a regular user | Use an administrator account |
| Changes to Home do not appear for another user | Home is per user | Each person has their own layout |
| Unraid edit form keeps reverting the Media path | Two template files for the same container | Remove the duplicate under `templates-user`; keep `my-matinee.xml` |

## Debugging recipes

**What did Matinee send to a service?** Run the server with `LOG_LEVEL=debug`, or reproduce the call with a fake
server (see [DEVELOPMENT.md](DEVELOPMENT.md)). The adapter file for the service shows the exact URL, method and body.

**What does the service really return?** Call it yourself with `curl` using the same key. For services with a web UI,
open it and watch the browser's Network tab while you perform the action.

**Is it the cache?** `GET /api/library?refresh=1` forces a re-pull. Deleting `config/library-cache.json` while the
container is stopped discards everything cached.

**Is it the browser?** Hard reload; the UI is a static bundle with hashed file names, so stale bundles are rare. Open the
Network tab to see which `/api` call failed and read its JSON `message`.

**Is it a permission problem on disk?** The image runs as uid 99 / gid 100. Files under `/config` and any writable
`/media` path must allow that user.

**A new field is missing after a change** Did you bump `CACHE_VERSION`? Old cache entries lack new fields.

## Reporting a bug

Include: Matinee version (`package.json`), the page, the exact on-screen message, what the service's own UI shows,
and the relevant `docker logs` lines with any addresses or keys removed.

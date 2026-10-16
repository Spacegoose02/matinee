# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org/).
To release: move items from *Unreleased* under a new `## [x.y.z] - date` heading, bump the version in `package.json`,
commit, and push a tag `vx.y.z` (see `docs/DEVELOPMENT.md`).

## [Unreleased]

## [1.0.0] - 2026-10-15

First public release.

### Added
- **Aggregation:** one library merged across Radarr, Sonarr, Plex, Jellyfin and Audiobookshelf, split by library or
  root folder, with watch state (watched / in progress / not watched).
- **Home:** featured banner and customisable shelves (recent, libraries, collections, downloads, trending, MDBList lists,
  podcasts, audiobooks, ebooks), saved per user; "See all" pages for every list.
- **Discover:** search and add movies and shows with a chosen folder and quality profile, manual release search,
  episode list with per-episode search and release picker, audiobook requests (ReadMeABook), podcast charts with
  episode picking (Audiobookshelf), ebook search with Shelfmark and Calibre-Web.
- **Manage media:** rename files, rename folder, move to another root folder, rescan, fix season/episode numbering,
  delete files to re-download (with optional blocklist), remove a title; all performed by Radarr/Sonarr.
- **Downloads:** live queues and speed graph; pause/resume/remove for SABnzbd and qBittorrent; torrent manager with
  folder move; stuck-import repair (retry, remove, remote path mappings, import from a folder); library activity;
  history.
- **Collections:** create, sync between Plex and Jellyfin, tag rules, covers (set, send, copy, fill missing).
- **Trailers:** detect existing local trailers, play them or TMDB's, download with yt-dlp next to the title.
- **Posters:** choose from TMDB or upload, send to Plex and Jellyfin.
- **Sign-in:** optional accounts with administrator and user roles, per-user Home layout and theme.
- **Real free space** measurement via a mounted media share and path mapping.
- 20 themes, manatee logo, Unraid template, multi-arch Docker image.

### Known limitations
- No automated tests yet; many integrations are verified only against fake servers (see `docs/HANDOVER.md`).
- Deluge support is unverified.

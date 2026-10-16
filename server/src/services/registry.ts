import { arrAdapter } from "./arr.js";
import { calibrewebAdapter } from "./calibreweb.js";
import { audiobookshelfAdapter } from "./audiobookshelf.js";
import { delugeAdapter } from "./deluge.js";
import { jellyfinAdapter } from "./jellyfin.js";
import { mdblistAdapter } from "./mdblist.js";
import { plexAdapter } from "./plex.js";
import { qbittorrentAdapter } from "./qbittorrent.js";
import { readmeabookAdapter } from "./readmeabook.js";
import { sabnzbdAdapter } from "./sabnzbd.js";
import { shelfmarkAdapter } from "./shelfmark.js";
import { tmdbAdapter } from "./tmdb.js";
import type { ServiceAdapter, ServiceConfig, ServiceKind } from "./types.js";

const factories: Record<ServiceKind, (cfg: ServiceConfig) => ServiceAdapter> = {
  radarr: arrAdapter,
  sonarr: arrAdapter,
  sabnzbd: sabnzbdAdapter,
  qbittorrent: qbittorrentAdapter,
  deluge: delugeAdapter,
  shelfmark: shelfmarkAdapter,
  plex: plexAdapter,
  jellyfin: jellyfinAdapter,
  audiobookshelf: audiobookshelfAdapter,
  tmdb: tmdbAdapter,
  readmeabook: readmeabookAdapter,
  mdblist: mdblistAdapter,
  calibreweb: calibrewebAdapter,
};

export const adapterFor = (cfg: ServiceConfig) => factories[cfg.kind](cfg);

/** Which credential fields each kind uses, so the settings UI can show the right inputs. */
export const credentialFields: Record<ServiceKind, ("apiKey" | "username" | "password")[]> = {
  radarr: ["apiKey"],
  sonarr: ["apiKey"],
  sabnzbd: ["apiKey"],
  qbittorrent: ["username", "password"],
  deluge: ["password"],
  shelfmark: ["username", "password"],
  plex: ["apiKey"],
  jellyfin: ["apiKey"],
  audiobookshelf: ["apiKey"],
  tmdb: ["apiKey"],
  readmeabook: ["apiKey"],
  mdblist: ["apiKey"],
  calibreweb: ["username", "password"],
};

/** Kinds that list library titles for the merge. */
export const MANAGER_KINDS: ServiceKind[] = ["radarr", "sonarr"];
export const SERVER_KINDS: ServiceKind[] = ["plex", "jellyfin", "audiobookshelf"];

/** Headers the image proxy must send to fetch artwork from a service. */
export function imageHeaders(cfg: ServiceConfig): Record<string, string> {
  if (cfg.kind === "plex") return { "X-Plex-Token": cfg.apiKey };
  if (cfg.kind === "jellyfin") return { Authorization: `MediaBrowser Token="${cfg.apiKey}"` };
  if (cfg.kind === "audiobookshelf") return { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.kind === "calibreweb") return { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}` };
  return {};
}

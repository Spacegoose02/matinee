// qBittorrent Web API v2. Auth is a form login that sets an SID cookie; it can be left
// blank when qBittorrent is set to bypass authentication for the local network.
import { ServiceError, fetchChecked, joinUrl } from "../http.js";
import type { DownloadAction, HistoryItem, QueueItem, TorrentInfo, ServiceAdapter, ServiceConfig } from "./types.js";

interface Torrent {
  hash: string; name: string; state: string; progress: number; size: number;
  dlspeed: number; eta: number; category?: string;
  save_path?: string; ratio?: number; downloaded?: number; uploaded?: number; added_on?: number;
}

const sessions = new Map<string, string>();

// After a rejected login, stop retrying for a while: qBittorrent bans an IP after a few failed
// attempts, and the queue is polled every few seconds. Tied to the credentials, so editing them retries.
const BACKOFF_MS = 10 * 60_000;
const failures = new Map<string, { fingerprint: string; until: number; message: string }>();
const ETA_INFINITY = 8_640_000;

const STATE_LABELS: Record<string, string> = {
  downloading: "Downloading", forcedDL: "Downloading", metaDL: "Fetching metadata", forcedMetaDL: "Fetching metadata",
  stalledDL: "Stalled", queuedDL: "Queued", pausedDL: "Paused", stoppedDL: "Paused",
  checkingDL: "Checking", checkingResumeData: "Checking", allocating: "Allocating", moving: "Moving",
  error: "Error", missingFiles: "Missing files",
};

export function qbittorrentAdapter(cfg: ServiceConfig): ServiceAdapter {
  // qBittorrent rejects requests whose Referer/Origin don't match its own address (CSRF protection).
  const origin = new URL(cfg.url).origin;
  const baseHeaders = { Referer: origin + "/", Origin: origin };
  const needsLogin = Boolean(cfg.username || cfg.password);
  const fingerprint = `${cfg.url}|${cfg.username}|${cfg.password}`;

  const recordFailure = (message: string) =>
    failures.set(cfg.id, { fingerprint, until: Date.now() + BACKOFF_MS, message });

  function checkBackoff() {
    const f = failures.get(cfg.id);
    if (f && f.fingerprint === fingerprint && f.until > Date.now()) {
      const minutes = Math.ceil((f.until - Date.now()) / 60_000);
      throw new ServiceError(`${f.message} — not retrying for ${minutes} min (press Test to try again)`);
    }
  }

  async function login(): Promise<string | undefined> {
    if (!needsLogin) return undefined;
    let res: Response;
    try {
      res = await fetchChecked(joinUrl(cfg.url, "/api/v2/auth/login"), {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      });
    } catch (err) {
      // 403 here is the "IP banned" answer; hammering it only prolongs the ban.
      if (err instanceof ServiceError && err.status === 403) recordFailure(err.message);
      throw err;
    }
    // Older versions answer 200 "Ok." / "Fails."; newer ones answer 204 with no body on success.
    const body = (await res.text()).trim();
    if (body && body !== "Ok.") {
      const message = `qBittorrent answered "${body.slice(0, 40)}" — it rejected the username or password (case-sensitive)`;
      recordFailure(message);
      throw new ServiceError(message);
    }
    failures.delete(cfg.id);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    // No cookie can mean qBittorrent skips auth for this address; requests then work without one.
    if (cookie) sessions.set(cfg.id, cookie);
    return cookie;
  }

  async function get(path: string, form?: Record<string, string>): Promise<Response> {
    checkBackoff();
    const url = joinUrl(cfg.url, `/api/v2${path}`);
    const attempt = (cookie?: string) =>
      fetchChecked(url, form
        ? { method: "POST", headers: { ...baseHeaders, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(form) }
        : { headers: { ...baseHeaders, ...(cookie ? { Cookie: cookie } : {}) } });
    const cached = sessions.get(cfg.id);
    try {
      return await attempt(cached);
    } catch (err) {
      // 401/403 usually means the session expired: log in again and retry once.
      if (!(err instanceof ServiceError) || (err.status !== 401 && err.status !== 403)) throw err;
      if (!needsLogin) throw new ServiceError("qBittorrent wants a login — enter the Web UI username and password");
      return attempt(await login());
    }
  }

  return {
    async test({ force = false } = {}) {
      sessions.delete(cfg.id);
      if (force) failures.delete(cfg.id);
      else checkBackoff();
      if (needsLogin) await login();
      const version = (await (await get("/app/version")).text()).trim().replace(/^v/, "");
      return { ok: true, version };
    },

    async history(): Promise<HistoryItem[]> {
      const done = (await (await get("/torrents/info?filter=completed&sort=completion_on&reverse=true&limit=80")).json()) as
        { hash: string; name: string; size: number; completion_on: number; category?: string }[];
      return done
        .filter((t) => t.completion_on > 0)
        .map((t) => ({
          id: `${cfg.id}-${t.hash}`,
          serviceId: cfg.id,
          source: "qbittorrent" as const,
          title: t.name,
          event: "completed" as const,
          at: new Date(t.completion_on * 1000).toISOString(),
          sizeBytes: t.size,
          detail: t.category || undefined,
        }));
    },

    // qBittorrent 5 renamed pause/resume to stop/start; try the new name first, then the old one.
    async control(id: string, action: DownloadAction, opts: { deleteFiles?: boolean; path?: string } = {}): Promise<void> {
      const both = async (names: [string, string], form: Record<string, string>) => {
        try {
          await get(`/torrents/${names[0]}`, form);
        } catch (err) {
          if (err instanceof ServiceError && err.status === 404) await get(`/torrents/${names[1]}`, form);
          else throw err;
        }
      };
      if (action === "pause") return both(["stop", "pause"], { hashes: id });
      if (action === "resume") return both(["start", "resume"], { hashes: id });
      if (action === "remove") {
        await get("/torrents/delete", { hashes: id, deleteFiles: String(opts.deleteFiles === true) });
        return;
      }
      if (action === "set-location") {
        if (!opts.path?.trim()) throw new ServiceError("Give the folder to move it to");
        await get("/torrents/setLocation", { hashes: id, location: opts.path.trim() });
        return;
      }
      throw new ServiceError("qBittorrent can't do that");
    },

    async torrents(): Promise<TorrentInfo[]> {
      const list = (await (await get("/torrents/info")).json()) as Torrent[];
      return list.map((t) => ({
        serviceId: cfg.id,
        id: t.hash,
        name: t.name,
        state: STATE_LABELS[t.state] ?? (t.state.startsWith("up") || t.state === "uploading" || t.state === "forcedUP" ? "Seeding" : t.state === "stalledUP" ? "Seeding (idle)" : t.state === "pausedUP" || t.state === "stoppedUP" ? "Paused (finished)" : t.state),
        paused: t.state.startsWith("paused") || t.state.startsWith("stopped"),
        seeding: t.progress >= 1,
        progress: t.progress,
        sizeBytes: t.size,
        ratio: t.ratio ?? 0,
        downBytes: t.dlspeed,
        upBytes: 0,
        savePath: t.save_path ?? "",
        category: t.category || undefined,
        addedAt: t.added_on ? new Date(t.added_on * 1000).toISOString() : undefined,
      }));
    },

    async queue(): Promise<QueueItem[]> {
      const torrents = (await (await get("/torrents/info")).json()) as Torrent[];
      return (
        torrents
          // Finished torrents that are only seeding are not part of the download queue.
          .filter((t) => t.progress < 1 || t.state === "error" || t.state === "missingFiles")
          .map((t) => ({
            serviceId: cfg.id,
            client: "qbittorrent" as const,
            id: t.hash,
            name: t.name,
            status: STATE_LABELS[t.state] ?? t.state,
            progress: t.progress,
            sizeBytes: t.size,
            etaSeconds: t.eta > 0 && t.eta < ETA_INFINITY ? t.eta : undefined,
            speedBytes: t.dlspeed || undefined,
            category: t.category || undefined,
            controllable: true,
            warning: t.state === "error" || t.state === "missingFiles" ? STATE_LABELS[t.state] : undefined,
          }))
      );
    },
  };
}

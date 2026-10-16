// ReadMeABook: audiobook requests and automation (an Overseerr + Radarr for audiobooks).
// Auth is an API token ("rmab_…", created in its admin settings) sent as a Bearer header. Tokens may only call
// a short allow-list: auth/me, audiobooks/search, requests (GET/POST), and three admin read endpoints.
import { ServiceError, fetchChecked, getJson, joinUrl } from "../http.js";
import type {
  AudiobookRequestInfo, AudiobookResult, HistoryItem, QueueItem, ServiceAdapter, ServiceConfig,
} from "./types.js";

interface RmabBook {
  asin: string; title: string; author: string; narrator?: string; description?: string; coverArtUrl?: string;
  durationMinutes?: number; releaseDate?: string; rating?: number; series?: string; seriesPart?: string;
  availabilityStatus?: "available" | "requested" | "unknown"; isAvailable?: boolean;
}

interface RmabRequest {
  id: string; status: string; progress?: number; errorMessage?: string | null; createdAt: string; updatedAt?: string;
  completedAt?: string | null; type?: string;
  audiobook?: { title: string; author: string; narrator?: string | null; coverArtUrl?: string | null; series?: string | null; seriesPart?: string | null };
  user?: { plexUsername?: string };
}

interface RmabDownload {
  requestId: string; title: string; author?: string; status?: string; type?: string; progress?: number;
  speed?: number; eta?: number | null; torrentName?: string | null; downloadStatus?: string | null; user?: string;
}

const SEARCH_TIMEOUT_MS = 90_000; // searching hits Audible live and can be slow

const CONFLICTS: Record<string, string> = {
  AlreadyAvailable: "That audiobook is already in your library.",
  BeingProcessed: "That audiobook is already being downloaded.",
  DuplicateRequest: "That audiobook has already been requested.",
  Ignored: "That audiobook is on ReadMeABook's ignore list.",
};

/** Covers can be relative (ReadMeABook's own thumbnail cache); those go through Matinee's image proxy. */
const COVER_PROXY_PREFIX = "/api/image?s=";

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function readmeabookAdapter(cfg: ServiceConfig): ServiceAdapter {
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  const api = <T>(path: string, timeoutMs?: number) => getJson<T>(joinUrl(cfg.url, path), headers, timeoutMs);

  const cover = (url?: string | null): string | undefined => {
    if (!url) return undefined;
    return url.startsWith("/") ? `${COVER_PROXY_PREFIX}${cfg.id}&p=${encodeURIComponent(url)}` : url;
  };

  const toBook = (b: RmabBook): AudiobookResult => ({
    serviceId: cfg.id,
    asin: b.asin,
    title: b.title,
    author: b.author,
    narrator: b.narrator,
    description: b.description,
    coverArtUrl: cover(b.coverArtUrl),
    durationMinutes: b.durationMinutes,
    releaseDate: b.releaseDate,
    rating: b.rating,
    series: b.series ? `${b.series}${b.seriesPart ? ` #${b.seriesPart}` : ""}` : undefined,
    availability: b.isAvailable ? "available" : b.availabilityStatus === "requested" ? "requested" : "unknown",
  });

  const toRequest = (r: RmabRequest): AudiobookRequestInfo => ({
    id: r.id,
    serviceId: cfg.id,
    title: r.audiobook?.title ?? "Unknown title",
    author: r.audiobook?.author ?? "",
    narrator: r.audiobook?.narrator ?? undefined,
    coverArtUrl: cover(r.audiobook?.coverArtUrl),
    series: r.audiobook?.series ? `${r.audiobook.series}${r.audiobook.seriesPart ? ` #${r.audiobook.seriesPart}` : ""}` : undefined,
    status: r.status,
    progress: Math.max(0, Math.min(100, r.progress ?? 0)),
    errorMessage: r.errorMessage ?? undefined,
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
    type: r.type === "ebook" ? "ebook" : "audiobook",
    requestedBy: r.user?.plexUsername,
  });

  return {
    async test() {
      const me = await api<{ user?: { username?: string; plexUsername?: string; role?: string } }>("/api/auth/me");
      const name = me.user?.username ?? me.user?.plexUsername;
      return { ok: true, message: name ? `Signed in as ${name}${me.user?.role ? ` (${me.user.role})` : ""}` : undefined };
    },

    async searchAudiobooks(term): Promise<AudiobookResult[]> {
      const res = await api<{ results: RmabBook[] }>(`/api/audiobooks/search?q=${encodeURIComponent(term)}`, SEARCH_TIMEOUT_MS);
      return (res.results ?? []).slice(0, 40).map(toBook);
    },

    // These two endpoints are public (not on the API-token allow-list, so no token is sent). Titles you already
    // have are hidden, which is what a "discover" row wants.
    async audiobookList(list) {
      const path = list === "popular" ? "popular" : "new-releases";
      const res = await getJson<{ audiobooks?: RmabBook[]; message?: string }>(joinUrl(cfg.url, `/api/audiobooks/${path}?limit=24&hideAvailable=true`), {}, SEARCH_TIMEOUT_MS);
      return { items: (res.audiobooks ?? []).map(toBook), message: res.message };
    },

    async requestAudiobook(book): Promise<void> {
      try {
        await fetchChecked(joinUrl(cfg.url, "/api/requests"), {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            audiobook: {
              asin: book.asin, title: book.title, author: book.author, narrator: book.narrator,
              description: book.description, coverArtUrl: book.coverArtUrl, durationMinutes: book.durationMinutes,
              releaseDate: book.releaseDate, rating: book.rating ?? null,
            },
          }),
        }, 60_000);
      } catch (err) {
        // ReadMeABook answers 409 with a named reason; say it in plain words.
        if (err instanceof ServiceError) {
          const named = Object.keys(CONFLICTS).find((k) => err.message.includes(k));
          if (named) throw new ServiceError(CONFLICTS[named], err.status);
        }
        throw err;
      }
    },

    async audiobookRequests(): Promise<AudiobookRequestInfo[]> {
      const res = await api<{ requests: RmabRequest[] }>("/api/requests?take=100");
      return res.requests.map(toRequest);
    },

    async queue(): Promise<QueueItem[]> {
      try {
        const res = await api<{ downloads: RmabDownload[] }>("/api/admin/downloads/active");
        return (res.downloads ?? []).map((d) => ({
          serviceId: cfg.id,
          client: "readmeabook" as const,
          id: d.requestId,
          name: [d.title, d.author].filter(Boolean).join(" — "),
          status: titleCase(d.downloadStatus ?? d.status ?? "downloading"),
          progress: Math.max(0, Math.min(1, (d.progress ?? 0) / 100)),
          etaSeconds: d.eta && d.eta > 0 ? d.eta : undefined,
          speedBytes: d.speed || undefined,
          category: d.type === "ebook" ? "ebooks" : "audiobooks",
        }));
      } catch (err) {
        // Only admin tokens may read active downloads; a normal token still works for requests.
        if (err instanceof ServiceError && (err.status === 401 || err.status === 403)) return [];
        throw err;
      }
    },

    async history(): Promise<HistoryItem[]> {
      const res = await api<{ requests: RmabRequest[] }>("/api/requests?take=60");
      return res.requests.map((r): HistoryItem => {
        const req = toRequest(r);
        const done = r.status === "available" || r.status === "downloaded";
        const failed = r.status === "failed" || r.status === "cancelled" || r.status === "denied";
        return {
          id: `${cfg.id}-${r.id}`,
          serviceId: cfg.id,
          source: "readmeabook",
          title: [req.title, req.author].filter(Boolean).join(" — "),
          event: done ? "completed" : failed ? "failed" : "requested",
          at: (done ? r.completedAt : undefined) ?? r.updatedAt ?? r.createdAt,
          detail: failed ? r.errorMessage ?? titleCase(r.status) : done ? req.series : `${titleCase(r.status)}${r.status === "downloading" ? ` ${req.progress}%` : ""}`,
        };
      });
    },
  };
}

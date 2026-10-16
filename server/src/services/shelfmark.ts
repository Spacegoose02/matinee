// Shelfmark (formerly calibre-web-automated-book-downloader). Its /api/status groups
// books by state. Not yet verified against a live instance, so parsing is tolerant.
import { ServiceError, getJson, joinUrl, postJson } from "../http.js";
import type { BookItem, QueueItem, ServiceAdapter, ServiceConfig } from "./types.js";

type Book = { id?: string; title?: string; author?: string; progress?: number };
type Status = Record<string, Record<string, Book> | Book[] | undefined>;

interface Release {
  source: string; source_id: string; title: string; format?: string; size?: string; size_bytes?: number | null;
  download_url?: string; protocol?: string; indexer?: string; seeders?: number | null; language?: string | null;
  extra?: Record<string, unknown>;
}

// Search results are remembered for a while so a click on Download can send Shelfmark the complete record.
const seen = new Map<string, { at: number; release: Release }>();
const TTL_MS = 30 * 60_000;

const ACTIVE_STATES = ["queued", "downloading", "error"];

export function shelfmarkAdapter(cfg: ServiceConfig): ServiceAdapter {
  const headers: Record<string, string> = {};
  if (cfg.username || cfg.password) {
    headers.Authorization = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  }
  const status = () => getJson<Status>(joinUrl(cfg.url, "/api/status"), headers);

  return {
    // Direct-download search: Shelfmark looks the title up with its enabled sources and answers with the files it could fetch.
    // (Verified against a live Shelfmark: GET /api/releases?source=direct_download&query=...)
    async searchBooks(term: string): Promise<BookItem[]> {
      const res = await getJson<{ releases?: Release[] }>(
        joinUrl(cfg.url, `/api/releases?source=direct_download&query=${encodeURIComponent(term)}`),
        headers,
        90_000,
      );
      const now = Date.now();
      for (const [k, v] of seen) if (now - v.at > TTL_MS) seen.delete(k);
      return (res.releases ?? []).slice(0, 60).map((r) => {
        seen.set(`${cfg.id}:${r.source_id}`, { at: now, release: r });
        const x = r.extra ?? {};
        return {
          id: r.source_id,
          title: r.title,
          author: typeof x.author === "string" ? x.author : undefined,
          year: typeof x.year === "string" ? x.year : undefined,
          format: r.format,
          size: r.size,
          cover: typeof x.preview === "string" ? (x.preview.startsWith("/") ? `/api/image?s=${cfg.id}&p=${encodeURIComponent(x.preview)}` : x.preview) : undefined,
          summary: [typeof x.publisher === "string" ? x.publisher : undefined, r.language].filter(Boolean).join(" · ") || undefined,
          language: r.language ?? undefined,
        };
      });
    },

    // Queue a file Shelfmark found. It is rebuilt from the search result Matinee remembered, so only an id comes from the page.
    async requestBook(id: string): Promise<void> {
      const hit = seen.get(`${cfg.id}:${id}`);
      if (!hit) throw new ServiceError("That result has expired. Search again, then press Download.");
      const r = hit.release;
      const x = r.extra ?? {};
      await postJson(joinUrl(cfg.url, "/api/releases/download"), {
        source: r.source, source_id: r.source_id, title: r.title,
        author: typeof x.author === "string" ? x.author : "",
        year: typeof x.year === "string" ? x.year : undefined,
        format: r.format, size: r.size, size_bytes: r.size_bytes,
        download_url: r.download_url, protocol: r.protocol, indexer: r.indexer, seeders: r.seeders,
        extra: r.extra, preview: typeof x.preview === "string" ? x.preview : undefined,
        content_type: "ebook", language: r.language ?? undefined,
      }, headers);
    },

    async test() {
      await status();
      return { ok: true };
    },

    async queue(): Promise<QueueItem[]> {
      const s = await status();
      return ACTIVE_STATES.flatMap((state) => {
        const group = s[state];
        const books = Array.isArray(group) ? group : Object.entries(group ?? {}).map(([id, b]) => ({ ...b, id: b.id ?? id }));
        return books.map((b, i) => ({
          serviceId: cfg.id,
          client: "shelfmark" as const,
          id: b.id ?? `${state}-${i}`,
          name: [b.title, b.author].filter(Boolean).join(" — ") || "Unknown book",
          status: state[0].toUpperCase() + state.slice(1),
          progress: typeof b.progress === "number" ? (b.progress > 1 ? b.progress / 100 : b.progress) : 0,
          category: "books",
          warning: state === "error" ? "Download failed" : undefined,
        }));
      });
    },
  };
}

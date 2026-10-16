// Calibre-Web / Calibre-Web Automated, read through its OPDS feed (the standard ebook catalogue format).
// Sign-in is HTTP Basic with the same username and password used on its login page.
import { ServiceError, fetchChecked, joinUrl } from "../http.js";
import type { BookItem, ServiceAdapter, ServiceConfig } from "./types.js";

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();

const tagText = (tag: string, xml: string) => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decode(m[1]) : undefined;
};

const attr = (attrs: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];

export function calibrewebAdapter(cfg: ServiceConfig): ServiceAdapter {
  const auth: Record<string, string> = cfg.username || cfg.password ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}` } : {};
  const feed = async (path: string) => {
    const res = await fetchChecked(joinUrl(cfg.url, path), { headers: { ...auth, Accept: "application/atom+xml" } });
    const text = await res.text();
    if (!text.includes("<feed")) throw new ServiceError("That address didn't answer with an OPDS feed. Check the URL, and that OPDS is switched on in Calibre-Web's admin settings");
    return text;
  };
  const origin = new URL(cfg.url).origin;

  return {
    async test() {
      await feed("/opds");
      return { ok: true };
    },

    async recentBooks(limit = 40): Promise<BookItem[]> {
      return parse(await feed("/opds/new"), limit);
    },

    async searchBooks(term: string): Promise<BookItem[]> {
      return parse(await feed(`/opds/search/${encodeURIComponent(term)}`), 60);
    },
  };

  function parse(xml: string, limit: number): BookItem[] {
    {
      return xml
        .split("<entry>")
        .slice(1)
        .map((e) => e.split("</entry>")[0])
        .slice(0, limit)
        .flatMap((e): BookItem[] => {
          const title = tagText("title", e);
          if (!title) return [];
          const links = [...e.matchAll(/<link\b([^>]*?)\/?>/g)].map((m) => ({ rel: attr(m[1], "rel") ?? "", href: attr(m[1], "href") ?? "" }));
          const thumb = links.find((l) => l.rel.endsWith("/image/thumbnail")) ?? links.find((l) => l.rel.endsWith("/image"));
          const bookId = /\/cover\/(\d+)/.exec(thumb?.href ?? "")?.[1] ?? /\/book\/(\d+)/.exec(links.map((l) => l.href).join(" "))?.[1];
          const authorBlock = /<author>([\s\S]*?)<\/author>/.exec(e)?.[1] ?? "";
          const href = thumb?.href ? decode(thumb.href) : undefined;
          return [{
            id: bookId ?? title,
            title,
            author: tagText("name", authorBlock),
            summary: tagText("content", e) ?? tagText("summary", e),
            cover: href ? `/api/image?s=${cfg.id}&p=${encodeURIComponent(href.startsWith("http") ? new URL(href).pathname : href)}` : undefined,
            url: bookId ? `${origin}/book/${bookId}` : undefined,
          }];
        });
    }
  }
}

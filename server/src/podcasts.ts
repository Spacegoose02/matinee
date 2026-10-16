// Podcast charts come from Apple's public chart feed (no key needed). It is the same kind of chart data that
// sites like Podtail and Amazon Music show, and unlike them it can be read by a program.
import { fetchChecked, request } from "./http.js";
import { ServiceError } from "./http.js";
import type { PodcastItem } from "./services/types.js";

export const PODCAST_GENRES: { id: string; label: string }[] = [
  { id: "all", label: "All categories" },
  { id: "1488", label: "True Crime" },
  { id: "1303", label: "Comedy" },
  { id: "1489", label: "News" },
  { id: "1324", label: "Society & Culture" },
  { id: "1318", label: "Technology" },
  { id: "1321", label: "Business" },
  { id: "1512", label: "Health & Fitness" },
  { id: "1487", label: "History" },
  { id: "1304", label: "Education" },
  { id: "1533", label: "Science" },
  { id: "1545", label: "Sports" },
  { id: "1309", label: "TV & Film" },
  { id: "1305", label: "Kids & Family" },
  { id: "1310", label: "Music" },
  { id: "1301", label: "Arts" },
  { id: "1483", label: "Fiction" },
  { id: "1502", label: "Leisure" },
  { id: "1314", label: "Religion & Spirituality" },
  { id: "1511", label: "Government" },
];

const COUNTRY = process.env.PODCAST_COUNTRY ?? "us";

interface Label { label: string }
interface ChartEntry {
  "im:name": Label;
  "im:artist"?: Label;
  "im:image"?: Label[];
  summary?: Label;
  category?: { attributes?: { label?: string } };
  link?: { attributes?: { href?: string } };
  id: { attributes: { "im:id": string } };
}

const cache = new Map<string, { at: number; items: PodcastItem[] }>();
const TTL_MS = 60 * 60_000;

export async function topPodcasts(genre: string): Promise<PodcastItem[]> {
  const cached = cache.get(genre);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.items;
  const genrePart = genre === "all" ? "" : `/genre=${genre}`;
  const url = `https://itunes.apple.com/${COUNTRY}/rss/toppodcasts/limit=24${genrePart}/json`;
  try {
    const { data } = await request<{ feed?: { entry?: ChartEntry[] | ChartEntry } }>(url);
    const raw = data.feed?.entry ?? [];
    const entries = Array.isArray(raw) ? raw : [raw];
    const items = entries.map((e): PodcastItem => ({
      itunesId: e.id.attributes["im:id"],
      title: e["im:name"].label,
      artist: e["im:artist"]?.label ?? "",
      // The largest artwork Apple lists is small (170px); ask the CDN for a sharper one.
      image: e["im:image"]?.at(-1)?.label.replace(/\/\d+x\d+bb\./, "/300x300bb."),
      summary: e.summary?.label,
      genre: e.category?.attributes?.label,
      url: e.link?.attributes?.href,
    }));
    cache.set(genre, { at: Date.now(), items });
    return items;
  } catch (err) {
    if (cached) return cached.items; // an old chart beats an error
    throw err;
  }
}

/** The public RSS feed address for a podcast, which is what a podcast app (Audiobookshelf) subscribes to. */
export async function lookupFeed(itunesId: string): Promise<{ feedUrl: string; title: string }> {
  if (!/^\d+$/.test(itunesId)) throw new ServiceError("Not a valid podcast id");
  const res = await fetchChecked(`https://itunes.apple.com/lookup?id=${itunesId}&entity=podcast`);
  const body = (await res.json()) as { results?: { feedUrl?: string; collectionName?: string }[] };
  const hit = body.results?.[0];
  if (!hit?.feedUrl) throw new ServiceError("That podcast doesn't publish a public feed, so it can't be added.");
  return { feedUrl: hit.feedUrl, title: hit.collectionName ?? "Podcast" };
}

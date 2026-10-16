import type { ListKind } from "./api";

export const LIST_KINDS: ListKind[] = ["trending", "popular", "upcoming", "now", "top_rated"];

export const LIST_TITLES: Record<ListKind, { movie: string; series: string; chip: string; sub: string }> = {
  trending: { movie: "Trending movies", series: "Trending shows", chip: "Trending", sub: "This week on TMDB" },
  popular: { movie: "Popular movies", series: "Popular shows", chip: "Popular", sub: "Most popular right now on TMDB" },
  upcoming: { movie: "Coming soon to theaters", series: "New shows coming soon", chip: "Coming soon", sub: "Release dates from TMDB" },
  now: { movie: "In theaters now", series: "On the air now", chip: "Now playing", sub: "Currently showing on TMDB" },
  top_rated: { movie: "Top rated movies", series: "Top rated shows", chip: "Top rated", sub: "Highest rated on TMDB" },
};

/** Apple Podcasts chart categories (ids are Apple's genre ids). */
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

export const genreLabel = (id: string) => PODCAST_GENRES.find((g) => g.id === id)?.label ?? "All categories";

export function formatReleaseDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

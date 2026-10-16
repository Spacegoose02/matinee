import { useEffect, useMemo, useState } from "react";
import { api, type ExternalIds, type ListKind, type MediaItem, type SearchResult, type ServiceError } from "../api";
import { AddModal } from "../components/AddModal";
import { AudiobookResults } from "../components/AudiobookResults";
import { Poster } from "../components/Cards";
import { ErrorList } from "../components/ErrorList";
import { Icon } from "../components/Icons";
import { AudiobookListShelf } from "../components/AudiobookResults";
import { PodcastShelf } from "../components/PodcastShelf";
import { TrendingShelf } from "../components/Trending";
import { LIST_KINDS, LIST_TITLES } from "../lists";
import { useStore } from "../store";

const SEARCH_DELAY_MS = 450;

/** One title, merged across every Radarr/Sonarr that returned it. */
export interface DiscoverGroup extends Omit<SearchResult, "serviceId" | "inLibrary"> {
  key: string;
  entries: { serviceId: string; inLibrary: boolean }[];
}

export function groupResults(results: SearchResult[]): DiscoverGroup[] {
  const map = new Map<string, DiscoverGroup>();
  for (const r of results) {
    const id = r.ids.tmdb ?? r.ids.tvdb ?? r.ids.imdb ?? r.title;
    const key = `${r.type}:${id}`;
    const entry = { serviceId: r.serviceId, inLibrary: r.inLibrary };
    const existing = map.get(key);
    if (existing) existing.entries.push(entry);
    else {
      const { serviceId: _s, inLibrary: _i, ...rest } = r;
      map.set(key, { ...rest, key, entries: [entry] });
    }
  }
  return [...map.values()];
}

/** The local library entry for a found title, so "In library" cards can open its details. */
function localMatch(items: MediaItem[], g: { type: string; ids: ExternalIds }): MediaItem | undefined {
  return items.find(
    (i) => i.type === g.type && ((g.ids.tmdb && i.ids.tmdb === g.ids.tmdb) || (g.ids.tvdb && i.ids.tvdb === g.ids.tvdb)),
  );
}

export function Discover({ initialQuery = "" }: { initialQuery?: string }) {
  const { services, items, openItem, reload, toast } = useStore();
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState<"all" | "movie" | "series" | "book">("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errors, setErrors] = useState<ServiceError[]>([]);
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<DiscoverGroup>();
  // Titles added during this visit, so their cards flip to "Added" without another search.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [list, setList] = useState<ListKind>("trending");

  const managers = Object.values(services).filter((s) => s.enabled && (s.kind === "radarr" || s.kind === "sonarr"));
  const hasAudiobooks = Object.values(services).some((s) => s.enabled && s.kind === "readmeabook");
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setResults([]);
      setErrors([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.search(term);
        if (cancelled) return;
        setResults(res.items);
        setErrors(res.errors);
        setFailure(undefined);
      } catch (err) {
        if (!cancelled) setFailure((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const groups = useMemo(() => groupResults(results).filter((g) => type === "all" || g.type === type), [results, type]);
  const showVideo = type !== "book";

  const closeModal = () => {
    setPicked(undefined);
    // Pick up the newly added title(s) in the library once the dialog is closed.
    if (dirty) {
      setDirty(false);
      reload(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Discover</h1>
          <span className="muted">{hasAudiobooks ? "Search movies, shows and audiobooks, then send them to Radarr, Sonarr or ReadMeABook to download." : "Search movies and shows, then send them to Radarr or Sonarr to download."}</span>
        </div>
      </div>

      <div className="discover-bar">
        <label className="search big">
          <Icon name="search" size={20} />
          <input
            autoFocus
            type="search"
            placeholder="Search for a movie or show…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="segmented">
          {(["all", "movie", "series", ...(hasAudiobooks ? (["book"] as const) : [])] as const).map((t) => (
            <button key={t} className={type === t ? "active" : undefined} onClick={() => setType(t)}>
              {t === "all" ? "All" : t === "movie" ? "Movies" : t === "series" ? "Shows" : "Audiobooks"}
            </button>
          ))}
        </div>
      </div>

      {managers.length === 0 && !hasAudiobooks && (
        <p className="notice error">
          Connect Radarr (movies) and/or Sonarr (shows) first — <a className="link" href="#/settings">open Settings</a>.
        </p>
      )}
      {failure && <p className="notice error">Search failed: {failure}</p>}
      <ErrorList errors={errors} />

      {term.length < 2 ? (
        <>
          <div className="list-picker">
            <div className="segmented wrap">
              {LIST_KINDS.map((k) => (
                <button key={k} className={list === k ? "active" : undefined} onClick={() => setList(k)}>{LIST_TITLES[k].chip}</button>
              ))}
            </div>
          </div>
          <TrendingShelf type="movie" list={list} order={0} />
          <TrendingShelf type="series" list={list} order={1} />
          {hasAudiobooks && <AudiobookListShelf list="new" order={2} />}
          {hasAudiobooks && <AudiobookListShelf list="popular" order={3} />}
          <PodcastShelf selectable order={4} />
          <div className="empty-card">
            <Icon name="search" size={28} />
            <p>Find something to watch</p>
            <span className="muted small">
              Results come from Radarr and Sonarr's own lookup, so anything they can add shows up here.
              {!Object.values(services).some((s) => s.kind === "tmdb") && <> Connect TMDB under <a className="link" href="#/settings">Settings</a> to see what's trending.</>}
            </span>
          </div>
        </>
      ) : !showVideo ? null : groups.length === 0 ? (
        <p className="muted empty-line">{loading ? "Searching…" : hasAudiobooks ? `No movies or shows found for “${term}”.` : `Nothing found for “${term}”.`}</p>
      ) : (
        <div className={`grid ${loading ? "dim" : ""}`}>
          {groups.map((g) => {
            const local = localMatch(items, g);
            const inLibrary = added.has(g.key) || g.entries.every((e) => e.inLibrary);
            return (
              <button
                key={g.key}
                className="card"
                title={g.title}
                onClick={() => {
                  if (!inLibrary) return setPicked(g);
                  if (local) return openItem(local.key);
                  // In Radarr/Sonarr but not in our copy of the library yet: pull a fresh one.
                  toast("It's already in Radarr/Sonarr — refreshing the library so you can open it.");
                  reload(true);
                }}
              >
                <Poster src={g.poster} title={g.title} />
                {inLibrary ? (
                  <span className="tag tag-status ok">{added.has(g.key) ? "Added" : "In library"}</span>
                ) : (
                  <span className="tag tag-add"><Icon name="plus" size={12} /> Add</span>
                )}
                <span className="card-meta">
                  <span className="card-title">{g.title}</span>
                  <span className="card-sub">
                    {g.year ?? "—"} · {g.type === "movie" ? "Movie" : g.seasons ? `${g.seasons} season${g.seasons === 1 ? "" : "s"}` : "Show"}
                    {g.rating ? ` · ★ ${g.rating.toFixed(1)}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {hasAudiobooks && (type === "all" || type === "book") && <AudiobookResults term={term} />}

      {picked && (
        <AddModal
          group={picked}
          onClose={closeModal}
          onAdded={() => {
            setAdded((s) => new Set(s).add(picked.key));
            setDirty(true);
          }}
        />
      )}
    </div>
  );
}

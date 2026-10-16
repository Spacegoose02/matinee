import { useEffect, useMemo, useState } from "react";
import { api, type ListKind, type MediaItem, type TrendingItem } from "../api";
import { LIST_TITLES, formatReleaseDate } from "../lists";
import type { DiscoverGroup } from "../pages/Discover";
import { useStore } from "../store";
import { AddModal } from "./AddModal";
import { Poster } from "./Cards";
import { Icon } from "./Icons";
import { Shelf } from "./Shelf";

const normalize = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Finds our copy of a trending title, by TMDB id first and by name and year otherwise. */
function useLibraryMatcher() {
  const { items } = useStore();
  return useMemo(() => {
    const byTmdb = new Map<string, MediaItem>();
    const byName = new Map<string, MediaItem>();
    for (const i of items) {
      if (i.ids.tmdb) byTmdb.set(`${i.type}:${i.ids.tmdb}`, i);
      if (i.year) byName.set(`${i.type}:${normalize(i.title)}:${i.year}`, i);
    }
    return (t: TrendingItem) =>
      (t.ids.tmdb && byTmdb.get(`${t.type}:${t.ids.tmdb}`)) || (t.year ? byName.get(`${t.type}:${normalize(t.title)}:${t.year}`) : undefined);
  }, [items]);
}

function useTrending(type: "movie" | "series", list: ListKind, custom?: { id: string }, full = false) {
  const [state, setState] = useState<{ loading: boolean; configured?: boolean; items: TrendingItem[]; error?: string; hasMore?: boolean; loadingMore?: boolean }>({ loading: true, items: [] });
  const [pages, setPages] = useState(1);
  const { services } = useStore();
  // Refetch when TMDB gets connected or changed, not on every render.
  const tmdbKey = Object.values(services).filter((s) => s.kind === "tmdb" && s.enabled).map((s) => s.id).join(",");

  useEffect(() => {
    let cancelled = false;
    setPages(1);
    setState((s) => ({ ...s, loading: true, items: [] }));
    (custom ? api.mdblistItems(custom.id, full, 0) : api.trending(type, list, full, 1)).then(
      (r) => !cancelled && setState({ loading: false, configured: r.configured, items: r.items, hasMore: r.hasMore }),
      (err) => !cancelled && setState({ loading: false, items: [], error: (err as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [type, list, tmdbKey, custom?.id, full]);

  // Whole-list pages keep going until the source runs out; each press brings the next batch.
  const more = () => {
    if (!state.hasMore || state.loadingMore) return;
    const next = pages + 1;
    setState((s) => ({ ...s, loadingMore: true }));
    (custom ? api.mdblistItems(custom.id, full, pages * 100) : api.trending(type, list, full, next)).then(
      (r) => {
        setPages(next);
        setState((s) => {
          const seen = new Set(s.items.map((t) => `${t.type}:${t.ids.tmdb ?? t.title}`));
          return { ...s, loadingMore: false, hasMore: r.hasMore, items: [...s.items, ...r.items.filter((t) => !seen.has(`${t.type}:${t.ids.tmdb ?? t.title}`))] };
        });
      },
      (err) => setState((s) => ({ ...s, loadingMore: false, hasMore: false, error: (err as Error).message })),
    );
  };

  return { ...state, more };
}

/** A row of what is trending this week: open it if we have it, add it if we don't. */
export function TrendingShelf({ type, list = "trending", order, custom, full = false }: { type: "movie" | "series"; list?: ListKind; order?: number; custom?: { id: string; name: string }; full?: boolean }) {
  const { services, openItem, reload, toast } = useStore();
  const { items: all, error, configured, loading, hasMore, loadingMore, more } = useTrending(type, list, custom, full);
  const [filter, setFilter] = useState("");
  const items = full && filter.trim() ? all.filter((t) => t.title.toLowerCase().includes(filter.trim().toLowerCase())) : all;
  const matchOf = useLibraryMatcher();
  const [picked, setPicked] = useState<DiscoverGroup>();
  const [dirty, setDirty] = useState(false);

  if (loading || (!configured && !error)) return null;
  if (error) return <p className="notice error">Couldn't load trending {type === "movie" ? "movies" : "shows"}: {error}</p>;
  if (all.length === 0) return full ? <p className="muted">Nothing in this list.</p> : null;
  const seeAll = `#/list/${encodeURIComponent(custom ? `mdb:${custom.id}:${custom.name}` : `tmdb:${list}:${type}`)}`;
  const Wrap = full ? FullWrap : Shelf;

  const managersFor = (t: "movie" | "series") => Object.values(services).filter((s) => s.enabled && s.kind === (t === "movie" ? "radarr" : "sonarr"));

  const choose = (t: TrendingItem, local?: MediaItem) => {
    if (local) return openItem(local.key);
    const managers = managersFor(t.type);
    if (managers.length === 0) return toast(`Connect ${t.type === "movie" ? "Radarr" : "Sonarr"} to add ${t.type === "movie" ? "movies" : "shows"} from here.`, "error");
    setPicked({
      key: `${t.type}:${t.ids.tmdb}`,
      type: t.type,
      title: t.title,
      year: t.year,
      ids: t.ids,
      overview: t.overview,
      poster: t.poster,
      rating: t.rating,
      entries: managers.map((s) => ({ serviceId: s.id, inLibrary: false })),
    });
  };

  return (
    <>
      <Wrap
        order={order}
        title={custom ? custom.name : LIST_TITLES[list][type]}
        subtitle={custom ? "From MDBList" : LIST_TITLES[list].sub}
        actions={full ? <input type="search" placeholder="Filter this list" value={filter} onChange={(e) => setFilter(e.target.value)} /> : <><a className="link" href={seeAll}>See all</a><a className="link" href="#/discover">Search to add</a></>}
      >
        {items.map((t) => {
          const local = matchOf(t);
          return (
            <button key={t.ids.tmdb} className="card" title={t.title} onClick={() => choose(t, local)}>
              <Poster src={t.poster} title={t.title} />
              {local ? (
                <span className="tag tag-status ok">In library</span>
              ) : (
                <span className="tag tag-add"><Icon name="plus" size={12} /> Add</span>
              )}
              <span className="card-meta">
                <span className="card-title">{t.title}</span>
                <span className="card-sub">
                  {list === "upcoming" ? formatReleaseDate(t.releaseDate) ?? t.year ?? "—" : t.year ?? "—"}
                  {list !== "upcoming" && t.rating ? ` · ★ ${t.rating.toFixed(1)}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </Wrap>
      {full && (
        <div className="more">
          <span className="muted small">{all.length.toLocaleString()} titles{hasMore ? " so far" : " · that's the whole list"}</span>
          {hasMore && <button className="btn" disabled={loadingMore} onClick={more}>{loadingMore ? "Loading…" : "Load more"}</button>}
        </div>
      )}
      {picked && (
        <AddModal
          group={picked}
          onClose={() => {
            setPicked(undefined);
            if (dirty) {
              setDirty(false);
              reload(false);
            }
          }}
          onAdded={() => setDirty(true)}
        />
      )}
    </>
  );
}

/** The same header as a shelf, but the titles wrap onto a grid so the whole list can be browsed. */
function FullWrap({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; order?: number }) {
  return (
    <section className="shelf-full">
      <header className="shelf-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <span className="muted small">{subtitle}</span>}
        </div>
        <div className="shelf-actions">{actions}</div>
      </header>
      <div className="grid">{children}</div>
    </section>
  );
}

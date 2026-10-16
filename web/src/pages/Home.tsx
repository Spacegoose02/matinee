import { useEffect, useMemo, useState } from "react";
import {
  KIND_LABELS, api, formatBytes, formatEta, statusOf, type HomeSection, type ListKind, type MediaItem, type MediaType, type SectionKind,
} from "../api";
import { Card, CollectionCard } from "../components/Cards";
import { ErrorList } from "../components/ErrorList";
import { Hero } from "../components/Hero";
import { Icon } from "../components/Icons";
import { Shelf } from "../components/Shelf";
import { AudiobookListShelf } from "../components/AudiobookResults";
import { PodcastShelf } from "../components/PodcastShelf";
import { BookShelf } from "../components/BookShelf";
import { TrendingShelf } from "../components/Trending";
import { LIST_KINDS, LIST_TITLES, PODCAST_GENRES, genreLabel } from "../lists";
import { inLibrary, useQueue, useStore } from "../store";

const FEATURED_COUNT = 6;
const SHELF_SIZE = 24;
const COLLECTION_SHELF_SIZE = 40;

const TYPE_TITLES: Record<MediaType | "all", string> = {
  all: "Recently added",
  movie: "New movies",
  series: "New shows",
  book: "New audiobooks",
};

const TMDB_HINT_KEY = "matinee.hideTmdbHint";
const LISTS_ADDED_KEY = "matinee.listsAdded";
const TRENDING_ADDED_KEY = "matinee.trendingAdded";

const section = (kind: SectionKind, ref?: string): HomeSection => ({ id: `${kind}:${ref ?? ""}`, kind, ref, visible: true });

const newestFirst = (a: MediaItem, b: MediaItem) => (a.added ?? "") < (b.added ?? "") ? 1 : (a.added ?? "") > (b.added ?? "") ? -1 : 0;

export function Home() {
  const { items, collections, libraries, libraryHref, errors, byKey, home, saveHome, loading, failure, services } = useStore();
  const hasTmdb = Object.values(services).some((s) => s.kind === "tmdb" && s.enabled);
  const hasRmab = Object.values(services).some((s) => s.kind === "readmeabook" && s.enabled);
  const hasCalibre = Object.values(services).some((s) => s.kind === "calibreweb" && s.enabled);
  const hasMdb = Object.values(services).some((s) => s.kind === "mdblist" && s.enabled);
  const [mdbLists, setMdbLists] = useState<{ id: string; name: string }[]>([]);
  const [mdbUrl, setMdbUrl] = useState("");
  const [mdbError, setMdbError] = useState<string>();
  useEffect(() => {
    if (!hasMdb) return;
    Promise.all([api.mdblistLists({ scope: "mine" }), api.mdblistLists({ scope: "top" })]).then(
      ([mine, top]) => setMdbLists([...mine.lists, ...top.lists.filter((t) => !mine.lists.some((m) => m.id === t.id))]),
      () => {},
    );
  }, [hasMdb]);
  const [hintHidden, setHintHidden] = useState(() => {
    try {
      return localStorage.getItem(TMDB_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const queue = useQueue();
  const [editing, setEditing] = useState(false);

  // Sorted once per library load; every shelf then just walks it until it has enough titles.
  const recent = useMemo(() => [...items].sort(newestFirst), [items]);
  const takeRecent = (pred: (i: MediaItem) => boolean, n = SHELF_SIZE) => {
    const out: MediaItem[] = [];
    for (const i of recent) {
      if (pred(i)) out.push(i);
      if (out.length === n) break;
    }
    return out;
  };

  const sections = useMemo<HomeSection[]>(
    () =>
      home.sections ?? [
        section("trending", "movie"),
        section("trending", "series"),
        section("list", "upcoming:movie"),
        section("audiobooks", "new"),
        section("audiobooks", "popular"),
        section("ebooks", "new"),
        section("podcasts", "all"),
        section("recent", "movie"),
        section("recent", "series"),
        section("collections"),
        section("downloading"),
        section("attention"),
        ...libraries.map((l) => section("library", l.name)),
      ],
    [home.sections, libraries],
  );

  // People who already customised their layout get the trending rows added once (they can remove them again).
  useEffect(() => {
    if (loading || !home.sections || home.sections.some((s) => s.kind === "trending")) return;
    try {
      if (localStorage.getItem(TRENDING_ADDED_KEY)) return;
      localStorage.setItem(TRENDING_ADDED_KEY, "1");
    } catch {
      return;
    }
    saveHome({ ...home, sections: [section("trending", "movie"), section("trending", "series"), ...home.sections] });
  }, [loading, home, saveHome]);

  useEffect(() => {
    if (loading || !home.sections || home.sections.some((s) => s.kind === "list" || s.kind === "audiobooks" || s.kind === "podcasts")) return;
    try {
      if (localStorage.getItem(LISTS_ADDED_KEY)) return;
      localStorage.setItem(LISTS_ADDED_KEY, "1");
    } catch {
      return;
    }
    const fresh = [section("list", "upcoming:movie"), section("audiobooks", "new"), section("audiobooks", "popular"), section("podcasts", "all")];
    const lastTrending = home.sections.map((s) => s.kind).lastIndexOf("trending");
    const next = [...home.sections];
    next.splice(lastTrending + 1, 0, ...fresh);
    saveHome({ ...home, sections: next });
  }, [loading, home, saveHome]);

  // Layouts saved before Calibre-Web was connected get the books row once, when it first is.
  useEffect(() => {
    if (loading || !hasCalibre || !home.sections || home.sections.some((s) => s.kind === "ebooks")) return;
    try {
      if (localStorage.getItem("matinee.booksAdded")) return;
      localStorage.setItem("matinee.booksAdded", "1");
    } catch {
      return;
    }
    const next = [...home.sections];
    const at = next.map((s) => s.kind).lastIndexOf("audiobooks");
    next.splice(at + 1, 0, section("ebooks", "new"));
    saveHome({ ...home, sections: next });
  }, [loading, hasCalibre, home, saveHome]);

  const featured = useMemo(() => {
    const pinned = home.pinned.map((k) => byKey.get(k)).filter((i): i is MediaItem => Boolean(i));
    const fill = recent.filter((i) => i.type !== "book" && i.backdrop && i.available.length > 0 && !home.pinned.includes(i.key));
    return [...pinned, ...fill].slice(0, FEATURED_COUNT);
  }, [recent, byKey, home.pinned]);

  const biggestCollections = useMemo(
    () => [...collections].sort((a, b) => b.memberKeys.length - a.memberKeys.length).slice(0, COLLECTION_SHELF_SIZE),
    [collections],
  );

  if (failure) return <p className="notice error">Can't reach the server: {failure}</p>;
  if (loading && items.length === 0) return <div className="skeleton-hero" aria-label="Loading" />;
  if (items.length === 0) {
    return (
      <div className="empty">
        <h1>Nothing here yet</h1>
        <p className="muted">Connect Radarr, Sonarr, Plex or Jellyfin and your library will fill this page.</p>
        <ErrorList errors={errors} />
        <a className="btn primary" href="#/settings">Connect services</a>
      </div>
    );
  }

  const update = (next: HomeSection[]) => saveHome({ ...home, sections: next });
  const move = (i: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const patch = (i: number, p: Partial<HomeSection>) => update(sections.map((s, n) => (n === i ? { ...s, ...p } : s)));
  const remove = (i: number) => update(sections.filter((_, n) => n !== i));
  const add = (s: HomeSection) => update([...sections.filter((x) => x.id !== s.id), s]);

  const addOptions: { label: string; make: () => HomeSection }[] = [
    { label: "Recently added (everything)", make: () => section("recent", "all") },
    { label: "New movies", make: () => section("recent", "movie") },
    { label: "New shows", make: () => section("recent", "series") },
    { label: "New audiobooks", make: () => section("recent", "book") },
    { label: "Trending movies", make: () => section("trending", "movie") },
    { label: "Trending shows", make: () => section("trending", "series") },
    ...LIST_KINDS.filter((k) => k !== "trending").flatMap((k) => [
      { label: LIST_TITLES[k].movie, make: () => section("list", `${k}:movie`) },
      { label: LIST_TITLES[k].series, make: () => section("list", `${k}:series`) },
    ]),
    ...(hasCalibre ? [{ label: "New books (Calibre-Web)", make: () => section("ebooks", "new") }] : []),
    ...mdbLists.map((l) => ({ label: `MDBList: ${l.name}`, make: () => section("mdblist", `${l.id}:${l.name}`) })),
    ...(hasRmab ? [
      { label: "New audiobook releases", make: () => section("audiobooks", "new") },
      { label: "Popular audiobooks", make: () => section("audiobooks", "popular") },
    ] : []),
    ...PODCAST_GENRES.map((g) => ({ label: g.id === "all" ? "Top podcasts" : `Top podcasts · ${g.label}`, make: () => section("podcasts", g.id) })),
    { label: "Collections row", make: () => section("collections") },
    { label: "Downloading now", make: () => section("downloading") },
    { label: "Needs attention", make: () => section("attention") },
    ...libraries.map((l) => ({ label: `Library: ${l.name}`, make: () => section("library", l.name) })),
    ...collections.slice(0, 200).map((c) => ({ label: `Collection: ${c.name}`, make: () => section("collection", c.name) })),
  ].filter((o) => !sections.some((s) => s.id === o.make().id));

  return (
    <div className="home">
      <ErrorList errors={errors} />
      {featured.length > 0 && <Hero items={featured} />}

      {!hasTmdb && !hintHidden && (
        <div className="hint-card">
          <Icon name="compass" size={22} />
          <div>
            <strong>See what's trending</strong>
            <span className="muted"> — connect TMDB (free) and this week's popular movies and shows appear here, one click from Radarr/Sonarr.</span>
          </div>
          <a className="btn primary" href="#/settings">Connect TMDB</a>
          <button
            className="icon-btn"
            aria-label="Dismiss"
            onClick={() => {
              setHintHidden(true);
              try {
                localStorage.setItem(TMDB_HINT_KEY, "1");
              } catch {
                // Remembering the dismissal is a convenience only.
              }
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <div className="home-bar">
        <span className="muted small">
          {items.length.toLocaleString()} titles · {libraries.length} libraries · {collections.length.toLocaleString()} collections
        </span>
        <div className="home-bar-actions">
          {editing && addOptions.length > 0 && (
            <select
              value=""
              aria-label="Add a section"
              onChange={(e) => {
                const opt = addOptions[Number(e.target.value)];
                if (opt) add(opt.make());
              }}
            >
              <option value="">+ Add section…</option>
              {addOptions.map((o, i) => (
                <option key={o.label} value={i}>{o.label}</option>
              ))}
            </select>
          )}
          {editing && hasMdb && (
            <form
              className="row-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setMdbError(undefined);
                try {
                  const r = await api.mdblistLists({ url: mdbUrl.trim() });
                  const found = r.lists[0];
                  if (!found) return setMdbError("List not found");
                  add(section("mdblist", `${found.id}:${found.name}`));
                  setMdbUrl("");
                } catch (err) {
                  setMdbError((err as Error).message);
                }
              }}
            >
              <input value={mdbUrl} onChange={(e) => setMdbUrl(e.target.value)} placeholder="Paste an MDBList list address" aria-label="MDBList list address" />
              <button className="btn" disabled={!mdbUrl.trim()}>Add list</button>
              {mdbError && <span className="muted small">{mdbError}</span>}
            </form>
          )}
          {editing && home.sections && (
            <button className="btn ghost" onClick={() => saveHome({ ...home, sections: null })}>Reset layout</button>
          )}
          <button className={`btn ${editing ? "primary" : ""}`} onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Customize home"}
          </button>
        </div>
      </div>

      {sections.map((s, i) => {
        if (!s.visible && !editing) return null;
        const body = renderSection(s, i);
        if (!body && !editing) return null;
        return (
          <div key={s.id} className={s.visible ? undefined : "section-hidden"}>
            {body ?? <p className="muted small section-empty">{sectionTitle(s)} is empty right now.</p>}
            {editing && (
              <div className="section-tools">
                <span className="muted small">{sectionTitle(s)}</span>
                <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><Icon name="up" size={16} /></button>
                <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Move down"><Icon name="down" size={16} /></button>
                <button className="icon-btn" onClick={() => patch(i, { visible: !s.visible })} aria-label={s.visible ? "Hide" : "Show"}>
                  <Icon name={s.visible ? "eye" : "eyeoff"} size={16} />
                </button>
                <button className="icon-btn" onClick={() => remove(i)} aria-label="Remove"><Icon name="close" size={16} /></button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  function sectionTitle(s: HomeSection): string {
    switch (s.kind) {
      case "recent": return TYPE_TITLES[(s.ref as MediaType | "all") ?? "all"];
      case "trending": return s.ref === "series" ? "Trending shows" : "Trending movies";
      case "list": {
        const [l, t] = (s.ref ?? "popular:movie").split(":");
        return LIST_TITLES[l as ListKind]?.[t === "series" ? "series" : "movie"] ?? "List";
      }
      case "ebooks": return "New books";
      case "mdblist": return s.ref?.slice(s.ref.indexOf(":") + 1) ?? "MDBList";
      case "audiobooks": return s.ref === "popular" ? "Popular audiobooks" : "New audiobook releases";
      case "podcasts": return s.ref && s.ref !== "all" ? `Top podcasts · ${genreLabel(s.ref)}` : "Top podcasts";
      case "library": return s.ref ?? "Library";
      case "collection": return s.ref ?? "Collection";
      case "collections": return "Collections";
      case "downloading": return "Downloading now";
      case "attention": return "Needs attention";
    }
  }

  function renderSection(s: HomeSection, order: number) {
    const title = sectionTitle(s);
    switch (s.kind) {
      case "trending":
        return hasTmdb ? <TrendingShelf type={s.ref === "series" ? "series" : "movie"} order={order} /> : null;
      case "list": {
        const [l, t] = (s.ref ?? "popular:movie").split(":");
        return hasTmdb ? <TrendingShelf type={t === "series" ? "series" : "movie"} list={(l as ListKind) ?? "popular"} order={order} /> : null;
      }
      case "ebooks":
        return hasCalibre ? <BookShelf order={order} /> : null;
      case "mdblist": {
        const at = (s.ref ?? "").indexOf(":");
        const id = (s.ref ?? "").slice(0, at);
        return hasMdb && id ? <TrendingShelf type="movie" order={order} custom={{ id, name: title }} /> : null;
      }
      case "audiobooks":
        return hasRmab ? <AudiobookListShelf list={s.ref === "popular" ? "popular" : "new"} order={order} /> : null;
      case "podcasts":
        return <PodcastShelf genre={s.ref ?? "all"} order={order} />;
      case "recent": {
        const list = takeRecent((i) => (s.ref === "all" || i.type === s.ref) && (i.available.length > 0 || !!i.managed?.hasFile));
        return list.length ? <Shelf order={order} title={title}>{list.map((i) => <Card key={i.key} item={i} />)}</Shelf> : null;
      }
      case "library": {
        const list = takeRecent((i) => inLibrary(i, s.ref ?? ""));
        const count = libraries.find((l) => l.name.toLowerCase() === (s.ref ?? "").toLowerCase())?.count ?? list.length;
        return list.length ? (
          <Shelf order={order} title={title} subtitle={`${count.toLocaleString()} titles`} actions={<a className="link" href={libraryHref(s.ref ?? "")}>See all</a>}>
            {list.map((i) => <Card key={i.key} item={i} />)}
          </Shelf>
        ) : null;
      }
      case "collection": {
        const c = collections.find((x) => x.name === s.ref);
        const list = (c?.memberKeys ?? []).slice(0, 60).map((k) => byKey.get(k)).filter((i): i is MediaItem => Boolean(i));
        return list.length ? <Shelf order={order} title={title} subtitle="Collection">{list.map((i) => <Card key={i.key} item={i} />)}</Shelf> : null;
      }
      case "collections":
        return collections.length ? (
          <Shelf order={order} title={title} subtitle={`${biggestCollections.length} biggest of ${collections.length.toLocaleString()}`} actions={<a className="link" href="#/collections">See all</a>}>
            {biggestCollections.map((c) => (
              <CollectionCard key={c.name} collection={c} onClick={() => (location.hash = `#/collections/${encodeURIComponent(c.name)}`)} />
            ))}
          </Shelf>
        ) : null;
      case "attention": {
        const list = takeRecent((i) => ["missing", "on-disk"].includes(statusOf(i)));
        return list.length ? (
          <Shelf order={order} title={title} subtitle="Missing, or downloaded but not on a media server yet">
            {list.map((i) => <Card key={i.key} item={i} />)}
          </Shelf>
        ) : null;
      }
      case "downloading": {
        const active = (queue.items ?? []).filter((q) => q.client !== "radarr" && q.client !== "sonarr");
        if (active.length === 0) return null;
        return (
          <section className="shelf">
            <header className="shelf-head">
              <div><h2>{title}</h2><span className="muted small">{active.length} active</span></div>
              <div className="shelf-actions"><a className="link" href="#/downloads">Open downloads</a></div>
            </header>
            <ul className="mini-queue">
              {active.slice(0, 5).map((q) => (
                <li key={`${q.serviceId}-${q.id}`}>
                  <span className={`chip kind-${q.client}`}>{KIND_LABELS[q.client]}</span>
                  <span className="mini-name" title={q.name}>{q.name}</span>
                  <span className="progress"><span style={{ width: `${Math.round(q.progress * 100)}%` }} /></span>
                  <span className="muted small mini-meta">{Math.round(q.progress * 100)}% · {q.speedBytes ? `${formatBytes(q.speedBytes)}/s · ` : ""}{formatEta(q.etaSeconds)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      }
    }
  }
}

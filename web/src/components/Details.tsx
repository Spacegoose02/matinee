import { useEffect, useRef, useState } from "react";
import { EpisodeList } from "./EpisodeList";
import { ReleasesModal } from "./ReleasesModal";
import {
  STATUS_LABELS, TYPE_LABELS, WATCH_LABELS, api, formatBytes, formatRuntime, statusOf, watchOf, type MediaItem,
} from "../api";
import { useStore } from "../store";
import { Poster, qualityLabel } from "./Cards";
import { ManageSection } from "./Manage";
import { TrailerPlayer, TrailerSection } from "./Trailers";
import { Icon } from "./Icons";

/** Slide-over with everything we know about one title, plus pinning and poster replacement. */
export function Details() {
  const { openKey, openItem, byKey, services, home, saveHome, reload, toast } = useStore();
  const listItem = openKey ? byKey.get(openKey) : undefined;
  const [searching, setSearching] = useState(false);
  const [finding, setFinding] = useState(false);
  const [full, setFull] = useState<MediaItem>();
  const [watching, setWatching] = useState(false);

  // The library list leaves out summaries, backdrops and the like; fetch them when a title is opened.
  useEffect(() => {
    setFull(undefined);
    setFinding(false);
    setWatching(false);
    if (!openKey) return;
    let cancelled = false;
    api.item(openKey).then((i) => !cancelled && setFull(i), () => {});
    return () => {
      cancelled = true;
    };
  }, [openKey]);

  // The list's poster wins so a just-changed poster shows immediately.
  const item = full && listItem ? { ...full, poster: listItem.poster ?? full.poster } : listItem;

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openItem(undefined);
    addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
    };
  }, [Boolean(item), openItem]);

  if (!item) return null;

  const pinned = home.pinned.includes(item.key);
  const togglePin = () =>
    saveHome({ ...home, pinned: pinned ? home.pinned.filter((k) => k !== item.key) : [item.key, ...home.pinned] });

  const status = statusOf(item);
  const quality = qualityLabel(item);
  const m = item.managed;
  const tmdbPath = item.type === "movie" ? "movie" : "tv";

  // Titles the manager knows about but has not fully downloaded can be searched for right here.
  const missing = !!m && (item.type === "movie" ? !m.hasFile : m.episodes ? m.episodes.have < m.episodes.total : !m.hasFile);
  const canSearch = missing && m?.arrId !== undefined;
  const monitorFirst = !!m && !m.monitored && item.type === "movie";
  const searchLabel = item.type === "series" ? "Search for missing episodes" : monitorFirst ? "Monitor & search" : "Search for download";

  const runSearch = async () => {
    if (!m || m.arrId === undefined) return;
    setSearching(true);
    try {
      await api.searchDownloads(m.serviceId, [m.arrId], monitorFirst);
      toast(`Searching for “${item.title}” — anything it finds shows up under Downloads.`);
      if (monitorFirst) reload(false); // it is monitored now; refresh so the page says so
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && openItem(undefined)}>
      <aside className="drawer" role="dialog" aria-label={item.title}>
        <div className="drawer-banner" style={item.backdrop || item.poster ? { backgroundImage: `url("${item.backdrop ?? item.poster}")` } : undefined}>
          <div className="drawer-banner-fade" />
          <button className="icon-btn close" onClick={() => openItem(undefined)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer-head">
          <Poster src={item.poster} title={item.title} className="drawer-poster" />
          <div className="drawer-title">
            <h2>{item.title}</h2>
            <div className="hero-facts">
              {item.certification && <span className="cert">{item.certification}</span>}
              {item.rating ? (
                <span className="rating">
                  <Icon name="star" size={14} /> {item.rating.toFixed(1)}
                </span>
              ) : null}
              {[item.year, TYPE_LABELS[item.type], formatRuntime(item.runtimeMinutes), item.studio].filter(Boolean).map((f, i) => (
                <span key={i}>{f}</span>
              ))}
            </div>
            {item.author && <div className="muted">by {item.author}</div>}
            <div className="chips">
              <span className={`chip status-${status}`}>{STATUS_LABELS[status]}</span>
              {quality && <span className="chip">{quality}</span>}
              {m && !m.monitored && <span className="chip dim">Unmonitored</span>}
              {item.genres?.map((g) => (
                <span key={g} className="chip dim">{g}</span>
              ))}
            </div>
            <div className="drawer-actions">
              <button className={`btn ${pinned ? "primary" : ""}`} onClick={togglePin}>
                <Icon name="pin" size={16} /> {pinned ? "Pinned to home" : "Pin to home"}
              </button>
              {item.type !== "book" && (
                <button className="btn" onClick={() => setWatching(true)}>
                  <Icon name="play" size={16} /> Watch trailer
                </button>
              )}
              {m?.arrId !== undefined && (
                <button className="btn" onClick={() => setFinding(true)}>
                  <Icon name="search" size={16} /> Find releases
                </button>
              )}
              {canSearch && (
                <button className="btn primary" onClick={runSearch} disabled={searching}>
                  <Icon name="download" size={16} /> {searching ? "Starting…" : searchLabel}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="drawer-body">
          {missing && (
            <p className="notice warn">
              {item.type === "series" && m?.episodes
                ? `${m.episodes.total - m.episodes.have} episode${m.episodes.total - m.episodes.have === 1 ? "" : "s"} not downloaded yet.`
                : "Not downloaded yet."}
              {!m?.monitored && " It isn't monitored, so it won't be picked up automatically."}
            </p>
          )}
          {item.overview ? <p className="overview">{item.overview}</p> : <p className="muted">No summary available.</p>}

          <dl className="facts">
            <dt>Libraries</dt>
            <dd>{item.libraries.join(", ")}</dd>
            <dt>Available on</dt>
            <dd>
              {item.available.length === 0
                ? "No media server yet"
                : item.available.map((a) => `${services[a.serviceId]?.name ?? "Server"}${a.resolution ? ` (${a.resolution}${a.videoCodec ? ` ${a.videoCodec.toUpperCase()}` : ""})` : ""}`).join(", ")}
            </dd>
            {m && (
              <>
                <dt>Managed by</dt>
                <dd>{services[m.serviceId]?.name ?? "Manager"}{m.quality ? ` · ${m.quality}` : ""}</dd>
                <dt>Size on disk</dt>
                <dd>{formatBytes(m.sizeBytes)}</dd>
              </>
            )}
            {watchOf(item) && (
              <>
                <dt>Watched</dt>
                <dd>
                  {WATCH_LABELS[watchOf(item)!.state]}
                  {watchOf(item)!.state === "inprogress" && watchOf(item)!.progress ? ` · ${Math.round(watchOf(item)!.progress! * 100)}%` : ""}
                  {watchOf(item)!.total ? ` · ${watchOf(item)!.seen} of ${watchOf(item)!.total} episodes` : ""}
                </dd>
              </>
            )}
            {m?.episodes && (
              <>
                <dt>Episodes</dt>
                <dd>{m.episodes.have} of {m.episodes.total} on disk</dd>
              </>
            )}
            {m?.path && (
              <>
                <dt>Folder</dt>
                <dd className="mono">{m.path}</dd>
              </>
            )}
            {(item.ids.tmdb || item.ids.imdb) && (
              <>
                <dt>Links</dt>
                <dd>
                  {item.ids.tmdb && item.type !== "book" && (
                    <a href={`https://www.themoviedb.org/${tmdbPath}/${item.ids.tmdb}`} target="_blank" rel="noreferrer">TMDB</a>
                  )}
                  {item.ids.imdb && (
                    <a href={`https://www.imdb.com/title/${item.ids.imdb}`} target="_blank" rel="noreferrer">IMDb</a>
                  )}
                </dd>
              </>
            )}
          </dl>

          {item.type === "series" && item.managed?.arrId !== undefined && <EpisodeList item={item} />}

          {item.managed?.path && item.type !== "book" && <TrailerSection itemKey={item.key} />}

          {item.managed?.arrId !== undefined && <ManageSection item={item} />}

          <PosterEditor itemKey={item.key} item={item} onChanged={() => reload(false)} />
        </div>
      </aside>
      {watching && <TrailerPlayer itemKey={item.key} title={item.title} onClose={() => setWatching(false)} />}
      {finding && item.managed && <ReleasesModal item={item} onClose={() => setFinding(false)} />}
    </div>
  );
}

function PosterEditor({ itemKey, item, onChanged }: { itemKey: string; item: MediaItem; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [autoSend, setAutoSend] = useState(() => {
    try { return localStorage.getItem("marquee.posterAutoSend") !== "0"; } catch { return true; }
  });
  const [options, setOptions] = useState<{ configured: boolean; items: { thumb: string; url: string; language?: string }[] }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const customised = item.poster?.startsWith("/posters/");

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await job();
      setUrl("");
      await onChanged();
      if (autoSend && item.managed?.path !== undefined || autoSend && item.available.length > 0) {
        const r = await api.pushPoster(itemKey).catch(() => undefined);
        if (r?.done.length) setNote(`Sent to ${r.done.join(" and ")}.`);
        else if (r?.failed.length) throw new Error(r.failed.join("; "));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="poster-editor">
      <h3>
        <Icon name="image" size={16} /> Change poster
      </h3>
      <p className="muted small">Shown in Matinee. Use “Send to Plex &amp; Jellyfin” to change the artwork on the servers too.</p>
      <form
        className="row-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) run(() => api.posterFromUrl(itemKey, url.trim()));
        }}
      >
        <input placeholder="Paste an image URL (ThePosterDB, TMDB…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || !url.trim()}>Use URL</button>
      </form>
      <div className="row-form">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run(() => api.posterFromFile(itemKey, file));
            e.target.value = "";
          }} />
        <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={16} /> Upload image
        </button>
        <button className="btn" disabled={busy} onClick={() => api.posterOptions(itemKey).then(setOptions, (e) => setError((e as Error).message))}>
          <Icon name="image" size={16} /> Browse posters
        </button>
        {customised && (
          <button className="btn" disabled={busy} onClick={() => run(async () => {
            const r = await api.pushPoster(itemKey);
            if (r.failed.length) throw new Error(r.failed.join("; "));
            setNote(`Sent to ${r.done.join(" and ")}.`);
          })}>
            Send to Plex &amp; Jellyfin
          </button>
        )}
        {customised && (
          <button className="btn ghost" disabled={busy} onClick={() => run(() => api.resetPoster(itemKey))}>
            <Icon name="trash" size={16} /> Reset to original
          </button>
        )}
      </div>
      <label className="inline">
        <input type="checkbox" checked={autoSend} onChange={(e) => { setAutoSend(e.target.checked); try { localStorage.setItem("marquee.posterAutoSend", e.target.checked ? "1" : "0"); } catch { /* storage unavailable */ } }} />
        Also set it on Plex &amp; Jellyfin when I pick one
      </label>
      {options && !options.configured && <p className="muted small">Add a TMDB key under Settings to browse alternative posters.</p>}
      {options?.configured && options.items.length === 0 && <p className="muted small">No other posters found for this title.</p>}
      {options && options.items.length > 0 && (
        <div className="poster-gallery">
          {options.items.map((p) => (
            <button key={p.url} className="poster-choice" disabled={busy} title={p.language ?? "No text"} onClick={() => run(() => api.posterFromUrl(itemKey, p.url))}>
              <img src={p.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {note && <p className="notice ok">{note}</p>}
      {error && <p className="notice error">{error}</p>}
    </section>
  );
}

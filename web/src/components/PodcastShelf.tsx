import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type PodcastItem, type PodcastTarget } from "../api";
import { PODCAST_GENRES, genreLabel } from "../lists";
import { useStore } from "../store";
import { Poster } from "./Cards";
import { Icon } from "./Icons";
import { EpisodePicker } from "./EpisodePicker";
import { Shelf } from "./Shelf";

const normalize = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Top podcasts from Apple's public chart, with one-click add to Audiobookshelf. */
export function PodcastShelf({ genre: initialGenre = "all", selectable = false, order }: { genre?: string; selectable?: boolean; order?: number }) {
  const { items: library, services, reload } = useStore();
  const [genre, setGenre] = useState(initialGenre);
  const [state, setState] = useState<{ loading: boolean; items: PodcastItem[]; error?: string }>({ loading: true, items: [] });
  const [targets, setTargets] = useState<PodcastTarget[]>([]);
  const [picked, setPicked] = useState<PodcastItem>();
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api.topPodcasts(genre).then(
      (r) => !cancelled && setState({ loading: false, items: r.items }),
      (err) => !cancelled && setState({ loading: false, items: [], error: (err as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [genre]);

  const hasAbs = Object.values(services).some((s) => s.kind === "audiobookshelf" && s.enabled);
  useEffect(() => {
    if (!hasAbs) return;
    api.podcastTargets().then((r) => setTargets(r.items), () => setTargets([]));
  }, [hasAbs]);

  // Everything Audiobookshelf already holds, so charts can say "In library" instead of offering a duplicate.
  const owned = useMemo(() => new Set(library.filter((i) => i.type === "book").map((i) => normalize(i.title))), [library]);

  if (state.error) return <p className="notice error">Couldn't load the podcast chart: {state.error}</p>;
  if (!state.loading && state.items.length === 0) return null;

  return (
    <>
      <Shelf
        order={order}
        title={genre === "all" ? "Top podcasts" : `Top podcasts · ${genreLabel(genre)}`}
        subtitle="Apple Podcasts chart"
        actions={
          selectable ? (
            <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Podcast category">
              {PODCAST_GENRES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          ) : undefined
        }
      >
        {state.items.map((p) => {
          const have = owned.has(normalize(p.title)) || p.added || added.has(p.itunesId);
          return (
            <button key={p.itunesId} className="card" title={p.title} onClick={() => setPicked(p)}>
              <Poster src={p.image} title={p.title} className="square" />
              {have ? (
                <span className="tag tag-status ok">{p.added || added.has(p.itunesId) ? "Added" : "In library"}</span>
              ) : targets.length > 0 ? (
                <span className="tag tag-add"><Icon name="plus" size={12} /> Add</span>
              ) : null}
              <span className="card-meta">
                <span className="card-title">{p.title}</span>
                <span className="card-sub">{p.artist}</span>
              </span>
            </button>
          );
        })}
      </Shelf>
      {picked && (
        <PodcastModal
          podcast={picked}
          targets={targets}
          have={owned.has(normalize(picked.title)) || Boolean(picked.added) || added.has(picked.itunesId)}
          onClose={() => setPicked(undefined)}
          onAdded={() => {
            setAdded((s) => new Set(s).add(picked.itunesId));
            setTimeout(() => void reload(false), 2500); // Audiobookshelf needs a moment to register the show
          }}
        />
      )}
    </>
  );
}

function PodcastModal({ podcast, targets, have, onClose, onAdded }: {
  podcast: PodcastItem; targets: PodcastTarget[]; have: boolean; onClose: () => void; onAdded: () => void;
}) {
  const { toast } = useStore();
  const [choice, setChoice] = useState(0);
  const [autoDownload, setAutoDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [episodes, setEpisodes] = useState<string[]>([]);
  const [showEpisodes, setShowEpisodes] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const target = targets[choice];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.addPodcast({ serviceId: target.serviceId, libraryId: target.libraryId, folderId: target.folderId, folderPath: target.folderPath, itunesId: podcast.itunesId, autoDownload, episodes: episodes.length ? episodes : undefined });
      setDone(true);
      onAdded();
      toast(`Added “${podcast.title}” to ${target.serviceName}.${episodes.length ? ` Downloading ${episodes.length} episode${episodes.length === 1 ? "" : "s"}.` : autoDownload ? " New episodes will download automatically." : " Pick episodes from its card to download them."}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-label={podcast.title}>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <div className="modal-head">
          <Poster src={podcast.image} title={podcast.title} className="modal-poster square" />
          <div>
            <h2>{podcast.title}</h2>
            <div className="muted small">{podcast.artist}{podcast.genre ? ` · ${podcast.genre}` : ""}</div>
            {podcast.summary && <p className="modal-overview">{podcast.summary}</p>}
          </div>
        </div>

        {done ? (
          <div className="modal-done">
            <Icon name="download" size={28} />
            <p><strong>Added to {target?.serviceName}.</strong> It shows up in your library after the next refresh.</p>
            <div className="actions"><button type="button" className="btn" onClick={onClose}>Done</button></div>
          </div>
        ) : have ? (
          <>
            <p className="notice ok">This podcast is already in your library.</p>
            {targets[0] ? (
              <>
                <button type="button" className="btn" onClick={() => setShowEpisodes(!showEpisodes)}>{showEpisodes ? "Hide episodes" : "Manage episodes…"}</button>
                {showEpisodes && <EpisodePicker serviceId={targets[0].serviceId} itunesId={podcast.itunesId} manage />}
              </>
            ) : null}
          </>
        ) : targets.length === 0 ? (
          <p className="notice">To add shows from here, connect Audiobookshelf (with an <strong>admin</strong> API token) and make sure it has a podcast library.</p>
        ) : (
          <>
            {targets.length > 1 && (
              <label>
                Add to
                <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
                  {targets.map((t, i) => <option key={`${t.libraryId}-${t.folderId}`} value={i}>{t.serviceName} · {t.libraryName} ({t.folderPath})</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn" onClick={() => setShowEpisodes(!showEpisodes)}>{showEpisodes ? "Hide episodes" : "Choose episodes to download…"}</button>
            {showEpisodes && target && <EpisodePicker serviceId={target.serviceId} itunesId={podcast.itunesId} manage={false} onPick={setEpisodes} />}
            {episodes.length > 0 && <p className="muted small">{episodes.length} episode{episodes.length === 1 ? "" : "s"} will download as soon as the show is added.</p>}
            <label className="inline">
              <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} />
              Download new episodes automatically
            </label>
            {error && <p className="notice error">{error}</p>}
            <div className="actions">
              <button className="btn primary" disabled={busy}><Icon name="plus" size={16} /> {busy ? "Adding…" : "Add to Audiobookshelf"}</button>
              {podcast.url && <a className="btn ghost" href={podcast.url} target="_blank" rel="noreferrer">Open in Apple Podcasts</a>}
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

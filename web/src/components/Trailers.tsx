import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatBytes, type TrailerJob, type TrailerRow, type TrailersResponse } from "../api";
import { useStore } from "../store";
import { Poster } from "./Cards";

const STATE_TEXT: Record<TrailerRow["state"], string> = {
  have: "Has a trailer",
  missing: "No trailer",
  unmapped: "Folder not found",
  readonly: "Folder is read-only",
};

const isActive = (j: TrailerJob) => j.status === "queued" || j.status === "running";

/** Polls the download queue while something is running; returns the latest jobs. */
function useJobs(initial: TrailerJob[] | undefined, onFinished: () => void) {
  const [jobs, setJobs] = useState<TrailerJob[]>(initial ?? []);
  useEffect(() => setJobs(initial ?? []), [initial]);
  const active = jobs.some(isActive);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      api.trailerJobs().then((r) => {
        setJobs(r.jobs);
        if (!r.jobs.some(isActive)) onFinished();
      }, () => {});
    }, 3000);
    return () => clearInterval(t);
  }, [active, onFinished]);
  return [jobs, setJobs, active] as const;
}

/** Why trailers can't be downloaded yet, or nothing if they can. */
function problem(d: TrailersResponse): string | undefined {
  if (!d.ytDlp) return "yt-dlp isn't in this image. Rebuild the Matinee image from the latest source to download trailers.";
  if (!d.mediaMounted) return "Matinee can't see your media folders. Add the /media path in the container settings (read/write), then map your folders in Settings → Storage.";
  return undefined;
}

export function Trailers() {
  const { toast, byKey } = useStore();
  const [watching, setWatching] = useState<TrailerRow>();
  const [data, setData] = useState<TrailersResponse>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<"missing" | "have" | "problem" | "all">("missing");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);

  const load = useCallback((refresh = false) => {
    setData(undefined);
    api.trailers(refresh).then(setData, (e) => setError((e as Error).message));
  }, []);
  useEffect(() => load(), [load]);
  const refreshQuiet = useCallback(() => api.trailers(true).then(setData, () => {}), []);
  const [jobs, setJobs, active] = useJobs(data?.jobs, refreshQuiet);

  const counts = useMemo(() => {
    const c = { have: 0, missing: 0, problem: 0 };
    for (const r of data?.items ?? []) {
      if (r.state === "have") c.have++;
      else if (r.state === "missing") c.missing++;
      else c.problem++;
    }
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((r) => (show === "all" ? true : show === "problem" ? r.state === "unmapped" || r.state === "readonly" : r.state === show) && (!q || r.title.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [data, filter, show]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Looking through your movie and show folders for trailers… this can take a minute on a big library.</p>;

  const blocked = problem(data);
  const jobFor = new Map(jobs.map((j) => [j.key, j]));
  const startable = rows.filter((r) => r.state === "missing" && !isActiveJob(jobFor.get(r.key)));
  const chosen = [...picked].filter((k) => startable.some((r) => r.key === k));

  const start = async (keys: string[]) => {
    try {
      const r = await api.downloadTrailers(keys);
      toast(r.queued ? `Queued ${r.queued} trailer${r.queued === 1 ? "" : "s"}.` : "Nothing to queue.");
      setPicked(new Set());
      setJobs((await api.trailerJobs()).jobs);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="trailers">
      {blocked && <p className="notice error">{blocked}</p>}
      <p className="muted">
        Matinee saves each trailer as <code>Title (Year)-trailer.mp4</code> in the title's own folder, which Plex and Jellyfin both show as the
        title's trailer after their next library scan. Existing trailers (from Trailarr or anywhere else in that format, or in a <code>Trailers</code>{" "}
        folder) are recognised and left alone.
      </p>

      <div className="filters">
        <input type="search" placeholder="Filter titles" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={show} onChange={(e) => { setShow(e.target.value as typeof show); setLimit(100); }} aria-label="Show">
          <option value="missing">No trailer ({counts.missing})</option>
          <option value="have">Has a trailer ({counts.have})</option>
          <option value="problem">Can't reach folder ({counts.problem})</option>
          <option value="all">All</option>
        </select>
        <button className="btn" onClick={() => load(true)}>Rescan</button>
        {startable.length > 0 && !blocked && (
          <>
            <button className="btn" onClick={() => setPicked(new Set(chosen.length === startable.length ? [] : startable.map((r) => r.key)))}>{chosen.length === startable.length ? "Clear selection" : "Select all"}</button>
            <button className="btn" disabled={chosen.length === 0} onClick={() => start(chosen)}>Download {chosen.length || ""} selected</button>
            <button className="btn primary" onClick={() => start(startable.map((r) => r.key))}>Download all {startable.length}</button>
          </>
        )}
      </div>
      {active && (
        <p className="notice">
          Downloading trailers one at a time… {jobs.filter((j) => j.status === "done").length} done, {jobs.filter(isActive).length} to go.
        </p>
      )}
      {counts.problem > 0 && show !== "problem" && (
        <p className="muted small">{counts.problem} titles can't be reached: their folder isn't mapped (Settings → Storage) or the media mount is read-only.</p>
      )}

      <div className="trailer-grid">
        {rows.slice(0, limit).map((r) => {
          const job = jobFor.get(r.key);
          const busyJob = isActiveJob(job);
          const failed = job?.status === "failed";
          const text = failed ? `Failed: ${job?.message ?? "unknown error"}` : busyJob ? (job?.status === "running" ? "Downloading…" : "Queued") : r.state === "have" ? "Saved" : STATE_TEXT[r.state];
          const tone = failed ? "bad" : busyJob ? "busy" : r.state === "have" ? "ok" : r.state === "missing" ? "none" : "bad";
          return (
            <article key={r.key} className={`trailer-card ${picked.has(r.key) ? "picked" : ""}`}>
              <div className="trailer-poster">
                <Poster src={byKey.get(r.key)?.poster} title={r.title} />
                {r.state === "missing" && !busyJob && (
                  <input
                    type="checkbox"
                    className="trailer-check"
                    aria-label={`Select ${r.title}`}
                    checked={picked.has(r.key)}
                    onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })}
                  />
                )}
              </div>
              <div className="trailer-info">
                <strong title={r.title}>{r.title}</strong>
                <span className="muted small">{r.year ?? ""}{r.type === "series" ? " · Show" : ""}</span>
                <span className={`chip trailer-status ${tone}`} title={failed ? job?.message : r.file}>{text}</span>
                <div className="trailer-actions">
                  <button className="btn small" onClick={() => setWatching(r)}>Watch</button>
                  {r.state === "missing" && !blocked && !busyJob && <button className="btn small primary" onClick={() => start([r.key])}>Download</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {rows.length > limit && <button className="btn" onClick={() => setLimit(limit + 200)}>Show more ({rows.length - limit} left)</button>}
      {rows.length === 0 && <p className="muted">Nothing here.</p>}
      {watching && <TrailerPlayer itemKey={watching.key} title={watching.title} onClose={() => setWatching(undefined)} />}
    </section>
  );
}

const isActiveJob = (j: TrailerJob | undefined) => (j ? isActive(j) : false);

/** Trailer status and download for the title in the details drawer. */
export function TrailerSection({ itemKey }: { itemKey: string }) {
  const { toast } = useStore();
  const [row, setRow] = useState<TrailerRow>();
  const [ready, setReady] = useState<string>();
  const [job, setJob] = useState<TrailerJob>();
  const [url, setUrl] = useState("");

  const load = useCallback(() => {
    api.trailers().then((d) => {
      setRow(d.items.find((r) => r.key === itemKey));
      setReady(problem(d));
      setJob(d.jobs.find((j) => j.key === itemKey));
    }, () => {});
  }, [itemKey]);
  useEffect(load, [load]);

  const running = isActiveJob(job);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => api.trailerJobs().then((r) => {
      const j = r.jobs.find((x) => x.key === itemKey);
      setJob(j);
      if (j && !isActive(j)) api.trailers(true).then((d) => setRow(d.items.find((x) => x.key === itemKey)), () => {});
    }, () => {}), 3000);
    return () => clearInterval(t);
  }, [running, itemKey]);

  if (!row) return null;
  const download = async () => {
    try {
      await api.downloadTrailers([itemKey], url.trim() || undefined);
      setJob({ key: itemKey, title: row.title, status: "queued" });
      setUrl("");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="poster-editor">
      <h3>Trailer</h3>
      {row.state === "have" ? (
        <p className="muted small">Saved: <code>{row.file}</code>{row.sizeBytes ? ` · ${formatBytes(row.sizeBytes)}` : ""}</p>
      ) : row.state === "missing" ? (
        <>
          <p className="muted small">
            {running ? "Downloading the trailer…" : job?.status === "failed" ? `Failed: ${job.message ?? "unknown error"}` : "No trailer in this title's folder yet."}
          </p>
          {ready ? (
            <p className="notice error">{ready}</p>
          ) : (
            <form className="row-form" onSubmit={(e) => { e.preventDefault(); if (!running) void download(); }}>
              <input placeholder="Optional: paste a YouTube link to use instead" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn" disabled={running}>Download trailer</button>
            </form>
          )}
        </>
      ) : (
        <p className="muted small">{STATE_TEXT[row.state]}. Check the folder mapping in Settings → Storage and that /media is mounted read/write.</p>
      )}
    </section>
  );
}

/** Plays the saved trailer if there is one, otherwise TMDB's YouTube trailer. */
export function TrailerPlayer({ itemKey, lookup, title, onClose }: { itemKey?: string; lookup?: { type: string; tmdb?: string; title: string; year?: number }; title: string; onClose: () => void }) {
  const file = itemKey ? `/api/trailer-file?key=${encodeURIComponent(itemKey)}` : undefined;
  const [source, setSource] = useState<{ kind: "file" } | { kind: "youtube"; id: string } | { kind: "none" }>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const probe = file ? await fetch(file, { headers: { Range: "bytes=0-0" } }).catch(() => undefined) : undefined;
      if (probe && (probe.status === 200 || probe.status === 206)) return !cancelled && setSource({ kind: "file" });
      const online = await api.trailerOnline(itemKey ? { key: itemKey } : { ...lookup }).catch(() => ({ youtubeId: null }));
      if (!cancelled) setSource(online.youtubeId ? { kind: "youtube", id: online.youtubeId } : { kind: "none" });
    })();
    return () => { cancelled = true; };
  }, [file, itemKey, lookup]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={`Trailer for ${title}`}>
        <header className="modal-head">
          <h2>{title}: trailer</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>
        {!source && <p className="muted">Looking for the trailer…</p>}
        {source?.kind === "file" && file && <video className="trailer-video" src={file} controls autoPlay />}
        {source?.kind === "youtube" && (
          <iframe
            className="trailer-video"
            src={`https://www.youtube-nocookie.com/embed/${source.id}?autoplay=1`}
            title={`Trailer for ${title}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        )}
        {source?.kind === "none" && (
          <p className="notice">No trailer is saved and TMDB doesn't know one. Add a TMDB key under Settings, or paste a YouTube link in the Trailer section below to download one.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

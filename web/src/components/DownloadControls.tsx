import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatBytes, type DownloadAction, type QueueItem, type TorrentInfo } from "../api";
import { useStore } from "../store";
import { ErrorList } from "./ErrorList";

type Target = { serviceId: string; id: string; name: string; paused: boolean; client: string };

/** Pause, resume, move or remove one download; used by the active list and the torrent list. */
function Controls({ target, canMove, onDone }: { target: Target; canMove?: boolean; onDone: () => void }) {
  const { toast } = useStore();
  const [mode, setMode] = useState<"remove" | "move">();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: DownloadAction, opts: { deleteFiles?: boolean; path?: string } = {}, done?: string) => {
    setBusy(true);
    try {
      await api.controlDownload(target.serviceId, action, target.id, opts);
      if (done) toast(done);
      setMode(undefined);
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dl-controls">
      <div className="actions">
        <button className="btn small" disabled={busy} onClick={() => run(target.paused ? "resume" : "pause")}>{target.paused ? "Resume" : "Pause"}</button>
        {canMove && <button className="btn small" disabled={busy} onClick={() => { setMode(mode === "move" ? undefined : "move"); setPath(""); }}>Move…</button>}
        <button className="btn small danger" disabled={busy} onClick={() => setMode(mode === "remove" ? undefined : "remove")}>Remove…</button>
      </div>
      {mode === "remove" && (
        <div className="rule-body">
          <label className="inline">
            <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
            Also delete the downloaded files <span className="muted small">(cannot be undone)</span>
          </label>
          <div className="actions">
            <button className="btn danger small" disabled={busy} onClick={() => run("remove", { deleteFiles }, deleteFiles ? "Removed it and deleted the files." : "Removed it. The files were left alone.")}>
              {deleteFiles ? "Remove and delete files" : "Remove"}
            </button>
            <button className="btn small" onClick={() => setMode(undefined)}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "move" && (
        <form
          className="rule-body"
          onSubmit={(e) => { e.preventDefault(); if (path.trim()) void run("set-location", { path }, "Moving it. Large torrents take a while."); }}
        >
          <label>New folder, as the client sees it
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/downloads/movies" autoFocus />
          </label>
          <div className="actions">
            <button className="btn primary small" disabled={busy || !path.trim()}>Move files</button>
            <button type="button" className="btn small" onClick={() => setMode(undefined)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Buttons for a row in the active download list (SABnzbd and qBittorrent items only). */
export function QueueControls({ q, onDone }: { q: QueueItem; onDone: () => void }) {
  if (!q.controllable) return null;
  return <Controls target={{ serviceId: q.serviceId, id: q.id, name: q.name, paused: q.status === "Paused", client: q.client }} canMove={q.client === "qbittorrent"} onDone={onDone} />;
}

/** Pause or resume everything a SABnzbd server is doing. */
export function PauseAll({ serviceId, onDone }: { serviceId: string; onDone: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = async (action: "pause-all" | "resume-all") => {
    setBusy(true);
    try {
      await api.controlDownload(serviceId, action);
      toast(action === "pause-all" ? "Paused all downloads." : "Resumed downloads.");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="actions">
      <button className="btn small" disabled={busy} onClick={() => run("pause-all")}>Pause all</button>
      <button className="btn small" disabled={busy} onClick={() => run("resume-all")}>Resume all</button>
    </span>
  );
}

type Show = "all" | "downloading" | "seeding" | "paused";

/** Every torrent in qBittorrent, finished or not, with pause, move and remove. */
export function Torrents() {
  const { services } = useStore();
  const [data, setData] = useState<{ items: TorrentInfo[]; errors: { serviceId: string; name: string; message: string }[]; configured: boolean }>();
  const [error, setError] = useState<string>();
  const [show, setShow] = useState<Show>("all");
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(60);

  const load = useCallback(() => api.torrents().then(setData, (e) => setError((e as Error).message)), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((t) => (show === "all" ? true : show === "paused" ? t.paused : show === "seeding" ? t.seeding && !t.paused : !t.seeding && !t.paused) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
  }, [data, show, filter]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading torrents…</p>;
  if (!data.configured) return <p className="notice">Connect qBittorrent in Settings to manage torrents here.</p>;

  return (
    <section className="torrents">
      <ErrorList errors={data.errors} />
      <div className="filters">
        <input type="search" placeholder="Filter torrents" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(60); }} />
        <select value={show} onChange={(e) => setShow(e.target.value as Show)} aria-label="Show">
          <option value="all">All ({data.items.length})</option>
          <option value="downloading">Downloading</option>
          <option value="seeding">Seeding</option>
          <option value="paused">Paused</option>
        </select>
      </div>
      <ul className="dl-list">
        {rows.slice(0, limit).map((t) => (
          <li key={`${t.serviceId}-${t.id}`} className="dl-row">
            <div className="dl-main">
              <div className="dl-top">
                <span className="dl-name" title={t.name}>{t.name}</span>
                <span className="pill">{t.state}</span>
              </div>
              {!t.seeding && <div className="progress big"><span style={{ width: `${Math.round(t.progress * 100)}%` }} /></div>}
              <div className="dl-meta muted">
                <span>{formatBytes(t.sizeBytes)}</span>
                {t.seeding && <span>Ratio {t.ratio.toFixed(2)}</span>}
                {t.downBytes > 0 && <span>{formatBytes(t.downBytes)}/s</span>}
                {t.category && <span className="chip dim">{t.category}</span>}
                {Object.keys(services).length > 1 && <span>{services[t.serviceId]?.name}</span>}
              </div>
              <div className="muted small mono" title="Where the files are, as qBittorrent sees it">{t.savePath}</div>
              <Controls target={{ serviceId: t.serviceId, id: t.id, name: t.name, paused: t.paused, client: "qbittorrent" }} canMove onDone={load} />
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="muted">No torrents match.</p>}
      {rows.length > limit && <button className="btn" onClick={() => setLimit(limit + 60)}>Show more ({rows.length - limit} left)</button>}
    </section>
  );
}

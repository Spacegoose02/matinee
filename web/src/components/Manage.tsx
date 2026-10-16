import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, formatBytes, type AddOptions, type EpisodeInfo, type MediaItem, type RenameChange, type RenumberRow } from "../api";
import { useStore } from "../store";

type Action = "rename" | "move" | "remove" | "renumber" | "delete-file";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Rename, move, rescan and remove a title, all carried out by Radarr/Sonarr. */
export function ManageSection({ item }: { item: MediaItem }) {
  const { toast, reload, services, openItem } = useStore();
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const manager = item.managed && services[item.managed.serviceId]?.name;

  const rescan = async () => {
    setBusy(true);
    try {
      await api.rescanTitle(item.key);
      toast(`${manager} is rescanning the files. Watch it under Downloads → Active.`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="poster-editor">
      <h3>Manage</h3>
      <p className="muted small">Done by {manager}, so it stays in step with the files. Nothing here touches your files directly.</p>
      <div className="row-form">
        <button className="btn" onClick={() => setAction("rename")}>Rename files…</button>
        <button className="btn" onClick={() => setAction("move")}>Move to another library…</button>
        {item.type === "series" && <button className="btn" onClick={() => setAction("renumber")}>Fix season / episode numbers…</button>}
        <button className="btn" disabled={busy} onClick={rescan}>Rescan files</button>
        {item.type === "movie" && item.managed?.fileId !== undefined && <button className="btn danger" onClick={() => setAction("delete-file")}>Delete file to redownload…</button>}
        <button className="btn danger" onClick={() => setAction("remove")}>Remove…</button>
      </div>
      {action === "rename" && <RenameModal item={item} onClose={() => setAction(undefined)} />}
      {action === "delete-file" && <DeleteFilesModal item={item} fileIds={[]} label={`the file for “${item.title}”`} onClose={() => setAction(undefined)} />}
      {action === "renumber" && <RenumberModal item={item} onClose={() => { setAction(undefined); void reload(false); }} />}
      {action === "move" && <MoveModal item={item} onClose={() => { setAction(undefined); void reload(false); }} />}
      {action === "remove" && (
        <RemoveModal
          item={item}
          onClose={() => setAction(undefined)}
          onRemoved={() => { setAction(undefined); openItem(undefined); void reload(false); }}
        />
      )}
    </section>
  );
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function RenameModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { toast, services } = useStore();
  const manager = (item.managed && services[item.managed.serviceId]?.name) || "the manager";
  const [changes, setChanges] = useState<RenameChange[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.renamePreview(item.key).then((r) => setChanges(r.changes), (e) => setError((e as Error).message));
  }, [item.key]);

  const apply = async () => {
    if (!changes) return;
    setBusy(true);
    try {
      await api.renameApply(item.key, changes.map((c) => c.fileId));
      toast(`Renaming ${changes.length} file${changes.length === 1 ? "" : "s"}. Watch it under Downloads → Active.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Rename “${item.title}”`} onClose={onClose}>
      {error && <p className="notice error">{error}</p>}
      <FolderRename item={item} onDone={onClose} />
      <h3>File names</h3>
      {!changes && !error && <p className="muted">Asking for the new names…</p>}
      {changes?.length === 0 && (
        <p className="notice ok">
          The files already have the names your naming settings in {manager} would give them, so there is nothing to rename. To get different names,
          change the naming format in {manager} (Settings → Media Management) and come back, or rename the folder above.
        </p>
      )}
      {changes && changes.length > 0 && (
        <>
          <p className="muted small">These are the names your naming settings in the manager would give the files. Nothing changes until you apply.</p>
          <ul className="rule-list">
            {changes.map((c) => (
              <li key={c.fileId} className="rule">
                <div className="muted small">{fileName(c.existingPath)}</div>
                <div>→ <strong>{fileName(c.newPath)}</strong></div>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="btn primary" disabled={busy} onClick={apply}>{busy ? "Working…" : `Rename ${changes.length} file${changes.length === 1 ? "" : "s"}`}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MoveModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { toast } = useStore();
  const m = item.managed!;
  const [options, setOptions] = useState<AddOptions>();
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.addOptions(m.serviceId).then(setOptions, (e) => setError((e as Error).message));
  }, [m.serviceId]);

  const current = options?.rootFolders.find((r) => m.path?.startsWith(r.path))?.path;
  const choices = options?.rootFolders.filter((r) => r.path !== current) ?? [];

  const move = async () => {
    setBusy(true);
    try {
      await api.moveTitle(item.key, target);
      toast("Moving the files. Watch it under Downloads → Active; the title appears in its new library when it finishes.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Move “${item.title}”`} onClose={onClose}>
      {error && <p className="notice error">{error}</p>}
      {!options && !error && <p className="muted">Loading folders…</p>}
      {options && (
        <>
          <p className="muted small">
            Currently in <code>{current ?? m.rootFolder ?? "an unknown folder"}</code>. Pick the folder to move it to. {m.serviceId && "The manager moves the files and updates its records."}
          </p>
          {choices.length === 0 ? (
            <p className="notice">There is no other root folder. Add one in Radarr/Sonarr (Settings → Media Management) first.</p>
          ) : (
            <ul className="rule-list">
              {choices.map((r) => (
                <li key={r.path} className={`rule ${target === r.path ? "on" : ""}`}>
                  <label className="inline">
                    <input type="radio" name="root" checked={target === r.path} onChange={() => setTarget(r.path)} />
                    <strong>{r.path}</strong>
                    {r.freeBytes !== undefined && <span className="muted small"> {formatBytes(r.freeBytes)} free</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button className="btn primary" disabled={!target || busy} onClick={move}>{busy ? "Starting…" : "Move"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function RemoveModal({ item, onClose, onRemoved }: { item: MediaItem; onClose: () => void; onRemoved: () => void }) {
  const { toast } = useStore();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [exclude, setExclude] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onDisk = item.managed?.hasFile;

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeTitle(item.key, deleteFiles, exclude, confirm);
      toast(deleteFiles ? `Removed “${item.title}” and deleted its files.` : `Removed “${item.title}” from the manager. Its files were left alone.`);
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Remove “${item.title}”`} onClose={onClose}>
      <p className="muted">
        This removes the title from {item.type === "series" ? "Sonarr" : "Radarr"}. Plex and Jellyfin drop it the next time they scan if its files are gone.
      </p>
      {onDisk && (
        <label className="inline">
          <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
          <strong>Also delete the files from disk</strong> <span className="muted small">(cannot be undone)</span>
        </label>
      )}
      <label className="inline">
        <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
        Don't let lists add it back (import exclusion)
      </label>
      {deleteFiles && <p className="notice error">The files and the title folder will be deleted for good.</p>}
      <label>
        Type <strong>{item.title}</strong> to confirm
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={item.title} />
      </label>
      {error && <p className="notice error">{error}</p>}
      <div className="actions">
        <button className="btn danger" disabled={busy || confirm.trim() !== item.title} onClick={remove}>
          {busy ? "Removing…" : deleteFiles ? "Remove and delete files" : "Remove from library"}
        </button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Give the title's folder a name of your choice; the manager moves everything and updates itself. */
function FolderRename({ item, onDone }: { item: MediaItem; onDone: () => void }) {
  const { toast, reload } = useStore();
  const current = (item.managed?.path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.renameFolder(item.key, name.trim());
      toast("Renaming the folder. Watch it under Downloads → Active.");
      void reload(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div>
      <h3>Folder name</h3>
      <form className="row-form" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== current) void save(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Folder name" />
        <button className="btn primary" disabled={busy || !name.trim() || name.trim() === current}>{busy ? "Working…" : "Rename folder"}</button>
      </form>
      <p className="muted small">The title's files move with it. File names inside keep following your naming format.</p>
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

const STATUS_TEXT: Record<RenumberRow["status"], string> = {
  ok: "Will be moved",
  "no-target": "No such episode, skipped",
  occupied: "That episode already has a file, skipped",
};

/** Re-assign a season's files to another season (and shift episode numbers), carried out by Sonarr's manual import. */
function RenumberModal({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { toast } = useStore();
  const m = item.managed!;
  const [seasons, setSeasons] = useState<number[]>();
  const [from, setFrom] = useState<number>();
  const [to, setTo] = useState<number>();
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<RenumberRow[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.episodes(m.serviceId, m.arrId!).then(
      (list: EpisodeInfo[]) => setSeasons([...new Set(list.filter((e) => e.hasFile).map((e) => e.season))].sort((a, b) => a - b)),
      (e) => setError((e as Error).message),
    );
  }, [m.serviceId, m.arrId]);

  const run = async (apply: boolean) => {
    if (from === undefined || to === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.renumber(item.key, from, to, offset, apply);
      setRows(r.rows);
      if (apply) {
        toast(`Sonarr is re-assigning ${r.rows.filter((x) => x.status === "ok").length} files. Watch it under Downloads → Active.`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const okCount = rows?.filter((r) => r.status === "ok").length ?? 0;
  return (
    <Modal title={`Fix numbering for “${item.title}”`} onClose={onClose}>
      <p className="muted small">
        For shows whose files landed in the wrong season, such as a season that is one ahead. Pick the season the files are in now and the season they belong
        in. Sonarr moves and renames them to match. Use the episode offset when the numbers shift too (offset 1 turns episode 5 into 6).
      </p>
      {error && <p className="notice error">{error}</p>}
      {!seasons && !error && <p className="muted">Loading seasons…</p>}
      {seasons && (
        <>
          <div className="row-form">
            <label>Files now in season
              <select value={from ?? ""} onChange={(e) => { setFrom(e.target.value === "" ? undefined : Number(e.target.value)); setRows(undefined); }}>
                <option value="">Choose…</option>
                {seasons.map((s) => <option key={s} value={s}>{s === 0 ? "Specials" : `Season ${s}`}</option>)}
              </select>
            </label>
            <label>Belong in season
              <input type="number" min={0} value={to ?? ""} onChange={(e) => { setTo(e.target.value === "" ? undefined : Number(e.target.value)); setRows(undefined); }} />
            </label>
            <label>Episode offset
              <input type="number" value={offset} onChange={(e) => { setOffset(Number(e.target.value) || 0); setRows(undefined); }} />
            </label>
            <button className="btn" disabled={busy || from === undefined || to === undefined} onClick={() => run(false)}>Preview</button>
          </div>
          {rows && (
            <>
              {rows.length === 0 ? (
                <p className="notice">There are no files in that season.</p>
              ) : (
                <ul className="rule-list">
                  {rows.map((r, i) => (
                    <li key={i} className={`rule ${r.status === "ok" ? "on" : ""}`}>
                      <div className="muted small">{r.fileName}</div>
                      <div><strong>{r.from}</strong> → {r.to ? <strong>{r.to}{r.title ? ` · ${r.title}` : ""}</strong> : "—"} <span className="muted small">{STATUS_TEXT[r.status]}</span></div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="actions">
                <button className="btn primary" disabled={busy || okCount === 0} onClick={() => run(true)}>{busy ? "Working…" : `Move ${okCount} file${okCount === 1 ? "" : "s"}`}</button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** Delete files from disk so the manager can fetch them again, for example a release in the wrong language. */
export function DeleteFilesModal({ item, fileIds, label, onClose, onDone }: { item: MediaItem; fileIds: number[]; label: string; onClose: () => void; onDone?: () => void }) {
  const { toast, reload } = useStore();
  const [blocklist, setBlocklist] = useState(true);
  const [search, setSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.deleteFiles(item.key, fileIds, blocklist, search);
      toast(`Deleted ${r.count} file${r.count === 1 ? "" : "s"}${search ? ". Searching for new copies; watch Downloads." : "."}`);
      void reload(false);
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete and redownload" onClose={onClose}>
      <p>This deletes <strong>{label}</strong> from disk. It cannot be undone.</p>
      <label className="inline">
        <input type="checkbox" checked={blocklist} onChange={(e) => setBlocklist(e.target.checked)} />
        Blocklist the release that was imported, so the same one isn't grabbed again
      </label>
      <label className="inline">
        <input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} />
        Search for a new copy straight away
      </label>
      {blocklist && search && <p className="muted small">Radarr and Sonarr can also start their own search when a release is blocklisted, so you may see a second search for the same title.</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="actions">
        <button className="btn danger" disabled={busy} onClick={run}>{busy ? "Deleting…" : "Delete"}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

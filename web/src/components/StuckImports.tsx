import { useCallback, useEffect, useState } from "react";
import { api, formatBytes, type ImportCandidate, type ImportIssue, type RemotePathMapping, type ServiceError } from "../api";
import { useStore } from "../store";
import { ErrorList } from "./ErrorList";

const parentDir = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i + 1) : p;
};

/** Finished downloads that Radarr/Sonarr could not import, with a retry and the path-mapping fix. */
export function StuckImports() {
  const { services, toast } = useStore();
  const [data, setData] = useState<{ items: ImportIssue[]; mappings: RemotePathMapping[]; errors: ServiceError[] }>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [mapFor, setMapFor] = useState<ImportIssue>();
  const [removing, setRemoving] = useState<ImportIssue>();
  const [fromClient, setFromClient] = useState(false);
  const [blocklist, setBlocklist] = useState(false);
  const [form, setForm] = useState({ host: "", remotePath: "", localPath: "" });

  const load = useCallback(() => {
    api.importIssues().then(setData, (e) => setFailure((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const retry = async (serviceId: string, ids: string[]) => {
    setBusy(serviceId + ids.join());
    try {
      await api.retryImport(serviceId, ids);
      toast(ids.length === 1 ? "Asked to import it again. Give it a minute." : `Asked to import ${ids.length} downloads again. Give it a minute.`);
      setTimeout(load, 4000);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy("remove");
    try {
      await api.removeImport(removing.serviceId, removing.id, fromClient, blocklist);
      toast("Removed it from the queue.");
      setRemoving(undefined);
      setFromClient(false);
      setBlocklist(false);
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const startMapping = (issue: ImportIssue) => {
    setMapFor(issue);
    setForm({ host: issue.clientHost ?? "", remotePath: issue.outputPath ? parentDir(issue.outputPath) : "", localPath: "" });
  };

  const saveMapping = async () => {
    if (!mapFor) return;
    setBusy("map");
    try {
      await api.addRemotePath({ serviceId: mapFor.serviceId, ...form });
      toast("Saved the path mapping. Now retry the import.");
      setMapFor(undefined);
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (failure) return <p className="notice error">{failure}</p>;
  if (!data) return <p className="muted">Checking Radarr and Sonarr…</p>;

  const byService = new Map<string, ImportIssue[]>();
  for (const i of data.items) byService.set(i.serviceId, [...(byService.get(i.serviceId) ?? []), i]);

  return (
    <section className="stuck">
      <ErrorList errors={data.errors} />
      {data.items.length === 0 ? (
        <p className="notice ok">Nothing is stuck. Every finished download has been imported.</p>
      ) : (
        <p className="muted">
          These finished downloading but Radarr or Sonarr could not import them. When the message says it cannot find or access the folder, the
          download client and the manager disagree about the path; a <em>remote path mapping</em> tells the manager how to translate it
          (for example the client's <code>/mnt/user/downloads/</code> to the manager's <code>/downloads/</code>). Matinee never moves files itself.
        </p>
      )}

      {[...byService].map(([sid, list]) => (
        <div key={sid} className="stuck-group">
          <header className="shelf-head">
            <h2>{services[sid]?.name ?? "Manager"}</h2>
            <button className="btn primary" disabled={busy !== undefined} onClick={() => retry(sid, list.map((i) => i.id))}>Retry all {list.length}</button>
          </header>
          <ul className="rule-list">
            {list.map((i) => (
              <li key={i.id} className="rule on">
                <strong>{i.title}</strong>
                <div className="muted small">{i.messages.join(" · ") || "Waiting to be imported"}</div>
                {i.outputPath && <div className="muted small">Client says: <code>{i.outputPath}</code>{i.client && ` (${i.client})`}</div>}
                <div className="actions">
                  <button className="btn" disabled={busy !== undefined} onClick={() => retry(sid, [i.id])}>Retry import</button>
                  <button className="btn" onClick={() => startMapping(i)}>Fix the path…</button>
                  <button className="btn danger" onClick={() => setRemoving(i)}>Remove…</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {removing && (
        <div className="rule-body">
          <h3>Remove “{removing.title}” from the queue</h3>
          <label className="inline">
            <input type="checkbox" checked={fromClient} onChange={(e) => setFromClient(e.target.checked)} />
            Also remove it from {removing.client ?? "the download client"} <strong>and delete the downloaded files</strong>
          </label>
          <label className="inline">
            <input type="checkbox" checked={blocklist} onChange={(e) => setBlocklist(e.target.checked)} />
            Blocklist this release and look for another
          </label>
          <p className="muted small">With both boxes empty it only leaves the queue; the files stay where they are.</p>
          <div className="actions">
            <button className="btn danger" disabled={busy !== undefined} onClick={remove}>{fromClient ? "Remove and delete files" : "Remove from queue"}</button>
            <button className="btn" onClick={() => setRemoving(undefined)}>Cancel</button>
          </div>
        </div>
      )}

      <FolderImport />

      {mapFor && (
        <div className="rule-body">
          <h3>New remote path mapping in {services[mapFor.serviceId]?.name}</h3>
          <label>Download client host<input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.10" /></label>
          <label>Path as the client sees it<input value={form.remotePath} onChange={(e) => setForm({ ...form, remotePath: e.target.value })} placeholder="/mnt/user/downloads/" /></label>
          <label>Same folder as the manager sees it<input value={form.localPath} onChange={(e) => setForm({ ...form, localPath: e.target.value })} placeholder="/downloads/" /></label>
          <div className="actions">
            <button className="btn primary" disabled={busy !== undefined || !form.host || !form.remotePath || !form.localPath} onClick={saveMapping}>Save mapping</button>
            <button className="btn" onClick={() => setMapFor(undefined)}>Cancel</button>
          </div>
        </div>
      )}

      {data.mappings.length > 0 && (
        <details>
          <summary className="muted small">Existing path mappings ({data.mappings.length})</summary>
          <ul className="rule-list">
            {data.mappings.map((m) => (
              <li key={`${m.serviceId}-${m.id}`} className="muted small">
                {services[m.serviceId]?.name}: <code>{m.host}</code> {m.remotePath} → {m.localPath}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Pick up files sitting in a download folder (for example /mnt/user/downloads) and import them into the library. */
function FolderImport() {
  const { services, toast } = useStore();
  const managers = Object.values(services).filter((s) => s.enabled && (s.kind === "radarr" || s.kind === "sonarr"));
  const [open, setOpen] = useState(false);
  const [sid, setSid] = useState(managers[0]?.id ?? "");
  const [dir, setDir] = useState<{ path: string; parent?: string; directories: { name: string; path: string }[] }>();
  const [items, setItems] = useState<ImportCandidate[]>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!managers.some((m) => m.id === sid) && managers[0]) setSid(managers[0].id);
  }, [managers, sid]);

  const browse = async (path: string) => {
    setError(undefined);
    setItems(undefined);
    try {
      setDir(await api.browseFolders(sid, path));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const scan = async () => {
    if (!dir) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.scanFolder(sid, dir.path);
      setItems(r.items);
      setPicked(new Set(r.items.filter((i) => i.match).map((i) => i.path)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!dir) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.importFolder(sid, dir.path, [...picked], mode);
      toast(`Importing ${r.count} file${r.count === 1 ? "" : "s"}. Watch it under Downloads → Active.`);
      setItems(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (managers.length === 0) return null;
  return (
    <div className="stuck-group">
      <header className="shelf-head">
        <h2>Import from a folder</h2>
        <button className="btn" onClick={() => { setOpen(!open); if (!open && !dir) void browse("/"); }}>{open ? "Hide" : "Browse…"}</button>
      </header>
      {open && (
        <div className="rule-body">
          <p className="muted small">
            Pick a folder with finished downloads, as {services[sid]?.name ?? "the manager"} sees it (for example <code>/downloads</code>). Matinee asks the manager which
            titles the files are, and imports the ones it recognises.
          </p>
          {managers.length > 1 && (
            <label>Import into
              <select value={sid} onChange={(e) => { setSid(e.target.value); setDir(undefined); setItems(undefined); }}>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="notice error">{error}</p>}
          {dir && (
            <>
              <div className="actions">
                <code>{dir.path}</code>
                {dir.parent !== undefined && <button className="btn" onClick={() => browse(dir.parent!)}>Up</button>}
                <button className="btn primary" disabled={busy} onClick={scan}>{busy ? "Scanning…" : "Scan this folder"}</button>
              </div>
              {dir.directories.length === 0 ? <p className="muted small">No folders inside.</p> : (
                <ul className="rule-list">
                  {dir.directories.map((d) => (
                    <li key={d.path} className="rule"><button className="link" onClick={() => browse(d.path)}>{d.name}</button></li>
                  ))}
                </ul>
              )}
            </>
          )}
          {items && (
            <>
              {items.length === 0 ? <p className="notice">No importable files in that folder, or the manager already has them.</p> : (
                <ul className="rule-list">
                  {items.map((i) => (
                    <li key={i.path} className={`rule ${picked.has(i.path) ? "on" : ""}`}>
                      <label className="inline">
                        <input
                          type="checkbox"
                          disabled={!i.match}
                          checked={picked.has(i.path)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i.path); else n.delete(i.path); return n; })}
                        />
                        <strong>{i.match ?? "Couldn't match this to a title"}</strong>
                      </label>
                      <div className="muted small">{i.name}{i.sizeBytes ? ` · ${formatBytes(i.sizeBytes)}` : ""}</div>
                      {i.rejections.length > 0 && <div className="muted small">Manager notes: {i.rejections.join("; ")}</div>}
                    </li>
                  ))}
                </ul>
              )}
              {items.length > 0 && (
                <div className="actions">
                  <select value={mode} onChange={(e) => setMode(e.target.value as "move" | "copy")} aria-label="Move or copy">
                    <option value="move">Move into the library</option>
                    <option value="copy">Copy (keep seeding the original)</option>
                  </select>
                  <button className="btn primary" disabled={busy || picked.size === 0} onClick={run}>{busy ? "Working…" : `Import ${picked.size}`}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

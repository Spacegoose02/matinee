import { useEffect, useState } from "react";
import { KIND_LABELS, api, formatBytes, type DetectResult, type StorageResponse, type StorageRow } from "../api";
import { Icon } from "../components/Icons";
import { useStore } from "../store";

const rowKey = (r: { serviceId: string; path: string }) => `${r.serviceId}|${r.path}`;

/** Maps each Radarr/Sonarr folder to a folder Matinee can see, so free space is measured, not guessed by the manager. */
export function StorageSettings() {
  const { toast } = useStore();
  const [data, setData] = useState<StorageResponse>();
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<Record<string, DetectResult>>({});

  const load = async () => {
    try {
      const res = await api.storage();
      setData(res);
      setDrafts((prev) => ({ ...Object.fromEntries(res.rows.map((r) => [rowKey(r), r.mappedPath ?? ""])), ...prev }));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (r: StorageRow, value: string | null) => {
    setBusy(rowKey(r));
    try {
      await api.setMapping(r.serviceId, r.path, value);
      setDrafts((d) => ({ ...d, [rowKey(r)]: value ?? "" }));
      await load();
      toast(value ? `Mapped ${r.path} → ${value}` : `Cleared the mapping for ${r.path}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };

  const pending = (data?.rows ?? []).filter((r) => (drafts[rowKey(r)] ?? "").trim() && (drafts[rowKey(r)] ?? "").trim() !== (r.mappedPath ?? ""));

  const saveAll = async () => {
    setBusy("all");
    try {
      for (const r of pending) await api.setMapping(r.serviceId, r.path, drafts[rowKey(r)].trim());
      await load();
      toast(`Saved ${pending.length} folder mapping${pending.length === 1 ? "" : "s"}.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };

  const detect = async () => {
    setDetecting(true);
    try {
      const res = await api.detectStorage();
      const found = Object.fromEntries(res.results.map((x) => [rowKey(x), x]));
      setDetected(found);
      setDrafts((d) => ({ ...d, ...Object.fromEntries(res.results.filter((x) => x.localPath).map((x) => [rowKey(x), x.localPath!])) }));
      const n = res.results.filter((x) => x.localPath).length;
      toast(n ? `Found ${n} of ${res.results.length} folders. Check them, then press Save on each.` : "Couldn't match any folders. Is the media share mounted into Matinee?", n ? "ok" : "error");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setDetecting(false);
    }
  };

  if (error) return <p className="notice error">Couldn't load storage: {error}</p>;
  if (!data) return <p className="muted">Loading storage…</p>;

  return (
    <section>
      <p className="muted">
        Radarr and Sonarr only know the free space of a folder <em>as they see it inside their own container</em>, which can be wrong on
        Unraid. Mount the same share into Matinee, tell it which folder is which, and Matinee measures the real disk itself.
      </p>

      {!data.mediaMounted ? (
        <div className="notice warn">
          <strong>Matinee can't see <code>{data.mediaDir}</code> yet.</strong> On Unraid: Docker → Matinee → Edit → <em>Add another Path</em> →
          Container Path <code>{data.mediaDir}</code>, Host Path <code>/mnt/user</code> (or the share holding your media), Access Mode <em>Read Only</em> → Apply.
          Then come back here and press <em>Detect folders</em>.
        </div>
      ) : data.mediaReadError || data.mediaEntries.length === 0 ? (
        <div className="notice warn">
          <strong><code>{data.mediaDir}</code> exists but looks {data.mediaReadError ? `unreadable (${data.mediaReadError})` : "empty"} from inside Matinee.</strong>{" "}
          If the host path is a remote or Unassigned Devices share (<code>/mnt/remotes/…</code>), edit the container and set that path's Access Mode to
          <em> Read Only - Slave</em>, then restart it. Otherwise make sure the folder is readable by user <code>nobody</code> (99:100).
        </div>
      ) : (
        <p className="muted small">
          Matinee can see {data.mediaEntries.length} folders in <code>{data.mediaDir}</code>: {data.mediaEntries.slice(0, 12).join(", ")}{data.mediaEntries.length > 12 ? "…" : ""}
        </p>
      )}
      <datalist id="media-folders">
        {data.mediaEntries.map((name) => <option key={name} value={`${data.mediaDir}/${name}`} />)}
      </datalist>

      {data.errors.map((e) => (
        <p key={e.serviceId} className="notice error"><strong>{e.name}</strong>: {e.message}</p>
      ))}

      <div className="storage-bar">
        <button className="btn" onClick={detect} disabled={detecting || !data.mediaMounted}>
          <Icon name="search" size={16} /> {detecting ? "Looking…" : "Detect folders"}
        </button>
        {pending.length > 1 && (
          <button className="btn primary" onClick={saveAll} disabled={busy === "all"}>Save all {pending.length}</button>
        )}
        <span className="muted small">Looks for each folder's titles under {data.mediaDir}.</span>
      </div>

      {data.rows.length === 0 ? (
        <p className="muted empty-line">Connect Radarr or Sonarr first; their folders show up here.</p>
      ) : (
        <ul className="storage-list">
          {data.rows.map((r) => {
            const key = rowKey(r);
            const draft = drafts[key] ?? "";
            const changed = draft !== (r.mappedPath ?? "");
            const used = r.totalBytes && r.freeBytes !== undefined ? 1 - r.freeBytes / r.totalBytes : undefined;
            const hit = detected[key];
            return (
              <li key={key} className="storage-row">
                <div className="storage-head">
                  <span className={`chip kind-${r.kind}`}>{r.serviceName || KIND_LABELS[r.kind]}</span>
                  <code>{r.path}</code>
                  <span className="muted small">
                    {r.serviceName} reports {r.reportedFreeBytes !== undefined ? `${formatBytes(r.reportedFreeBytes)} free` : "no free space"}
                  </span>
                </div>

                <div className="row-form">
                  <input
                    value={draft}
                    placeholder={`Folder inside Matinee, e.g. ${data.mediaDir}/Movies`}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    list="media-folders"
                    spellCheck={false}
                  />
                  <button className="btn primary" disabled={busy === key || !changed || !draft.trim()} onClick={() => save(r, draft.trim())}>Save</button>
                  {r.mappedPath && <button className="btn ghost" disabled={busy === key} onClick={() => save(r, null)}>Clear</button>}
                </div>
                {hit && hit.localPath && !r.mappedPath && (
                  <p className="muted small">Matched {hit.hits} of {hit.tried} sample titles in <code>{hit.localPath}</code>.</p>
                )}
                {hit && !hit.localPath && (
                  <p className="muted small">
                    {hit.tried === 0
                      ? `${r.serviceName} has no titles in this folder to look for. Enter the folder by hand if you want it measured.`
                      : `Looked for ${hit.samples.map((s) => `“${s}”`).join(" and ")} under ${data.mediaDir} and found nothing. Pick the folder from the list or type it.`}
                  </p>
                )}

                {r.problem && <p className="notice error">{r.problem}</p>}
                {used !== undefined && r.freeBytes !== undefined && r.totalBytes !== undefined && (
                  <div className="meter-wrap">
                    <div className="meter"><span className={used > 0.9 ? "bad" : used > 0.75 ? "warn" : ""} style={{ width: `${Math.round(used * 100)}%` }} /></div>
                    <span className="small"><strong>{formatBytes(r.freeBytes)}</strong> free of {formatBytes(r.totalBytes)} · measured by Matinee</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

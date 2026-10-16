import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { KIND_LABELS, api, formatBytes, formatRuntime, type AddOptions } from "../api";
import { useStore } from "../store";
import { Poster } from "./Cards";
import { Icon } from "./Icons";
import { TrailerPlayer } from "./Trailers";
import type { DiscoverGroup } from "../pages/Discover";

const LOW_SPACE_BYTES = 2 * 1024 ** 3;

const lastChoiceKey = (serviceId: string) => `marquee.add.${serviceId}`;

function loadLast(serviceId: string): { root?: string; profile?: number } {
  try {
    return JSON.parse(localStorage.getItem(lastChoiceKey(serviceId)) ?? "{}");
  } catch {
    return {};
  }
}

/** Dialog for sending a found title to Radarr/Sonarr with a chosen folder and quality profile. */
export function AddModal({ group, onClose, onAdded }: { group: DiscoverGroup; onClose: () => void; onAdded: () => void }) {
  const [watching, setWatching] = useState(false);
  const lookup = useMemo(() => ({ type: group.type, tmdb: group.ids.tmdb, title: group.title, year: group.year }), [group]);
  const { services, reload, openItem } = useStore();
  const candidates = group.entries.filter((e) => !e.inLibrary && services[e.serviceId]).map((e) => services[e.serviceId]);

  const [serviceId, setServiceId] = useState(candidates[0]?.id ?? "");
  const [options, setOptions] = useState<AddOptions>();
  const [loadError, setLoadError] = useState<string>();
  const [root, setRoot] = useState("");
  const [profile, setProfile] = useState<number>();
  const [monitored, setMonitored] = useState(true);
  const [searchNow, setSearchNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ alreadyAdded: boolean; key?: string }>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !watching && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, watching]);

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    setOptions(undefined);
    setLoadError(undefined);
    api.addOptions(serviceId).then(
      (o) => {
        if (cancelled) return;
        const last = loadLast(serviceId);
        setOptions(o);
        setRoot(o.rootFolders.find((r) => r.path === last.root)?.path ?? o.rootFolders[0]?.path ?? "");
        setProfile(o.qualityProfiles.find((p) => p.id === last.profile)?.id ?? o.qualityProfiles[0]?.id);
      },
      (err) => !cancelled && setLoadError((err as Error).message),
    );
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!root || profile === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.add({ serviceId, title: group.title, year: group.year, ids: group.ids, rootFolderPath: root, qualityProfileId: profile, monitored, searchNow });
      try {
        localStorage.setItem(lastChoiceKey(serviceId), JSON.stringify({ root, profile }));
      } catch {
        // Remembering the choice is a convenience only.
      }
      setDone({ alreadyAdded: Boolean(res.alreadyAdded), key: res.key });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const target = services[serviceId];
  const free = options?.rootFolders.find((r) => r.path === root)?.freeBytes;
  const lowSpace = free !== undefined && free < LOW_SPACE_BYTES;
  const measured = options?.rootFolders.find((r) => r.path === root)?.freeSource === "mounted";
  const facts = [group.year, formatRuntime(group.runtimeMinutes), group.type === "series" && group.seasons ? `${group.seasons} season${group.seasons === 1 ? "" : "s"}` : undefined, group.studio]
    .filter(Boolean)
    .join(" · ");

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-label={`Add ${group.title}`}>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        <div className="modal-head">
          <Poster src={group.poster} title={group.title} className="modal-poster" />
          <div>
            <h2>{group.title}</h2>
            <div className="muted small">{facts}</div>
            {group.overview && <p className="modal-overview">{group.overview}</p>}
            <button type="button" className="btn" onClick={() => setWatching(true)}>
              <Icon name="play" size={16} /> Watch trailer
            </button>
          </div>
        </div>

        {done ? (
          <div className="modal-done">
            <Icon name={done.alreadyAdded ? "check" : "download"} size={28} />
            <p>
              {done.alreadyAdded ? (
                <>
                  <strong>It's already in {target ? KIND_LABELS[target.kind] : "your library"}.</strong> I've refreshed your library
                  {done.key
                    ? " — open it to search for it or pick a release."
                    : `, but I can't find it in its series list. Check it in ${target ? KIND_LABELS[target.kind] : "the manager"} directly.`}
                </>
              ) : (
                <>
                  <strong>Added to {target ? KIND_LABELS[target.kind] : "your library"}.</strong>
                  {searchNow ? " It's searching for a release now." : " It will be picked up on the next search."}
                </>
              )}
            </p>
            <div className="actions">
              {done.key && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={async () => {
                    onClose();
                    await reload(false); // pick up the new title, then open it
                    openItem(done.key);
                  }}
                >
                  Open it
                </button>
              )}
              {!done.alreadyAdded && <a className={`btn ${done.key ? "" : "primary"}`} href="#/downloads" onClick={onClose}>Watch downloads</a>}
              <button type="button" className="btn ghost" onClick={onClose}>Keep searching</button>
            </div>
          </div>
        ) : candidates.length === 0 ? (
          <p className="notice error">No connected Radarr/Sonarr can add this right now.</p>
        ) : (
          <>
            {candidates.length > 1 && (
              <label>
                Add to
                <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  {candidates.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({KIND_LABELS[s.kind]})</option>
                  ))}
                </select>
              </label>
            )}

            {loadError ? (
              <p className="notice error">Couldn't read {target?.name}'s folders and profiles: {loadError}</p>
            ) : !options ? (
              <p className="muted">Loading {target?.name}'s folders and profiles…</p>
            ) : (
              <>
                <label>
                  Folder
                  <select value={root} onChange={(e) => setRoot(e.target.value)} required>
                    {options.rootFolders.map((r) => (
                      <option key={r.path} value={r.path}>
                        {r.path}{r.freeBytes !== undefined ? (r.freeBytes < LOW_SPACE_BYTES ? ` — ⚠ only ${formatBytes(r.freeBytes)} free` : ` — ${formatBytes(r.freeBytes)} free${r.freeSource === "mounted" ? " (measured)" : ""}`) : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted small field-note">
                  {measured
                    ? "Free space measured by Matinee on the mapped folder."
                    : <>Free space is what {target?.name} reports for that folder. <a className="link" href="#/settings/storage" onClick={onClose}>Measure it properly</a></>}
                </span>
                {lowSpace && (
                  <p className="notice warn">
                    {measured
                      ? "That disk is nearly full."
                      : <>{target?.name} reports almost no space in this folder. That usually means it isn't mapped to a real share in {target?.name}'s container — check its path mapping before adding, or downloads may fill the wrong disk.</>}
                  </p>
                )}
                <label>
                  Quality profile
                  <select value={profile} onChange={(e) => setProfile(Number(e.target.value))} required>
                    {options.qualityProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="inline">
                  <input type="checkbox" checked={monitored} onChange={(e) => setMonitored(e.target.checked)} />
                  Monitor it (keep looking for better releases and new episodes)
                </label>
                <label className="inline">
                  <input type="checkbox" checked={searchNow} onChange={(e) => setSearchNow(e.target.checked)} />
                  Search for it right away
                </label>
              </>
            )}

            {error && <p className="notice error">{error}</p>}

            <div className="actions">
              <button className="btn primary" disabled={busy || !options || !root || profile === undefined}>
                <Icon name="plus" size={16} /> {busy ? "Adding…" : `Add to ${target ? KIND_LABELS[target.kind] : "library"}`}
              </button>
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </form>
      {watching && <TrailerPlayer lookup={lookup} title={group.title} onClose={() => setWatching(false)} />}
    </div>,
    document.body,
  );
}

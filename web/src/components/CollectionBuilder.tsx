import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type OpResult } from "../api";
import { useIncremental } from "../hooks";
import { useStore } from "../store";
import { Poster } from "./Cards";
import { Icon } from "./Icons";
import { PlanView, hasChanges } from "./PlanView";

interface Props {
  onClose: () => void;
  /** Editing an existing collection: its name and current titles. */
  initial?: { name: string; keys: string[] };
}

/** Make a new collection (or change an existing one) on Plex and/or Jellyfin, with a preview before anything is written. */
export function CollectionBuilder({ onClose, initial }: Props) {
  const { items, services, libraries, reload, toast } = useStore();
  const servers = useMemo(() => Object.values(services).filter((s) => s.enabled && (s.kind === "plex" || s.kind === "jellyfin")), [services]);
  const [name, setName] = useState(initial?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.keys ?? []));
  const [serverIds, setServerIds] = useState<Set<string>>(new Set(servers.map((s) => s.id)));
  const [mirror, setMirror] = useState(false);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<{ results: OpResult[]; done: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only titles at least one chosen server has can go into its collection.
  const pickable = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => i.type !== "book" && i.available.some((a) => serverIds.has(a.serviceId)) && (!q || i.title.toLowerCase().includes(q)))
      .sort((a, b) => Number(selected.has(b.key)) - Number(selected.has(a.key)) || a.title.localeCompare(b.title));
  }, [items, serverIds, query, selected.size === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const { shown, sentinel, hasMore, showMore } = useIncremental(pickable, 48);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) for (const t of i.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const addAll = (keys: string[]) => setSelected((prev) => new Set([...prev, ...keys]));

  const body = () => ({ ops: [{ name: name.trim(), memberKeys: [...selected], serviceIds: [...serverIds], mirror }] });
  const ready = name.trim().length > 0 && selected.size > 0 && serverIds.size > 0;

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.runCollections({ ...body(), dryRun });
      setPlan({ results: res.results, done: !dryRun });
      if (!dryRun) {
        toast(`“${name.trim()}” is up to date on ${res.results[0]?.plans.map((p) => p.serviceName).join(" and ")}.`);
        reload(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide builder" role="dialog" aria-label="Collection maker">
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <div>
          <h2>{initial ? "Edit collection" : "New collection"}</h2>
          <span className="muted">Choose titles from your library; Matinee puts them in a collection on each server you pick.</span>
        </div>

        <div className="builder-top">
          <label>
            Name
            <input value={name} onChange={(e) => { setName(e.target.value); setPlan(undefined); }} placeholder="e.g. Christmas Classics" />
          </label>
          <fieldset>
            <legend>On</legend>
            {servers.map((s) => (
              <label key={s.id} className="inline">
                <input
                  type="checkbox"
                  checked={serverIds.has(s.id)}
                  onChange={() => {
                    setServerIds((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(s.id)) next.add(s.id);
                      return next;
                    });
                    setPlan(undefined);
                  }}
                />
                {s.name}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="builder-tools">
          <input type="search" placeholder="Search your library" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tags.length > 0 && (
            <select value="" aria-label="Add everything with a tag" onChange={(e) => e.target.value && addAll(items.filter((i) => i.tags?.includes(e.target.value) && i.available.some((a) => serverIds.has(a.serviceId))).map((i) => i.key))}>
              <option value="">+ Add all tagged…</option>
              {tags.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
            </select>
          )}
          <select value="" aria-label="Add a whole library" onChange={(e) => e.target.value && addAll(items.filter((i) => i.libraries.some((l) => l.toLowerCase() === e.target.value.toLowerCase())).map((i) => i.key))}>
            <option value="">+ Add whole library…</option>
            {libraries.filter((l) => l.type !== "book").map((l) => <option key={l.name} value={l.name}>{l.name} ({l.count})</option>)}
          </select>
          <span className="muted small selected-count">{selected.size} selected</span>
          {selected.size > 0 && <button className="btn ghost small-btn" onClick={() => setSelected(new Set())}>Clear</button>}
        </div>

        <div className="builder-grid">
          {shown.map((i) => (
            <button key={i.key} type="button" className={`pick ${selected.has(i.key) ? "on" : ""}`} onClick={() => { toggle(i.key); setPlan(undefined); }} title={i.title}>
              <Poster src={i.poster} title={i.title} />
              <span className="pick-check"><Icon name="check" size={14} /></span>
              <span className="pick-title">{i.title}</span>
            </button>
          ))}
          {pickable.length === 0 && <p className="muted">No titles match.</p>}
          {hasMore && (
            <div className="more" ref={sentinel}>
              <button type="button" className="btn" onClick={showMore}>Show more</button>
            </div>
          )}
        </div>

        {initial && (
          <label className="inline">
            <input type="checkbox" checked={mirror} onChange={(e) => { setMirror(e.target.checked); setPlan(undefined); }} />
            Also remove titles I've unticked from the collection
          </label>
        )}

        {plan && <PlanView results={plan.results} done={plan.done} />}
        {error && <p className="notice error">{error}</p>}

        <div className="actions">
          <button className="btn" disabled={!ready || busy} onClick={() => run(true)}>Preview changes</button>
          <button className="btn primary" disabled={!ready || busy || (plan !== undefined && !plan.done && !hasChanges(plan.results))} onClick={() => run(false)}>
            {busy ? "Working…" : initial ? "Save changes" : "Create collection"}
          </button>
          <button className="btn ghost" onClick={onClose}>{plan?.done ? "Close" : "Cancel"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Previews, then applies, a sync of one or more collections so every server holds the same titles. */
export function SyncModal({ names, onClose }: { names: string[]; onClose: () => void }) {
  const { reload, toast } = useStore();
  const [plan, setPlan] = useState<{ results: OpResult[]; done: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.runCollections({ sync: names, dryRun: true }).then((r) => setPlan({ results: r.results, done: false }), (e) => setError((e as Error).message));
  }, [names]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.runCollections({ sync: names });
      setPlan({ results: r.results, done: true });
      toast(names.length === 1 ? `Synced “${names[0]}”.` : `Synced ${names.length} collections.`);
      reload(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Sync collections">
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <div>
          <h2>Sync {names.length === 1 ? `“${names[0]}”` : `${names.length} collections`}</h2>
          <span className="muted">Every server gets the titles the others have, if it has them too. Nothing is removed.</span>
        </div>
        {!plan && !error && <p className="muted">Working out what would change…</p>}
        {plan && <PlanView results={plan.results} done={plan.done} />}
        {error && <p className="notice error">{error}</p>}
        <div className="actions">
          {plan && !plan.done && (
            hasChanges(plan.results)
              ? <button className="btn primary" disabled={busy} onClick={apply}>{busy ? "Syncing…" : "Sync now"}</button>
              : <span className="muted">Already identical wherever the titles exist.</span>
          )}
          <button className="btn ghost" onClick={onClose}>{plan?.done ? "Close" : "Cancel"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

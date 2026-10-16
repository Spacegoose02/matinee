import { useMemo, useState } from "react";
import { api, type MediaItem } from "../api";
import { Card, CollectionCard } from "../components/Cards";
import { CollectionBuilder, SyncModal } from "../components/CollectionBuilder";
import { ErrorList } from "../components/ErrorList";
import { Icon } from "../components/Icons";
import { CollectionCover } from "../components/CollectionCover";
import { TagRules } from "../components/TagRules";
import { useIncremental } from "../hooks";
import { useStore } from "../store";

type Sort = "name" | "size";

export function Collections({ selected }: { selected?: string }) {
  const { collections, byKey, services, errors, loading } = useStore();
  const [view, setView] = useState<"all" | "tags">("all");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [minSize, setMinSize] = useState(2);
  const [onlyOutOfSync, setOnlyOutOfSync] = useState(false);
  const [building, setBuilding] = useState<{ name: string; keys: string[] } | "new">();
  const [syncing, setSyncing] = useState<string[]>();

  const open = collections.find((c) => c.name === selected);
  const members = useMemo(
    () => (open?.memberKeys ?? []).map((k) => byKey.get(k)).filter((i): i is MediaItem => Boolean(i)),
    [open, byKey],
  );

  const outOfSync = useMemo(() => collections.filter((c) => c.needsSync), [collections]);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = collections.filter(
      (c) => (onlyOutOfSync ? c.needsSync : c.memberKeys.length >= minSize) && (!q || c.name.toLowerCase().includes(q)),
    );
    return sort === "size"
      ? filtered.sort((a, b) => b.memberKeys.length - a.memberKeys.length || a.name.localeCompare(b.name))
      : filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [collections, filter, sort, minSize, onlyOutOfSync]);

  const grid = useIncremental(list, 48);
  const memberGrid = useIncremental(members, 72);

  const serverCount = Object.values(services).filter((s) => s.enabled && (s.kind === "plex" || s.kind === "jellyfin")).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Collections</h1>
          <span className="muted">
            {collections.length.toLocaleString()} collections
            {outOfSync.length > 0 && ` · ${outOfSync.length.toLocaleString()} out of sync`}
          </span>
        </div>
        {serverCount > 0 && (
          <button className="btn primary" onClick={() => setBuilding("new")}>
            <Icon name="plus" size={16} /> New collection
          </button>
        )}
      </div>
      <ErrorList errors={errors} />

      <div className="segmented tabs">
        <button className={view === "all" ? "active" : undefined} onClick={() => setView("all")}>Collections</button>
        {serverCount > 0 && <button className={view === "tags" ? "active" : undefined} onClick={() => setView("tags")}>Tag rules</button>}
      </div>

      {view === "tags" ? (
        <TagRules />
      ) : (
        <>
          {open && (
            <section className="collection-open">
              <header className="shelf-head">
                <div><h2>{open.name}</h2><span className="muted small">{members.length.toLocaleString()} titles</span></div>
                <div className="shelf-actions">
                  <button className="btn" onClick={() => setBuilding({ name: open.name, keys: open.memberKeys })}>Edit titles</button>
                  {open.needsSync && <button className="btn primary" onClick={() => setSyncing([open.name])}>Sync servers</button>}
                  <a className="link" href="#/collections">Close</a>
                </div>
              </header>
              <CollectionCover collection={open} />
              <div className="grid">{memberGrid.shown.map((m) => <Card key={m.key} item={m} />)}</div>
              {memberGrid.hasMore && (
                <div className="more" ref={memberGrid.sentinel}>
                  <button className="btn" onClick={memberGrid.showMore}>Show more</button>
                </div>
              )}
            </section>
          )}

          <div className="filters">
            <input type="search" placeholder="Filter collections" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
              <option value="name">Name A–Z</option>
              <option value="size">Most titles</option>
            </select>
            <select value={minSize} onChange={(e) => setMinSize(Number(e.target.value))} aria-label="Minimum size" disabled={onlyOutOfSync}>
              <option value={1}>Any size</option>
              <option value={2}>2+ titles</option>
              <option value={5}>5+ titles</option>
              <option value={10}>10+ titles</option>
            </select>
            {serverCount > 1 && <FillCovers />}
            {outOfSync.length > 0 && (
              <>
                <button className={`chip removable ${onlyOutOfSync ? "chip-warn" : ""}`} onClick={() => setOnlyOutOfSync(!onlyOutOfSync)}>
                  Out of sync ({outOfSync.length})
                </button>
                <button className="btn" onClick={() => setSyncing(outOfSync.map((c) => c.name))}>Sync all {outOfSync.length}</button>
              </>
            )}
          </div>

          {list.length === 0 ? (
            <p className="muted empty-line">
              {loading ? "Loading collections…" : collections.length === 0 ? "No collections found. Make one with “New collection”, or create them in Plex or Jellyfin." : "No collections match."}
            </p>
          ) : (
            <>
              <div className="grid collections-grid">
                {grid.shown.map((c) => (
                  <CollectionCard
                    key={c.name}
                    collection={c}
                    selected={c.name === selected}
                    onClick={() => (location.hash = c.name === selected ? "#/collections" : `#/collections/${encodeURIComponent(c.name)}`)}
                  />
                ))}
              </div>
              {grid.hasMore && (
                <div className="more" ref={grid.sentinel}>
                  <span className="muted small">Showing {grid.shown.length.toLocaleString()} of {grid.total.toLocaleString()}</span>
                  <button className="btn" onClick={grid.showMore}>Show more</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {building && (
        <CollectionBuilder
          initial={building === "new" ? undefined : building}
          onClose={() => setBuilding(undefined)}
        />
      )}
      {syncing && <SyncModal names={syncing} onClose={() => setSyncing(undefined)} />}
    </div>
  );
}

/** Copy a cover onto each server that has none, from a server that has one. */
function FillCovers() {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.fillCollectionCovers();
      toast(r.failed.length ? `Copied ${r.filled} covers; ${r.failed.length} failed: ${r.failed[0]}` : r.filled ? `Copied ${r.filled} cover${r.filled === 1 ? "" : "s"}.` : "Every collection already has a cover on each server.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return <button className="btn" disabled={busy} onClick={run} title="For every collection, give each server without a cover the cover another server has">{busy ? "Copying covers…" : "Fill missing covers"}</button>;
}

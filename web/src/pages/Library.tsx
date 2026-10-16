import { useMemo, useState } from "react";
import { STATUS_LABELS, api, statusOf, watchOf, type MediaItem, type MediaType, type Status } from "../api";
import { Card } from "../components/Cards";
import { ErrorList } from "../components/ErrorList";
import { Icon } from "../components/Icons";
import { useIncremental } from "../hooks";
import { inLibrary, useStore } from "../store";

type SortKey = "title" | "added" | "year" | "rating" | "size";

const SORTS: Record<SortKey, { label: string; compare: (a: MediaItem, b: MediaItem) => number }> = {
  title: { label: "Title A–Z", compare: (a, b) => a.title.localeCompare(b.title) },
  added: { label: "Recently added", compare: (a, b) => (b.added ?? "").localeCompare(a.added ?? "") },
  year: { label: "Newest release", compare: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
  rating: { label: "Top rated", compare: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) },
  size: { label: "Largest", compare: (a, b) => (b.managed?.sizeBytes ?? 0) - (a.managed?.sizeBytes ?? 0) },
};

const KIND_TITLES: Record<MediaType, string> = { movie: "Movies", series: "TV Shows", book: "Audiobooks" };

/** Everything in one view, or just one kind of media (the Movies / TV Shows / Audiobooks pages), optionally one library. */
export function Library({ kind, library }: { kind?: MediaType; library?: string }) {
  const { items, errors, query, setQuery, loading, reload, fetchedAt, failure, services, toast } = useStore();
  const [status, setStatus] = useState<"all" | Status>("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [watch, setWatch] = useState<"all" | "unwatched" | "inprogress" | "watched">("all");
  const [bulkBusy, setBulkBusy] = useState(false);

  const scoped = useMemo(
    () => items.filter((i) => (!kind || i.type === kind) && (!library || inLibrary(i, library))),
    [items, kind, library],
  );

  const counts = useMemo(() => {
    const c: Record<Status, number> = { available: 0, "on-disk": 0, missing: 0, unmanaged: 0 };
    for (const i of scoped) c[statusOf(i)]++;
    return c;
  }, [scoped]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter(
        (i) =>
          (status === "all" || statusOf(i) === status) &&
          (watch === "all" || watchOf(i)?.state === watch) &&
          (!q || i.title.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q)),
      )
      .sort(SORTS[sort].compare);
  }, [scoped, status, query, sort, watch]);
  const hasWatch = useMemo(() => scoped.some((i) => watchOf(i)), [scoped]);

  const { shown, sentinel, hasMore, showMore, total } = useIncremental(visible);

  // Monitored titles the manager is missing files for; unmonitored ones would be ignored by a search.
  const searchable = status === "missing" ? visible.filter((i) => i.managed?.arrId !== undefined && i.managed.monitored) : [];

  const searchAllMissing = async () => {
    if (searchable.length > 10 && !confirm(`Ask Radarr/Sonarr to search for ${searchable.length} titles?`)) return;
    setBulkBusy(true);
    try {
      const byService = new Map<string, number[]>();
      for (const i of searchable) byService.set(i.managed!.serviceId, [...(byService.get(i.managed!.serviceId) ?? []), i.managed!.arrId!]);
      for (const [serviceId, ids] of byService) {
        for (let n = 0; n < ids.length; n += 100) await api.searchDownloads(serviceId, ids.slice(n, n + 100));
      }
      const where = [...byService.keys()].map((id) => services[id]?.name).filter(Boolean).join(" and ");
      toast(`Searching for ${searchable.length} title${searchable.length === 1 ? "" : "s"} in ${where}. Anything found shows up under Downloads.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBulkBusy(false);
    }
  };

  if (failure) return <p className="notice error">Couldn't load the library: {failure}</p>;

  const title = library ?? (kind ? KIND_TITLES[kind] : "Library");
  const showStatus = kind !== "book";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <span className="muted">
            {library && kind ? `${KIND_TITLES[kind]} · ` : ""}
            {visible.length.toLocaleString()} of {scoped.length.toLocaleString()} titles
            {fetchedAt && ` · updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </span>
        </div>
        <button className="btn" onClick={() => reload(true)} disabled={loading}>
          <Icon name="refresh" size={16} /> {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <ErrorList errors={errors} />

      <div className="filters">
        {showStatus && (
          <div className="segmented wrap">
            <button className={status === "all" ? "active" : undefined} onClick={() => setStatus("all")}>Any status</button>
            {(Object.keys(STATUS_LABELS) as Status[]).filter((s) => counts[s] > 0 || status === s).map((s) => (
              <button key={s} className={status === s ? "active" : undefined} onClick={() => setStatus(s)}>
                {STATUS_LABELS[s]} <span className="count">{counts[s].toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
        {hasWatch && (
          <select value={watch} onChange={(e) => setWatch(e.target.value as typeof watch)} aria-label="Watch status">
            <option value="all">Any watch status</option>
            <option value="unwatched">Not watched</option>
            <option value="inprogress">In progress</option>
            <option value="watched">Watched</option>
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          {(Object.keys(SORTS) as SortKey[]).map((k) => (
            <option key={k} value={k}>{SORTS[k].label}</option>
          ))}
        </select>
        {searchable.length > 0 && (
          <button className="btn primary" onClick={searchAllMissing} disabled={bulkBusy}>
            <Icon name="download" size={16} /> {bulkBusy ? "Starting…" : `Search for all ${searchable.length} missing`}
          </button>
        )}
        {query && (
          <button className="chip removable" onClick={() => setQuery("")}>
            “{query}” <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="muted empty-line">
          {scoped.length === 0 ? "Nothing in here yet." : "No titles match these filters."}
          {query.trim().length >= 2 && (
            <>
              {" "}
              <a className="link" href={`#/discover/${encodeURIComponent(query.trim())}`}>Search “{query.trim()}” to add it →</a>
            </>
          )}
        </p>
      ) : (
        <>
          <div className="grid">
            {shown.map((item) => <Card key={item.key} item={item} />)}
          </div>
          {hasMore && (
            <div className="more" ref={sentinel}>
              <span className="muted small">Showing {shown.length.toLocaleString()} of {total.toLocaleString()}</span>
              <button className="btn" onClick={showMore}>Show more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

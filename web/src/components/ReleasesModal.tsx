import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatBytes, type MediaItem, type ReleaseInfo, type SeasonInfo } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";

type Sort = "best" | "seeders" | "size" | "newest";

function formatAge(days?: number): string {
  if (days === undefined) return "—";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 365) return `${Math.round(days)}d`;
  return `${(days / 365).toFixed(1)}y`;
}

/**
 * Manual ("interactive") search: lists what the indexers found for a title so you can pick the
 * release yourself, including ones Radarr/Sonarr would reject on their own.
 */
export function ReleasesModal({ item, onClose, episode }: { item: MediaItem; onClose: () => void; episode?: { id: number; label: string } }) {
  const { services, toast } = useStore();
  const m = item.managed!;
  const manager = services[m.serviceId];
  const isSeries = item.type === "series" && !episode;

  const [seasons, setSeasons] = useState<SeasonInfo[]>();
  const [season, setSeason] = useState<number>();
  const [releases, setReleases] = useState<ReleaseInfo[]>();
  const [error, setError] = useState<string>();
  const [hideRejected, setHideRejected] = useState(false);
  const [sort, setSort] = useState<Sort>("best");
  const [filter, setFilter] = useState("");
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [grabbing, setGrabbing] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  // Shows are searched a season at a time; start on the newest season that still has gaps.
  useEffect(() => {
    if (!isSeries) return;
    api.seasons(m.serviceId, m.arrId!).then(
      (list) => {
        setSeasons(list);
        const real = list.filter((s) => s.season > 0).reverse();
        setSeason((real.find((s) => s.have < s.total) ?? real[0] ?? list[0])?.season);
      },
      (err) => setError((err as Error).message),
    );
  }, [isSeries, m.serviceId, m.arrId]);

  useEffect(() => {
    if (isSeries && season === undefined) {
      if (seasons) setReleases([]); // a show with no seasons has nothing to search
      return;
    }
    let cancelled = false;
    setReleases(undefined);
    setError(undefined);
    api.releases(m.serviceId, m.arrId!, season, episode?.id).then(
      (r) => !cancelled && setReleases(r),
      (err) => !cancelled && setError((err as Error).message),
    );
    return () => {
      cancelled = true;
    };
  }, [isSeries, season, seasons, m.serviceId, m.arrId, episode?.id]);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = (releases ?? []).filter(
      (r) =>
        (!hideRejected || r.approved) &&
        (!q || r.title.toLowerCase().includes(q) || r.indexer?.toLowerCase().includes(q) || r.quality?.toLowerCase().includes(q)),
    );
    const sorted = [...filtered];
    if (sort === "seeders") sorted.sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
    else if (sort === "size") sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    else if (sort === "newest") sorted.sort((a, b) => (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9));
    else sorted.sort((a, b) => Number(b.approved) - Number(a.approved)); // stable: keeps the manager's own ranking
    return sorted;
  }, [releases, hideRejected, filter, sort]);

  const grab = async (r: ReleaseInfo) => {
    if (!r.approved && !confirm(`${manager?.name ?? "The manager"} rejected this release:\n\n${r.rejections.join("\n") || "(no reason given)"}\n\nDownload it anyway?`)) return;
    setGrabbing(r.guid);
    try {
      await api.grab(m.serviceId, r.guid, r.indexerId);
      setSent((s) => new Set(s).add(r.guid));
      toast(`Sent “${r.title}” to your download client. It shows up under Downloads.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setGrabbing(undefined);
    }
  };

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={`Releases for ${item.title}`}>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div>
          <h2>Find releases</h2>
          <span className="muted">{item.title}{episode ? ` · ${episode.label}` : item.year ? ` (${item.year})` : ""} · via {manager?.name ?? "manager"}</span>
        </div>

        <div className="release-tools">
          {isSeries && seasons && (
            <select value={season ?? ""} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season">
              {seasons.map((s) => (
                <option key={s.season} value={s.season}>
                  {s.season === 0 ? "Specials" : `Season ${s.season}`} ({s.have}/{s.total} episodes)
                </option>
              ))}
            </select>
          )}
          <input type="search" placeholder="Filter by title, quality or indexer" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
            <option value="best">Best match</option>
            <option value="seeders">Most seeders</option>
            <option value="size">Largest</option>
            <option value="newest">Newest</option>
          </select>
          <label className="inline">
            <input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} /> Hide rejected
          </label>
        </div>

        {error ? (
          <p className="notice error">{error}</p>
        ) : !releases ? (
          <div className="release-wait">
            <Icon name="refresh" size={22} />
            <p>Asking your indexers…</p>
            <span className="muted small">This can take up to a minute or two, depending on how many indexers you have.</span>
          </div>
        ) : list.length === 0 ? (
          <p className="muted empty-line">
            {releases.length === 0 ? "No releases found." : "No releases match these filters."}
          </p>
        ) : (
          <ul className="release-list">
            {list.map((r) => (
              <li key={r.guid} className={`release ${r.approved ? "" : "rejected"}`}>
                <div className="release-main">
                  <div className="release-title" title={r.title}>{r.title}</div>
                  <div className="release-meta">
                    {r.quality && <span className="chip">{r.quality}</span>}
                    {r.detail && <span className="chip">{r.detail}</span>}
                    {r.protocol && <span className="chip dim">{r.protocol}</span>}
                    <span>{formatBytes(r.sizeBytes)}</span>
                    <span>{formatAge(r.ageDays)}</span>
                    {r.protocol === "torrent" && <span title="Seeders / leechers">▲ {r.seeders ?? 0} / {r.leechers ?? 0}</span>}
                    {r.indexer && <span className="muted">{r.indexer}</span>}
                    {r.languages?.length ? <span className="muted">{r.languages.join(", ")}</span> : null}
                  </div>
                  {!r.approved && r.rejections.length > 0 && <div className="release-reject">⚠ {r.rejections.join(" · ")}</div>}
                </div>
                <button
                  className={`btn ${r.approved ? "primary" : ""}`}
                  disabled={grabbing === r.guid || sent.has(r.guid)}
                  onClick={() => grab(r)}
                >
                  <Icon name="download" size={16} /> {sent.has(r.guid) ? "Sent" : grabbing === r.guid ? "Sending…" : "Grab"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

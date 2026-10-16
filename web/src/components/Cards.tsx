import { memo, useState } from "react";
import { STATUS_LABELS, statusOf, watchOf, type Collection, type MediaItem } from "../api";
import { useActions, useStore } from "../store";

/** Poster image that falls back to a lettered tile when the artwork is missing or fails to load. */
export function Poster({ src, title, className = "", children }: { src?: string; title: string; className?: string; children?: React.ReactNode }) {
  const [failed, setFailed] = useState<string>();
  const show = src && failed !== src;
  return (
    <div className={`poster ${className}`}>
      {show ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
      ) : (
        <span className="poster-fallback">{title.slice(0, 1).toUpperCase()}</span>
      )}
      {children}
    </div>
  );
}

const RESOLUTION_RANK = ["SD", "720p", "1080p", "4K"];

/** Best picture quality we know of: the manager's release name, else the best server resolution. */
export function qualityLabel(item: MediaItem): string | undefined {
  const best = item.available
    .map((a) => a.resolution)
    .filter((r): r is string => Boolean(r))
    .sort((a, b) => RESOLUTION_RANK.indexOf(b) - RESOLUTION_RANK.indexOf(a))[0];
  return best ?? item.managed?.quality?.replace(/^(WEBDL|WEBRip|Bluray|HDTV|Remux)-/i, "");
}

// Memoised and fed only by stable actions: a page of hundreds of cards shouldn't re-render
// because a toast appeared or the search box changed.
export const Card = memo(function Card({ item }: { item: MediaItem }) {
  const { openItem } = useActions();
  const status = statusOf(item);
  const quality = qualityLabel(item);
  const watch = watchOf(item);
  return (
    <button className={`card status-${status}`} onClick={() => openItem(item.key)} title={item.title}>
      <Poster src={item.poster} title={item.title}>
        {watch?.state === "inprogress" && (
          <span className="watch-bar" title={`In progress${watch.progress ? ` · ${Math.round(watch.progress * 100)}%` : ""}`}>
            <span style={{ width: `${Math.max(4, Math.round((watch.progress ?? 0.05) * 100))}%` }} />
          </span>
        )}
        {watch?.state === "watched" && <span className="watch-done" title="Watched">✓</span>}
      </Poster>
      {quality && <span className="tag tag-quality">{quality}</span>}
      {(status === "missing" || status === "on-disk") && <span className={`tag tag-status ${status}`}>{STATUS_LABELS[status]}</span>}
      <span className="card-meta">
        <span className="card-title">{item.title}</span>
        <span className="card-sub">
          {item.type === "book" ? item.author ?? "Audiobook" : item.year ?? "—"}
          {item.managed?.episodes && ` · ${item.managed.episodes.have}/${item.managed.episodes.total} eps`}
        </span>
      </span>
    </button>
  );
});

export const CollectionCard = memo(function CollectionCard({ collection, onClick, selected }: { collection: Collection; onClick?: () => void; selected?: boolean }) {
  const { byKey, services } = useStore();
  const members = collection.memberKeys.map((k) => byKey.get(k)).filter((m): m is MediaItem => Boolean(m));
  const own = Boolean(collection.poster);
  const covers = own ? [] : members.filter((m) => m.poster).slice(0, 4);
  // Servers that can hold collections but don't have this one yet.
  const missingOn = Object.values(services).filter(
    (s) => s.enabled && (s.kind === "plex" || s.kind === "jellyfin") && !collection.services.some((c) => c.serviceId === s.id),
  );
  return (
    <button className={`collection-card ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className={`mosaic mosaic-${Math.max(covers.length, 1)}`}>
        {collection.poster ? <img src={collection.poster} alt="" loading="lazy" decoding="async" /> : covers.length ? covers.map((m) => <img key={m.key} src={m.poster} alt="" loading="lazy" decoding="async" />) : <span className="poster-fallback">{collection.name.slice(0, 1)}</span>}
      </span>
      <span className="card-meta">
        <span className="card-title">{collection.name}</span>
        <span className="card-sub">{members.length} titles</span>
        <span className="chips">
          {collection.services.map((c) => (
            <span key={c.serviceId} className={`chip kind-${services[c.serviceId]?.kind}`}>{services[c.serviceId]?.name ?? "Server"}</span>
          ))}
          {missingOn.map((s) => (
            <span key={s.id} className="chip chip-warn" title={`${s.name} doesn't have this collection`}>no {s.name}</span>
          ))}
          {collection.needsSync && missingOn.length === 0 && <span className="chip chip-warn" title="Some titles are missing from one server's copy">out of sync</span>}
        </span>
      </span>
    </button>
  );
});

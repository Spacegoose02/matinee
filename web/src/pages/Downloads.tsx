import { useEffect, useMemo, useState } from "react";
import {
  KIND_LABELS, api, formatBytes, formatEta, type HistoryEvent, type HistoryItem, type QueueItem, type ServiceError, type ServiceKind,
} from "../api";
import { Activity } from "../components/Activity";
import { PauseAll, QueueControls, Torrents } from "../components/DownloadControls";
import { Trailers } from "../components/Trailers";
import { StuckImports } from "../components/StuckImports";
import { AudiobookRequests } from "../components/AudiobookRequests";
import { ErrorList } from "../components/ErrorList";
import { Icon } from "../components/Icons";
import { Sparkline } from "../components/Sparkline";
import { useQueue, useStore } from "../store";

const MANAGERS: ServiceKind[] = ["radarr", "sonarr"];

const tone = (q: QueueItem) => {
  if (q.warning || /error|missing/i.test(q.status)) return "bad";
  if (/stall|pause|queue|check|fetch/i.test(q.status)) return "idle";
  return "live";
};

export function Downloads({ tab: initialTab }: { tab?: string }) {
  const { services } = useStore();
  const hasRequests = Object.values(services).some((s) => s.kind === "readmeabook" && s.enabled);
  const [tab, setTab] = useState<"active" | "history" | "requests" | "stuck" | "trailers" | "torrents">(
    initialTab === "torrents" ? "torrents" : initialTab === "trailers" ? "trailers" : initialTab === "stuck" ? "stuck" : initialTab === "history" ? "history" : initialTab === "requests" ? "requests" : "active",
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Downloads</h1>
          <span className="muted">
            {tab === "active" ? "Live from your download clients · refreshes every 3 seconds" : tab === "torrents" ? "Everything in qBittorrent: pause, move or remove torrents" : tab === "trailers" ? "Trailers saved next to your movies and shows, for Plex and Jellyfin" : tab === "stuck" ? "Finished downloads Radarr or Sonarr could not move into your library" : tab === "history" ? "What was grabbed, downloaded and imported, newest first" : "Audiobooks you've asked ReadMeABook for"}
          </span>
        </div>
        <div className="segmented">
          <button className={tab === "active" ? "active" : undefined} onClick={() => setTab("active")}>Active</button>
          <button className={tab === "stuck" ? "active" : undefined} onClick={() => setTab("stuck")}>Stuck imports</button>
          <button className={tab === "torrents" ? "active" : undefined} onClick={() => setTab("torrents")}>Torrents</button>
          <button className={tab === "trailers" ? "active" : undefined} onClick={() => setTab("trailers")}>Trailers</button>
          <button className={tab === "history" ? "active" : undefined} onClick={() => setTab("history")}>History</button>
          {hasRequests && <button className={tab === "requests" ? "active" : undefined} onClick={() => setTab("requests")}>Requests</button>}
        </div>
      </div>
      {tab === "active" ? <><Activity /><ActiveDownloads /></> : tab === "torrents" ? <Torrents /> : tab === "trailers" ? <Trailers /> : tab === "stuck" ? <StuckImports /> : tab === "history" ? <History /> : <AudiobookRequests />}
    </div>
  );
}

function ActiveDownloads() {
  const { items, errors, failure, speeds, reload: reloadQueue } = useQueue(3000);
  const { services } = useStore();
  const [client, setClient] = useState<"all" | ServiceKind>("all");

  const downloads = useMemo(() => (items ?? []).filter((q) => !MANAGERS.includes(q.client)), [items]);
  const issues = useMemo(() => (items ?? []).filter((q) => q.warning), [items]);

  const shown = downloads.filter((q) => client === "all" || q.client === client);
  const groups = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const q of shown) map.set(q.serviceId, [...(map.get(q.serviceId) ?? []), q]);
    return [...map.entries()];
  }, [shown]);

  const clients = [...new Set(downloads.map((q) => q.client))];
  const speed = speeds[speeds.length - 1] ?? 0;
  const live = downloads.filter((q) => tone(q) === "live").length;
  const waiting = downloads.filter((q) => tone(q) === "idle").length;
  const remaining = downloads.reduce((sum, q) => sum + (q.sizeBytes ?? 0) * (1 - q.progress), 0);

  if (failure) return <p className="notice error">Can't reach the server: {failure}</p>;
  if (!items) return <p className="muted">Loading downloads…</p>;

  return (
    <>
      <ErrorList errors={errors} />

      <div className="stats">
        <div className="stat stat-wide">
          <span className="stat-label">Speed</span>
          <span className="stat-value">{formatBytes(speed)}<small>/s</small></span>
          <Sparkline values={speeds} />
        </div>
        <div className="stat"><span className="stat-label">Downloading</span><span className="stat-value">{live}</span></div>
        <div className="stat"><span className="stat-label">Waiting</span><span className="stat-value">{waiting}</span></div>
        <div className="stat"><span className="stat-label">Left to fetch</span><span className="stat-value">{formatBytes(remaining)}</span></div>
        <div className={`stat ${issues.length ? "stat-bad" : ""}`}><span className="stat-label">Need attention</span><span className="stat-value">{issues.length}</span></div>
      </div>

      {issues.length > 0 && (
        <section className="dl-group">
          <h2 className="group-title bad"><Icon name="alert" size={16} /> Needs attention</h2>
          <ul className="dl-list">
            {issues.map((q) => (
              <li key={`${q.serviceId}-${q.id}`} className="dl-row bad">
                <span className={`chip kind-${q.client}`}>{KIND_LABELS[q.client]}</span>
                <div className="dl-main">
                  <div className="dl-name" title={q.name}>{q.name}</div>
                  <div className="dl-warning">{q.warning}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {clients.length > 1 && (
        <div className="segmented">
          <button className={client === "all" ? "active" : undefined} onClick={() => setClient("all")}>All clients</button>
          {clients.map((c) => (
            <button key={c} className={client === c ? "active" : undefined} onClick={() => setClient(c)}>{KIND_LABELS[c]}</button>
          ))}
        </div>
      )}

      {downloads.length === 0 ? (
        <div className="empty-card">
          <Icon name="download" size={28} />
          <p>Nothing downloading right now.</p>
          <span className="muted small">New grabs from Radarr and Sonarr show up here as soon as a client picks them up. Check the History tab for what finished.</span>
        </div>
      ) : (
        groups.map(([serviceId, list]) => (
          <section key={serviceId} className="dl-group">
            <h2 className="group-title">
              <span className={`chip kind-${list[0].client}`}>{KIND_LABELS[list[0].client]}</span>
              {services[serviceId]?.name}
              <span className="muted small">{list.length} item{list.length === 1 ? "" : "s"}</span>
              {list[0].client === "sabnzbd" && <PauseAll serviceId={serviceId} onDone={reloadQueue} />}
            </h2>
            <ul className="dl-list">
              {list.map((q) => (
                <li key={q.id} className={`dl-row ${tone(q)}`}>
                  <div className="dl-main">
                    <div className="dl-top">
                      <span className="dl-name" title={q.name}>{q.name}</span>
                      <span className={`pill ${tone(q)}`}>{q.status}</span>
                    </div>
                    <div className="progress big"><span style={{ width: `${Math.round(q.progress * 100)}%` }} /></div>
                    <div className="dl-meta muted">
                      <strong>{Math.round(q.progress * 100)}%</strong>
                      <span>{formatBytes(q.sizeBytes)}</span>
                      {q.speedBytes ? <span>{formatBytes(q.speedBytes)}/s</span> : null}
                      <span>ETA {formatEta(q.etaSeconds)}</span>
                      {q.category && <span className="chip dim">{q.category}</span>}
                    </div>
                    {q.warning && <div className="dl-warning">{q.warning}</div>}
                    <QueueControls q={q} onDone={reloadQueue} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

const EVENT_LABELS: Record<HistoryEvent, string> = {
  grabbed: "Grabbed", imported: "Imported", completed: "Downloaded", failed: "Failed", deleted: "Deleted", requested: "Requested",
};
const EVENT_ICONS: Record<HistoryEvent, string> = {
  grabbed: "download", imported: "check", completed: "check", failed: "alert", deleted: "trash", requested: "plus",
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", ...(diff > 300 ? { year: "numeric" } : {}) });
}

function History() {
  const { services } = useStore();
  const [data, setData] = useState<{ items: HistoryItem[]; errors: ServiceError[] }>();
  const [failure, setFailure] = useState<string>();
  const [event, setEvent] = useState<"all" | HistoryEvent>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await api.history();
        if (!cancelled) {
          setData(res);
          setFailure(undefined);
        }
      } catch (err) {
        if (!cancelled) setFailure((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(load, 30_000);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of data?.items ?? []) c[i.event] = (c[i.event] ?? 0) + 1;
    return c;
  }, [data]);

  const days = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.items ?? []).filter(
      (i) => (event === "all" || i.event === event) && (!needle || i.title.toLowerCase().includes(needle) || i.detail?.toLowerCase().includes(needle)),
    );
    const groups: { label: string; items: HistoryItem[] }[] = [];
    for (const item of list) {
      const label = dayLabel(item.at);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [data, event, q]);

  if (failure) return <p className="notice error">Couldn't load history: {failure}</p>;
  if (!data) return <p className="muted">Loading history…</p>;

  return (
    <>
      <ErrorList errors={data.errors} />
      <div className="filters">
        <div className="segmented wrap">
          <button className={event === "all" ? "active" : undefined} onClick={() => setEvent("all")}>All <span className="count">{data.items.length}</span></button>
          {(Object.keys(EVENT_LABELS) as HistoryEvent[]).filter((e) => counts[e]).map((e) => (
            <button key={e} className={event === e ? "active" : undefined} onClick={() => setEvent(e)}>
              {EVENT_LABELS[e]} <span className="count">{counts[e]}</span>
            </button>
          ))}
        </div>
        <input type="search" placeholder="Filter history" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {days.length === 0 ? (
        <div className="empty-card">
          <Icon name="download" size={28} />
          <p>{data.items.length === 0 ? "No history yet." : "Nothing matches."}</p>
          <span className="muted small">History comes from Radarr, Sonarr, SABnzbd and qBittorrent.</span>
        </div>
      ) : (
        days.map((day) => (
          <section key={day.label} className="dl-group">
            <h2 className="group-title">{day.label}<span className="muted small">{day.items.length}</span></h2>
            <ul className="history-list">
              {day.items.map((h) => (
                <li key={h.id} className={`history history-${h.event}`}>
                  <span className="history-icon"><Icon name={EVENT_ICONS[h.event]} size={16} /></span>
                  <div className="history-main">
                    <div className="history-title" title={h.title}>{h.title}</div>
                    <div className="history-meta muted small">
                      <span className={`chip kind-${h.source}`}>{services[h.serviceId]?.name ?? KIND_LABELS[h.source]}</span>
                      <strong>{EVENT_LABELS[h.event]}</strong>
                      {h.quality && <span>{h.quality}</span>}
                      {h.sizeBytes ? <span>{formatBytes(h.sizeBytes)}</span> : null}
                      {h.detail && <span className="history-detail" title={h.detail}>{h.detail}</span>}
                    </div>
                  </div>
                  <time className="muted small" dateTime={h.at}>{new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

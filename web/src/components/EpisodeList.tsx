import { useEffect, useMemo, useState } from "react";
import { api, formatBytes, type EpisodeInfo, type MediaItem } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";
import { DeleteFilesModal, Modal } from "./Manage";
import { ReleasesModal } from "./ReleasesModal";

const pad = (n: number) => String(n).padStart(2, "0");

function formatDate(iso?: string): string {
  if (!iso) return "TBA";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "TBA" : d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

type Status = "have" | "missing" | "unaired" | "unmonitored";
const statusOf = (e: EpisodeInfo): Status => (e.hasFile ? "have" : !e.aired ? "unaired" : !e.monitored ? "unmonitored" : "missing");

/** Every episode of a show, with per-episode search, manual release search and monitoring. */
export function EpisodeList({ item }: { item: MediaItem }) {
  const { toast } = useStore();
  const m = item.managed!;
  const [open, setOpen] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>();
  const [error, setError] = useState<string>();
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number>();
  const [picking, setPicking] = useState<EpisodeInfo>();
  const [deleting, setDeleting] = useState<{ ids: number[]; label: string }>();
  const [bulk, setBulk] = useState(false);
  const [bulkSeasons, setBulkSeasons] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || episodes) return;
    api.episodes(m.serviceId, m.arrId!).then(
      (list) => {
        setEpisodes(list);
        // Start with the season that still has gaps, otherwise the newest one.
        const seasons = [...new Set(list.map((e) => e.season))].filter((s) => s > 0);
        const gap = seasons.find((s) => list.some((e) => e.season === s && statusOf(e) === "missing"));
        setOpenSeasons(new Set([gap ?? seasons[seasons.length - 1] ?? list[0]?.season].filter((s) => s !== undefined)));
      },
      (err) => setError((err as Error).message),
    );
  }, [open, episodes, m.serviceId, m.arrId]);

  const seasons = useMemo(() => {
    const map = new Map<number, EpisodeInfo[]>();
    for (const e of episodes ?? []) map.set(e.season, [...(map.get(e.season) ?? []), e]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [episodes]);

  const searchEpisode = async (e: EpisodeInfo) => {
    setBusy(e.id);
    try {
      await api.searchEpisodes(m.serviceId, [e.id]);
      toast(`Searching for ${item.title} S${pad(e.season)}E${pad(e.episode)}. Anything found shows up under Downloads.`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };

  const searchSeason = async (season: number) => {
    try {
      await api.searchSeason(m.serviceId, m.arrId!, season);
      toast(`Searching for ${season === 0 ? "specials" : `season ${season}`} of ${item.title}.`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const toggleMonitor = async (e: EpisodeInfo) => {
    try {
      await api.setEpisodesMonitored(m.serviceId, [e.id], !e.monitored);
      setEpisodes((list) => list?.map((x) => (x.id === e.id ? { ...x, monitored: !x.monitored } : x)));
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const toggleSeason = (s: number) =>
    setOpenSeasons((prev) => {
      const next = new Set(prev);
      if (!next.delete(s)) next.add(s);
      return next;
    });

  return (
    <section className="episodes">
      <button className="episodes-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3>Episodes</h3>
        <span className="muted small">
          {m.episodes ? `${m.episodes.have} of ${m.episodes.total} downloaded` : ""}
        </span>
        <Icon name={open ? "up" : "down"} size={16} />
      </button>

      {open && episodes && episodes.some((e) => e.fileId !== undefined) && (
        <div className="actions">
          <button className="btn small-btn danger" onClick={() => { setBulkSeasons(new Set()); setBulk(true); }}>
            <Icon name="trash" size={14} /> Delete several seasons…
          </button>
        </div>
      )}

      {open && (
        error ? <p className="notice error">{error}</p>
        : !episodes ? <p className="muted">Loading episodes…</p>
        : (
          <div className="seasons">
            {seasons.map(([season, list]) => {
              const have = list.filter((e) => e.hasFile).length;
              const expanded = openSeasons.has(season);
              return (
                <div key={season} className="season">
                  <div className="season-head">
                    <button className="season-toggle" onClick={() => toggleSeason(season)}>
                      <Icon name={expanded ? "down" : "right"} size={14} />
                      <strong>{season === 0 ? "Specials" : `Season ${season}`}</strong>
                      <span className={`chip ${have === list.length ? "status-available" : "dim"}`}>{have}/{list.length}</span>
                    </button>
                    {have > 0 && (
                      <button className="btn small-btn danger" onClick={() => setDeleting({ ids: list.filter((x) => x.fileId !== undefined).map((x) => x.fileId!), label: `${have} episode file${have === 1 ? "" : "s"} in ${season === 0 ? "Specials" : `season ${season}`}` })} title="Delete this season's files so they can be downloaded again">
                        <Icon name="trash" size={14} /> Delete files
                      </button>
                    )}
                    <button className="btn small-btn" onClick={() => searchSeason(season)} title="Search for every missing episode in this season">
                      <Icon name="search" size={14} /> Search season
                    </button>
                  </div>
                  {expanded && (
                    <ul className="ep-list">
                      {list.map((e) => {
                        const st = statusOf(e);
                        return (
                          <li key={e.id} className={`ep ep-${st}`}>
                            <span className="ep-num">{e.episode}</span>
                            <span className="ep-title">
                              <span>{e.title}</span>
                              <span className="muted small">{formatDate(e.airDate)}{e.runtimeMinutes ? ` · ${e.runtimeMinutes}m` : ""}</span>
                            </span>
                            <span className="ep-status">
                              {st === "have" && <span className="chip">{e.quality ?? "On disk"}{e.sizeBytes ? ` · ${formatBytes(e.sizeBytes)}` : ""}</span>}
                              {st === "missing" && <span className="chip status-missing">Missing</span>}
                              {st === "unaired" && <span className="chip dim">Not aired</span>}
                              {st === "unmonitored" && <span className="chip dim">Unmonitored</span>}
                            </span>
                            <span className="ep-actions">
                              <button className="icon-btn" onClick={() => searchEpisode(e)} disabled={busy === e.id} title="Search for this episode" aria-label="Search for this episode">
                                <Icon name="search" size={16} />
                              </button>
                              {e.fileId !== undefined && (
                                <button className="icon-btn" onClick={() => setDeleting({ ids: [e.fileId!], label: `S${pad(e.season)}E${pad(e.episode)} · ${e.title}` })} title="Delete this episode's file so it can be downloaded again" aria-label="Delete this episode's file">
                                  <Icon name="trash" size={16} />
                                </button>
                              )}
                              <button className="icon-btn" onClick={() => setPicking(e)} title="Choose a release yourself" aria-label="Find releases for this episode">
                                <Icon name="download" size={16} />
                              </button>
                              <button className="icon-btn" onClick={() => toggleMonitor(e)} title={e.monitored ? "Monitored — click to stop" : "Not monitored — click to monitor"} aria-label="Toggle monitoring">
                                <Icon name={e.monitored ? "eye" : "eyeoff"} size={16} />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {bulk && episodes && (
        <Modal title={`Delete seasons of “${item.title}”`} onClose={() => setBulk(false)}>
          <p className="muted small">Tick the seasons whose files you want to delete and fetch again.</p>
          <ul className="rule-list">
            {seasons.filter(([, list]) => list.some((e) => e.fileId !== undefined)).map(([season, list]) => {
              const n = list.filter((e) => e.fileId !== undefined).length;
              return (
                <li key={season} className="rule">
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={bulkSeasons.has(season)}
                      onChange={(ev) => setBulkSeasons((p) => { const s = new Set(p); if (ev.target.checked) s.add(season); else s.delete(season); return s; })}
                    />
                    <strong>{season === 0 ? "Specials" : `Season ${season}`}</strong> <span className="muted small">{n} file{n === 1 ? "" : "s"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="actions">
            <button className="btn" onClick={() => setBulkSeasons(new Set(seasons.filter(([, l]) => l.some((e) => e.fileId !== undefined)).map(([s]) => s)))}>Select all</button>
            <button
              className="btn danger"
              disabled={bulkSeasons.size === 0}
              onClick={() => {
                const picked = episodes.filter((e) => bulkSeasons.has(e.season) && e.fileId !== undefined);
                setBulk(false);
                setDeleting({ ids: picked.map((e) => e.fileId!), label: `${picked.length} episode files across ${bulkSeasons.size} season${bulkSeasons.size === 1 ? "" : "s"}` });
              }}
            >
              Continue…
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <DeleteFilesModal
          item={item}
          fileIds={deleting.ids}
          label={deleting.label}
          onClose={() => setDeleting(undefined)}
          onDone={() => setEpisodes(undefined)}
        />
      )}
      {picking && (
        <ReleasesModal
          item={item}
          episode={{ id: picking.id, label: `S${pad(picking.season)}E${pad(picking.episode)} · ${picking.title}` }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </section>
  );
}

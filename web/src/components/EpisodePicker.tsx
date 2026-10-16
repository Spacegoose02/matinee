import { useEffect, useMemo, useState } from "react";
import { api, type PodcastEpisode } from "../api";
import { useStore } from "../store";

const when = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

/**
 * A show's episodes with checkboxes. While adding, the ticked ones are reported to the dialog and downloaded with the show;
 * for a show already in Audiobookshelf there are buttons to download or delete the ticked ones.
 */
export function EpisodePicker({ serviceId, itunesId, manage, onPick }: { serviceId: string; itunesId: string; manage: boolean; onPick?: (keys: string[]) => void }) {
  const { toast } = useStore();
  const [data, setData] = useState<{ itemId?: string; episodes: PodcastEpisode[] }>();
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const load = () => api.podcastEpisodes(serviceId, itunesId).then(setData, (e) => setError((e as Error).message));
  useEffect(() => { void load(); }, [serviceId, itunesId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onPick?.([...picked]), [picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.episodes ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));
  }, [data, filter]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Reading the show's episode list…</p>;

  const toggle = (key: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(key); else n.delete(key); return n; });
  const selectable = rows.filter((e) => !e.downloaded);
  const pickedDownloaded = data.episodes.filter((e) => picked.has(e.key) && e.downloaded && e.episodeId);
  const pickedNew = data.episodes.filter((e) => picked.has(e.key) && !e.downloaded);

  const download = async () => {
    setBusy(true);
    try {
      const r = await api.downloadPodcastEpisodes(serviceId, itunesId, pickedNew.map((e) => e.key));
      toast(`Audiobookshelf is downloading ${r.count} episode${r.count === 1 ? "" : "s"}.`);
      setPicked(new Set());
      setTimeout(() => void load(), 4000);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${pickedDownloaded.length} downloaded episode${pickedDownloaded.length === 1 ? "" : "s"} from Audiobookshelf, including the audio files?`)) return;
    setBusy(true);
    try {
      const r = await api.deletePodcastEpisodes(serviceId, itunesId, pickedDownloaded.map((e) => e.episodeId!));
      toast(`Deleted ${r.count} episode${r.count === 1 ? "" : "s"}.`);
      setPicked(new Set());
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="episode-picker">
      <div className="actions">
        <input type="search" placeholder="Filter episodes" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="btn small" onClick={() => setPicked(new Set(selectable.slice(0, 5).map((e) => e.key)))}>Latest 5</button>
        <button type="button" className="btn small" onClick={() => setPicked(new Set(selectable.map((e) => e.key)))}>All {selectable.length}</button>
        <button type="button" className="btn small" onClick={() => setPicked(new Set())}>Clear</button>
        <span className="muted small">{data.episodes.length} episodes · {picked.size} ticked</span>
      </div>
      <ul className="rule-list episode-rows">
        {rows.slice(0, limit).map((e) => (
          <li key={e.key} className="rule">
            <label className="inline">
              <input type="checkbox" checked={picked.has(e.key)} onChange={(ev) => toggle(e.key, ev.target.checked)} disabled={e.downloaded && !manage} />
              <span>
                <strong>{e.title}</strong> <span className="muted small">{when(e.publishedAt)}</span>
                {e.downloaded && <span className="chip status-available"> In Audiobookshelf</span>}
                {e.description && <span className="muted small ep-desc">{e.description}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {rows.length > limit && <button type="button" className="btn small" onClick={() => setLimit(limit + 50)}>Show more ({rows.length - limit} left)</button>}
      {manage && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy || pickedNew.length === 0 || !data.itemId} onClick={download}>Download {pickedNew.length || ""} ticked</button>
          <button type="button" className="btn danger" disabled={busy || pickedDownloaded.length === 0} onClick={remove}>Delete {pickedDownloaded.length || ""} downloaded</button>
        </div>
      )}
    </div>
  );
}

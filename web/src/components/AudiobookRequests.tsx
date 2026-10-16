import { useEffect, useMemo, useState } from "react";
import { api, type AudiobookRequestInfo, type ServiceError } from "../api";
import { useStore } from "../store";
import { ErrorList } from "./ErrorList";
import { Icon } from "./Icons";
import { Poster } from "./Cards";

type Group = "all" | "active" | "waiting" | "completed" | "failed" | "cancelled";

const GROUPS: Record<Exclude<Group, "all">, string[]> = {
  active: ["pending", "searching", "downloading", "processing"],
  waiting: ["awaiting_search", "awaiting_import", "awaiting_approval", "awaiting_release"],
  completed: ["available", "downloaded"],
  failed: ["failed", "warn"],
  cancelled: ["cancelled", "denied"],
};

const LABELS: Record<Group, string> = { all: "All", active: "In progress", waiting: "Waiting", completed: "Done", failed: "Failed", cancelled: "Cancelled" };

const groupOf = (status: string): Exclude<Group, "all"> =>
  (Object.keys(GROUPS) as Exclude<Group, "all">[]).find((g) => GROUPS[g].includes(status)) ?? "waiting";

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/** Audiobook requests in ReadMeABook, with progress. */
export function AudiobookRequests() {
  const { services } = useStore();
  const [data, setData] = useState<{ items: AudiobookRequestInfo[]; errors: ServiceError[] }>();
  const [failure, setFailure] = useState<string>();
  const [group, setGroup] = useState<Group>("all");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await api.audiobookRequests();
        if (!cancelled) {
          setData(res);
          setFailure(undefined);
        }
      } catch (err) {
        if (!cancelled) setFailure((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(load, 15_000);
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Group, number> = { all: 0, active: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const r of data?.items ?? []) {
      c.all++;
      c[groupOf(r.status)]++;
    }
    return c;
  }, [data]);

  if (failure) return <p className="notice error">Couldn't load requests: {failure}</p>;
  if (!data) return <p className="muted">Loading requests…</p>;

  const list = data.items.filter((r) => group === "all" || groupOf(r.status) === group);

  return (
    <>
      <ErrorList errors={data.errors} />
      <div className="filters">
        <div className="segmented wrap">
          {(Object.keys(LABELS) as Group[]).filter((g) => g === "all" || counts[g] > 0).map((g) => (
            <button key={g} className={group === g ? "active" : undefined} onClick={() => setGroup(g)}>
              {LABELS[g]} <span className="count">{counts[g]}</span>
            </button>
          ))}
        </div>
        <a className="link" href="#/discover">Request an audiobook →</a>
      </div>

      {list.length === 0 ? (
        <div className="empty-card">
          <Icon name="download" size={28} />
          <p>{data.items.length === 0 ? "No audiobook requests yet." : "Nothing in this group."}</p>
          <span className="muted small">Search for an audiobook on the Discover page to request one.</span>
        </div>
      ) : (
        <ul className="req-list">
          {list.map((r) => {
            const g = groupOf(r.status);
            return (
              <li key={r.id} className={`req req-${g}`}>
                <Poster src={r.coverArtUrl} title={r.title} className="req-cover" />
                <div className="req-main">
                  <div className="req-title" title={r.title}>{r.title}</div>
                  <div className="muted small">
                    {r.author}{r.series ? ` · ${r.series}` : ""}{r.type === "ebook" ? " · ebook" : ""}
                  </div>
                  {r.status === "downloading" && <div className="progress big"><span style={{ width: `${r.progress}%` }} /></div>}
                  {r.errorMessage && g === "failed" && <div className="dl-warning">{r.errorMessage}</div>}
                </div>
                <div className="req-side">
                  <span className={`pill ${g === "failed" || g === "cancelled" ? "bad" : g === "waiting" ? "idle" : g === "completed" ? "done" : "live"}`}>
                    {humanize(r.status)}{r.status === "downloading" ? ` ${r.progress}%` : ""}
                  </span>
                  <span className="muted small">{ago(r.createdAt)}{r.requestedBy ? ` · ${r.requestedBy}` : ""}</span>
                  <span className={`chip kind-readmeabook`}>{services[r.serviceId]?.name ?? "ReadMeABook"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { api, type ManagerTask } from "../api";
import { useStore } from "../store";

const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
};

/**
 * What Radarr/Sonarr are doing behind the scenes: importing a finished download into the library,
 * moving, renaming and rescanning. They don't report bytes copied, only queued / working / done.
 */
export function Activity() {
  const { services } = useStore();
  const [items, setItems] = useState<ManagerTask[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = () => api.activity().then((r) => !stop && setItems(r.items), () => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (items.length === 0) return null;
  return (
    <section className="activity">
      <h3>Library activity</h3>
      <ul className="rule-list">
        {items.slice(0, 12).map((t) => (
          <li key={`${t.serviceId}-${t.id}`} className="rule">
            <span>
              <strong>{t.name}</strong> <span className="muted small">{services[t.serviceId]?.name}</span>
              {t.message && <div className="muted small">{t.message}</div>}
            </span>
            <span className={`chip ${t.status === "failed" ? "chip-warn" : ""}`}>
              {t.status === "queued" ? "Waiting" : t.status === "started" ? "Working…" : t.status === "failed" ? "Failed" : `Done ${ago(t.endedAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

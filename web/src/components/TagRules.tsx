import { useEffect, useMemo, useState } from "react";
import { api, type CollectionRule, type OpResult, type RulesResponse } from "../api";
import { useStore } from "../store";
import { PlanView } from "./PlanView";

const defaultName = (tag: string) => tag.replace(/\b\w/g, (c) => c.toUpperCase());

/** Keep a collection for each Radarr/Sonarr tag, on the servers you choose. */
export function TagRules() {
  const { reload, toast } = useStore();
  const [data, setData] = useState<RulesResponse>();
  const [rules, setRules] = useState<Record<string, CollectionRule>>({});
  const [auto, setAuto] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [plan, setPlan] = useState<{ results: OpResult[]; done: boolean }>();

  useEffect(() => {
    api.collectionRules().then(
      (r) => {
        setData(r);
        setAuto(r.auto);
        setRules(Object.fromEntries(r.rules.map((x) => [x.tag, x])));
      },
      (err) => setError((err as Error).message),
    );
  }, []);

  const ruleFor = (tag: string): CollectionRule =>
    rules[tag] ?? { tag, name: defaultName(tag), serviceIds: data?.servers.map((s) => s.id) ?? [], mirror: false, enabled: false };
  const update = (tag: string, patch: Partial<CollectionRule>) => {
    setRules((r) => ({ ...r, [tag]: { ...ruleFor(tag), ...patch } }));
    setPlan(undefined);
  };

  const visibleTags = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.tags ?? []).filter((t) => !q || t.tag.toLowerCase().includes(q));
  }, [data, filter]);

  const enabledCount = Object.values(rules).filter((r) => r.enabled).length;

  const save = async () => {
    await api.saveCollectionRules({ auto, rules: Object.values(rules).filter((r) => r.enabled || data?.rules.some((x) => x.tag === r.tag)) });
  };

  const act = async (kind: "save" | "preview" | "run") => {
    setBusy(true);
    setError(undefined);
    try {
      await save();
      if (kind === "save") {
        toast("Saved your tag rules.");
        return;
      }
      const res = await api.runCollections({ tagRules: true, dryRun: kind === "preview" });
      setPlan({ results: res.results, done: kind === "run" });
      if (kind === "run") {
        toast("Tag collections are up to date.");
        reload(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading tags…</p>;

  return (
    <section className="tag-rules">
      <p className="muted">
        Tag a movie or show in Radarr or Sonarr (for example <code>christmas</code> or <code>marvel</code>) and Matinee keeps a collection with all
        tagged titles on Plex and Jellyfin. Tick the tags you want; use <em>Preview</em> to see what would change before anything is written.
      </p>

      {data.tags.length === 0 ? (
        <p className="notice">No tags found yet. Add tags to titles in Radarr or Sonarr, then come back.</p>
      ) : (
        <>
          <div className="filters">
            <input type="search" placeholder="Filter tags" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="muted small">{enabledCount} rule{enabledCount === 1 ? "" : "s"} switched on</span>
          </div>
          <ul className="rule-list">
            {visibleTags.map(({ tag, count }) => {
              const r = ruleFor(tag);
              return (
                <li key={tag} className={`rule ${r.enabled ? "on" : ""}`}>
                  <label className="inline rule-toggle">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => update(tag, { enabled: e.target.checked })} />
                    <strong>{tag}</strong> <span className="muted small">{count} title{count === 1 ? "" : "s"}</span>
                  </label>
                  {r.enabled && (
                    <div className="rule-body">
                      <label>
                        Collection name
                        <input value={r.name} onChange={(e) => update(tag, { name: e.target.value })} />
                      </label>
                      <div className="rule-servers">
                        {data.servers.map((s) => (
                          <label key={s.id} className="inline">
                            <input
                              type="checkbox"
                              checked={r.serviceIds.includes(s.id)}
                              onChange={(e) => update(tag, { serviceIds: e.target.checked ? [...r.serviceIds, s.id] : r.serviceIds.filter((x) => x !== s.id) })}
                            />
                            {s.name}
                          </label>
                        ))}
                        <label className="inline" title="Remove a title from the collection when it loses the tag">
                          <input type="checkbox" checked={r.mirror} onChange={(e) => update(tag, { mirror: e.target.checked })} />
                          Remove titles that lose the tag
                        </label>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <label className="inline auto-toggle">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Keep these collections up to date automatically (checks every 30 minutes)
      </label>

      {plan && <PlanView results={plan.results} done={plan.done} />}
      {plan && plan.results.length === 0 && <p className="muted">No rules are switched on.</p>}
      {error && <p className="notice error">{error}</p>}

      <div className="actions">
        <button className="btn" disabled={busy} onClick={() => act("save")}>Save</button>
        <button className="btn" disabled={busy || enabledCount === 0} onClick={() => act("preview")}>Preview changes</button>
        <button className="btn primary" disabled={busy || enabledCount === 0} onClick={() => act("run")}>{busy ? "Working…" : "Apply now"}</button>
      </div>
    </section>
  );
}

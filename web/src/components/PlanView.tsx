import type { GroupPlan, OpResult } from "../api";

const titles = (n: number) => `${n} title${n === 1 ? "" : "s"}`;

function describe(g: GroupPlan, done: boolean): string {
  const where = g.sectionName ? `${g.sectionName}: ` : "";
  const parts: string[] = [];
  if (g.add) parts.push(`${done ? "added" : "add"} ${titles(g.add)}${g.sampleAdd.length ? ` (${g.sampleAdd.join(", ")}${g.add > g.sampleAdd.length ? ", …" : ""})` : ""}`);
  if (g.remove) parts.push(`${done ? "removed" : "remove"} ${titles(g.remove)}`);
  if (parts.length === 0) return `${where}already up to date`;
  return `${where}${g.existing ? "" : done ? "created, " : "create it, "}${parts.join(" and ")}`;
}

/** What a collections run did (or would do) on each server. */
export function PlanView({ results, done }: { results: OpResult[]; done: boolean }) {
  return (
    <div className="plan">
      {results.map((r) => (
        <section key={r.name} className="plan-op">
          {results.length > 1 && <h4>{r.name}</h4>}
          {r.plans.map((p) => (
            <div key={p.serviceId} className="plan-service">
              <strong>{p.serviceName}</strong>
              {p.groups.length === 0 ? (
                <p className="muted small">None of these titles are on {p.serviceName}.</p>
              ) : (
                <ul>
                  {p.groups.map((g, i) => (
                    <li key={i} className={g.add || g.remove ? "change" : "same"}>{describe(g, done)}</li>
                  ))}
                </ul>
              )}
              {p.skipped.length > 0 && (
                <p className="muted small">
                  Not on {p.serviceName}, so left out: {p.skipped.slice(0, 6).join(", ")}
                  {p.skipped.length > 6 ? ` and ${p.skipped.length - 6} more` : ""}
                </p>
              )}
            </div>
          ))}
          {r.errors.map((e) => (
            <p key={e} className="notice error">{e}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** True if running these results would change something on a server. */
export const hasChanges = (results: OpResult[]) => results.some((r) => r.plans.some((p) => p.groups.some((g) => g.add > 0 || g.remove > 0)));

// Collections engine. Everything the maker, the sync button and the tag rules do is one operation:
// "make sure collection NAME holds these titles on these servers". It creates the collection when it is
// missing, adds what is absent, and (only if asked to mirror) removes what should no longer be there.
// Every run can be a dry run that reports the plan without touching Plex or Jellyfin.
import { adapterFor } from "./services/registry.js";
import type { MediaItem, NativeMember, RawCollection, RawItem, ServiceConfig } from "./services/types.js";

export interface EnsureOp {
  name: string;
  memberKeys: string[];
  serviceIds: string[];
  /** Also remove titles from an existing collection that are not in memberKeys. */
  mirror?: boolean;
}

export interface GroupPlan {
  /** Plex library section (a Plex collection lives in exactly one). Absent for Jellyfin. */
  sectionKey?: string;
  sectionName?: string;
  existing: boolean;
  add: number;
  remove: number;
  sampleAdd: string[];
}

export interface ServicePlan {
  serviceId: string;
  serviceName: string;
  groups: GroupPlan[];
  /** Titles this server doesn't have, so they can't be put in its collection. */
  skipped: string[];
}

export interface OpResult {
  name: string;
  plans: ServicePlan[];
  errors: string[];
}

export interface CacheChange {
  serviceId: string;
  name: string;
  sectionKey?: string;
  id?: string;
  addKeys: string[];
  removeKeys: string[];
}

export interface Ctx {
  byKey: Map<string, MediaItem>;
  /** Collections as currently cached from the servers. */
  collections: RawCollection[];
  keyOf: (raw: RawItem) => string | undefined;
  services: ServiceConfig[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const sameName = (a: string, b: string) => norm(a) === norm(b);

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function ensureCollections(ops: EnsureOp[], dryRun: boolean, ctx: Ctx): Promise<{ results: OpResult[]; changes: CacheChange[] }> {
  const results: OpResult[] = [];
  const changes: CacheChange[] = [];

  for (const op of ops) {
    const result: OpResult = { name: op.name, plans: [], errors: [] };
    const items = op.memberKeys.map((k) => ctx.byKey.get(k)).filter((i): i is MediaItem => Boolean(i));

    for (const serviceId of op.serviceIds) {
      const svc = ctx.services.find((s) => s.id === serviceId);
      if (!svc) {
        result.errors.push("One of the chosen servers isn't connected any more.");
        continue;
      }
      const adapter = adapterFor(svc);
      if (!adapter.collectionCreate || !adapter.collectionAdd || !adapter.collectionRemove) {
        result.errors.push(`${svc.name} can't hold collections.`);
        continue;
      }

      const onServer: { item: MediaItem; native: NativeMember }[] = [];
      const skipped: string[] = [];
      for (const item of items) {
        const entry = item.available.find((a) => a.serviceId === serviceId);
        if (entry?.itemId) onServer.push({ item, native: { itemId: entry.itemId, sectionKey: entry.sectionKey, type: item.type } });
        else skipped.push(item.title);
      }

      // Plex collections belong to one library section, so titles are grouped by section there.
      const groups = new Map<string, typeof onServer>();
      for (const m of onServer) groups.set(m.native.sectionKey ?? "", [...(groups.get(m.native.sectionKey ?? "") ?? []), m]);

      const plan: ServicePlan = { serviceId, serviceName: svc.name, groups: [], skipped };

      for (const [section, members] of groups) {
        const existing = ctx.collections.find((c) => c.serviceId === serviceId && sameName(c.name, op.name) && (c.sectionKey ?? "") === section);
        const existingKeys = new Set((existing?.members ?? []).map((m) => ctx.keyOf(m)).filter((k): k is string => Boolean(k)));
        const wanted = new Set(members.map((m) => m.item.key));
        const add = members.filter((m) => !existingKeys.has(m.item.key));
        const removeKeys = op.mirror ? [...existingKeys].filter((k) => !wanted.has(k)) : [];
        const sectionName = members[0].item.available.find((a) => a.serviceId === serviceId)?.library;

        plan.groups.push({
          sectionKey: section || undefined,
          sectionName: section ? sectionName : undefined,
          existing: Boolean(existing),
          add: add.length,
          remove: removeKeys.length,
          sampleAdd: add.slice(0, 5).map((m) => m.item.title),
        });

        if (dryRun || (existing && add.length === 0 && removeKeys.length === 0) || (!existing && add.length === 0)) continue;

        try {
          let id = existing?.id;
          if (!existing) {
            id = (await adapter.collectionCreate(op.name, add.map((m) => m.native))).id;
          } else {
            if (!id) throw new Error("the collection's id isn't known yet; refresh the library once and try again");
            if (add.length) await adapter.collectionAdd(id, add.map((m) => m.native));
            if (removeKeys.length) {
              const natives = removeKeys.flatMap((k) => {
                const entry = ctx.byKey.get(k)?.available.find((a) => a.serviceId === serviceId);
                return entry?.itemId ? [{ itemId: entry.itemId, sectionKey: entry.sectionKey, type: ctx.byKey.get(k)!.type }] : [];
              });
              if (natives.length) await adapter.collectionRemove(id, natives);
            }
          }
          changes.push({ serviceId, name: op.name, sectionKey: section || undefined, id, addKeys: add.map((m) => m.item.key), removeKeys });
        } catch (err) {
          result.errors.push(`${svc.name}${section ? ` (${sectionName})` : ""}: ${messageOf(err)}`);
        }
      }
      // Mirroring also empties same-named collections in library sections that no longer hold any wanted title.
      if (op.mirror) {
        for (const stale of ctx.collections.filter((c) => c.serviceId === serviceId && sameName(c.name, op.name) && !groups.has(c.sectionKey ?? ""))) {
          const staleItems = stale.members.map((m) => ctx.keyOf(m)).filter((k): k is string => Boolean(k)).map((k) => ctx.byKey.get(k)).filter((i): i is MediaItem => Boolean(i));
          if (staleItems.length === 0) continue;
          const natives = staleItems.flatMap((i) => {
            const entry = i.available.find((a) => a.serviceId === serviceId);
            return entry?.itemId ? [{ itemId: entry.itemId, sectionKey: entry.sectionKey, type: i.type }] : [];
          });
          plan.groups.push({
            sectionKey: stale.sectionKey,
            sectionName: stale.sectionKey ? staleItems[0].available.find((a) => a.serviceId === serviceId)?.library : undefined,
            existing: true,
            add: 0,
            remove: natives.length,
            sampleAdd: [],
          });
          if (dryRun || natives.length === 0 || !stale.id) continue;
          try {
            await adapter.collectionRemove(stale.id, natives);
            changes.push({ serviceId, name: op.name, sectionKey: stale.sectionKey, id: stale.id, addKeys: [], removeKeys: staleItems.map((i) => i.key) });
          } catch (err) {
            result.errors.push(`${svc.name}: ${messageOf(err)}`);
          }
        }
      }
      result.plans.push(plan);
    }
    results.push(result);
  }
  return { results, changes };
}

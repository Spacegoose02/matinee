import { ServiceError, getJson, joinUrl } from "../http.js";
import type { DownloadAction, HistoryItem, QueueItem, ServiceAdapter, ServiceConfig } from "./types.js";

interface SabQueue {
  queue: {
    kbpersec: string;
    slots: { nzo_id: string; filename: string; status: string; percentage: string; mb: string; timeleft: string; cat: string }[];
  };
}

const hmsToSeconds = (t: string) => t.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);

export function sabnzbdAdapter(cfg: ServiceConfig): ServiceAdapter {
  const api = <T>(mode: string) =>
    getJson<T>(joinUrl(cfg.url, `/api?mode=${mode}&output=json&apikey=${encodeURIComponent(cfg.apiKey)}`));

  return {
    async test() {
      // mode=version works without a key, so also hit the queue to validate it.
      const v = await api<{ version: string }>("version");
      await api<SabQueue>("queue");
      return { ok: true, version: v.version };
    },

    async history(): Promise<HistoryItem[]> {
      const res = await getJson<{
        history: { slots: { nzo_id: string; name: string; status: string; bytes: number; completed: number; fail_message?: string; category?: string }[] };
      }>(joinUrl(cfg.url, `/api?mode=history&limit=80&output=json&apikey=${encodeURIComponent(cfg.apiKey)}`));
      return res.history.slots
        .filter((s) => s.status === "Completed" || s.status === "Failed")
        .map((s) => ({
          id: `${cfg.id}-${s.nzo_id}`,
          serviceId: cfg.id,
          source: "sabnzbd" as const,
          title: s.name,
          event: s.status === "Failed" ? ("failed" as const) : ("completed" as const),
          at: new Date(s.completed * 1000).toISOString(),
          sizeBytes: s.bytes,
          detail: s.status === "Failed" ? s.fail_message || "Download failed" : s.category || undefined,
        }));
    },

    // Pause, resume or remove one download, or pause everything.
    async control(id: string, action: DownloadAction, opts: { deleteFiles?: boolean } = {}): Promise<void> {
      const key = encodeURIComponent(cfg.apiKey);
      const base = joinUrl(cfg.url, `/api?output=json&apikey=${key}`);
      const nzo = encodeURIComponent(id);
      const url =
        action === "pause" ? `${base}&mode=queue&name=pause&value=${nzo}`
        : action === "resume" ? `${base}&mode=queue&name=resume&value=${nzo}`
        : action === "remove" ? `${base}&mode=queue&name=delete&value=${nzo}&del_files=${opts.deleteFiles ? 1 : 0}`
        : action === "pause-all" ? `${base}&mode=pause`
        : action === "resume-all" ? `${base}&mode=resume`
        : undefined;
      if (!url) throw new ServiceError("SABnzbd can't do that");
      const r = await getJson<{ status?: boolean; error?: string }>(url);
      if (r.status === false || r.error) throw new ServiceError(r.error ?? "SABnzbd refused the request");
    },

    async queue(): Promise<QueueItem[]> {
      const { queue } = await api<SabQueue>("queue");
      const speed = Number(queue.kbpersec) * 1024;
      return queue.slots.map((s, i) => ({
        serviceId: cfg.id,
        client: "sabnzbd",
        id: s.nzo_id,
        name: s.filename,
        status: s.status,
        progress: Number(s.percentage) / 100,
        sizeBytes: Number(s.mb) * 1024 * 1024,
        etaSeconds: hmsToSeconds(s.timeleft),
        // SAB reports one overall speed; attribute it to the active slot.
        speedBytes: i === 0 && s.status === "Downloading" ? speed : undefined,
        category: s.cat,
        controllable: true,
      }));
    },
  };
}

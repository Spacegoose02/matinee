// Deluge Web UI JSON-RPC. Auth is a session cookie from auth.login.
import { ServiceError, joinUrl, request } from "../http.js";
import type { QueueItem, ServiceAdapter, ServiceConfig } from "./types.js";

interface RpcResponse<T> { result: T; error: { message: string } | null; id: number }

interface Torrent {
  name: string; state: string; progress: number; eta: number;
  total_wanted: number; download_payload_rate: number; label?: string;
}

const sessions = new Map<string, string>();

export function delugeAdapter(cfg: ServiceConfig): ServiceAdapter {
  const endpoint = joinUrl(cfg.url, "/json");
  let nextId = 1;

  async function call<T>(method: string, params: unknown[], cookie?: string) {
    const { data, res } = await request<RpcResponse<T>>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ method, params, id: nextId++ }),
    });
    if (data.error) throw new ServiceError(`Deluge: ${data.error.message}`);
    return { result: data.result, res };
  }

  async function login(): Promise<string> {
    const { result, res } = await call<boolean>("auth.login", [cfg.password]);
    if (!result) throw new ServiceError("Deluge rejected the password");
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new ServiceError("Deluge did not return a session cookie");
    sessions.set(cfg.id, cookie);
    return cookie;
  }

  async function authed<T>(method: string, params: unknown[]): Promise<T> {
    const cached = sessions.get(cfg.id);
    if (cached) {
      try {
        return (await call<T>(method, params, cached)).result;
      } catch {
        // Session probably expired; fall through to a fresh login.
      }
    }
    return (await call<T>(method, params, await login())).result;
  }

  return {
    async test() {
      sessions.delete(cfg.id);
      const connected = await authed<boolean>("web.connected", []);
      if (!connected) return { ok: false, message: "Web UI is up but not connected to a Deluge daemon" };
      const version = await authed<string>("daemon.get_version", []).catch(() => undefined);
      return { ok: true, version };
    },

    async queue(): Promise<QueueItem[]> {
      const fields = ["name", "state", "progress", "eta", "total_wanted", "download_payload_rate", "label"];
      const ui = await authed<{ torrents: Record<string, Torrent> | null }>("web.update_ui", [fields, {}]);
      return Object.entries(ui.torrents ?? {})
        // Finished torrents that are only seeding are not part of the download queue.
        .filter(([, t]) => t.progress < 100)
        .map(([hash, t]) => ({
          serviceId: cfg.id,
          client: "deluge",
          id: hash,
          name: t.name,
          status: t.state,
          progress: t.progress / 100,
          sizeBytes: t.total_wanted,
          etaSeconds: t.eta > 0 ? t.eta : undefined,
          speedBytes: t.download_payload_rate || undefined,
          category: t.label || undefined,
        }));
    },
  };
}

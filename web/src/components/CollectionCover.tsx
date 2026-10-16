import { useRef, useState } from "react";
import { api, type Collection } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";

/** Cover for a collection: pick one in Matinee, send it to Plex and Jellyfin, or copy one server's cover to the other. */
export function CollectionCover({ collection }: { collection: Collection }) {
  const { services, reload, toast } = useStore();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [autoSend, setAutoSend] = useState(() => {
    try { return localStorage.getItem("marquee.posterAutoSend") !== "0"; } catch { return true; }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const own = collection.poster?.startsWith("/posters/");
  const servers = collection.services.map((c) => ({ id: c.serviceId, name: services[c.serviceId]?.name ?? "Server" }));

  const run = async (job: () => Promise<unknown>, sendAfter = false) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await job();
      setUrl("");
      if (sendAfter && autoSend) {
        const r = await api.collectionCover(collection.name, "send");
        if (r.failed.length) throw new Error(r.failed.join("; "));
        setNote(`Cover set and sent to ${[...new Set(r.done)].join(" and ")}.`);
      }
      await reload(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = (from: string, to: string, label: string) =>
    run(async () => {
      const r = await api.collectionCover(collection.name, "copy", from, to);
      if (r.failed.length) throw new Error(r.failed.join("; "));
      setNote(label);
      toast(label);
    });

  return (
    <section className="poster-editor">
      <h3><Icon name="image" size={16} /> Cover</h3>
      <form className="row-form" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void run(() => api.collectionPosterFromUrl(collection.name, url.trim()), true); }}>
        <input placeholder="Paste an image URL (ThePosterDB, TMDB…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={busy || !url.trim()}>Use URL</button>
      </form>
      <div className="row-form">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => api.collectionPosterFromFile(collection.name, f), true); e.target.value = ""; }} />
        <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} /> Upload image</button>
        {own && <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api.collectionCover(collection.name, "send"); if (r.failed.length) throw new Error(r.failed.join("; ")); setNote(`Sent to ${r.done.join(" and ")}.`); })}>Send to servers</button>}
        {own && <button className="btn ghost" disabled={busy} onClick={() => run(() => api.resetCollectionPoster(collection.name))}><Icon name="trash" size={16} /> Reset</button>}
      </div>
      <label className="inline">
        <input type="checkbox" checked={autoSend} onChange={(e) => { setAutoSend(e.target.checked); try { localStorage.setItem("marquee.posterAutoSend", e.target.checked ? "1" : "0"); } catch { /* storage unavailable */ } }} />
        Also set it on Plex &amp; Jellyfin when I pick one
      </label>
      {servers.length > 1 && (
        <div className="row-form">
          {servers.flatMap((a) => servers.filter((b) => b.id !== a.id).map((b) => (
            <button key={a.id + b.id} className="btn" disabled={busy} onClick={() => copy(a.id, b.id, `Copied ${a.name}'s cover to ${b.name}.`)}>
              Copy {a.name}'s cover to {b.name}
            </button>
          )))}
        </div>
      )}
      {note && <p className="notice ok">{note}</p>}
      {error && <p className="notice error">{error}</p>}
    </section>
  );
}

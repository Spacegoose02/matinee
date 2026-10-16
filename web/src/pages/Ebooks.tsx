import { useState, type FormEvent } from "react";
import { api, type BookItem, type ServiceError } from "../api";
import { ErrorList } from "../components/ErrorList";
import { Poster } from "../components/Cards";
import { useStore } from "../store";

/** Search ebooks: what Calibre-Web already has, and what Shelfmark can fetch into it. */
export function Ebooks() {
  const { services, toast } = useStore();
  const hasCalibre = Object.values(services).some((s) => s.kind === "calibreweb" && s.enabled);
  const hasShelf = Object.values(services).some((s) => s.kind === "shelfmark" && s.enabled);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<{ library: BookItem[]; download: BookItem[]; errors: ServiceError[] }>();

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setRes(await api.searchBooks(q.trim()));
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const request = async (b: BookItem) => {
    if (!b.serviceId) return;
    try {
      await api.requestBook(b.serviceId, b.id);
      setAsked((s) => new Set(s).add(b.id));
      toast(`Asked Shelfmark to download “${b.title}”. Watch it under Downloads → Active.`);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  if (!hasCalibre && !hasShelf) {
    return (
      <div className="page">
        <div className="page-head"><h1>Books</h1></div>
        <p className="notice">Connect Calibre-Web (to see your books) and Shelfmark (to download new ones) in <a href="#/settings">Settings</a>.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Books</h1><span className="muted">Search your Calibre-Web library{hasShelf ? " and find more to download with Shelfmark" : ""}</span></div></div>
      <form className="row-form" onSubmit={search}>
        <input type="search" placeholder="Title or author" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button className="btn primary" disabled={busy || q.trim().length < 2}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {res && <ErrorList errors={res.errors} />}
      {res && hasCalibre && (
        <section>
          <h2>In your library</h2>
          {res.library.length === 0 ? <p className="muted">Nothing in Calibre-Web matches.</p> : (
            <div className="grid">
              {res.library.map((b) => (
                <a key={b.id} className="card" href={b.url} target="_blank" rel="noreferrer" title={b.title}>
                  <Poster src={b.cover} title={b.title} />
                  <span className="card-meta"><span className="card-title">{b.title}</span><span className="card-sub">{b.author ?? "Book"}</span></span>
                </a>
              ))}
            </div>
          )}
        </section>
      )}
      {res && hasShelf && (
        <section>
          <h2>Available to download</h2>
          {res.download.length === 0 ? <p className="muted">Shelfmark found nothing.</p> : (
            <ul className="rule-list">
              {res.download.map((b) => (
                <li key={b.id} className="rule">
                  <span>
                    <strong>{b.title}</strong> <span className="muted small">{[b.author, b.year, b.format?.toUpperCase(), b.size, b.language].filter(Boolean).join(" · ")}</span>
                    {b.inLibrary && <span className="chip status-available"> Likely already in your library</span>}
                  </span>
                  <button className="btn small" disabled={asked.has(b.id)} onClick={() => request(b)}>{asked.has(b.id) ? "Requested" : "Download"}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

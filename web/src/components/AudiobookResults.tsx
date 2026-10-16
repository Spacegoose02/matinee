import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatRuntime, type AudiobookResult } from "../api";
import { Shelf } from "./Shelf";
import { useStore } from "../store";
import { Poster } from "./Cards";
import { Icon } from "./Icons";

const SEARCH_DELAY_MS = 600; // the audiobook search goes out to Audible, so wait for typing to settle

/** Audiobook search results from ReadMeABook, with a request dialog. */
export function AudiobookResults({ term }: { term: string }) {
  const { toast } = useStore();
  const [results, setResults] = useState<AudiobookResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [picked, setPicked] = useState<AudiobookResult>();
  // Requested during this visit, so the card flips without searching again.
  const [requested, setRequested] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const timer = setTimeout(async () => {
      try {
        const res = await api.audiobookSearch(term);
        if (!cancelled) {
          setResults(res.items);
          if (res.errors.length) setError(res.errors.map((e) => `${e.name}: ${e.message}`).join(" · "));
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  if (term.length < 2) return null;

  return (
    <section className="audiobook-results">
      <h2 className="group-heading">Audiobooks {loading && <span className="muted small">searching…</span>}</h2>
      {error && <p className="notice error">Audiobook search failed: {error}</p>}
      {!loading && !error && results.length === 0 && <p className="muted">No audiobooks found for “{term}”.</p>}
      <div className={`grid ${loading ? "dim" : ""}`}>
        {results.map((b) => {
          const state = requested.has(b.asin) ? "requested" : b.availability;
          return (
            <button key={b.asin} className="card" title={b.title} onClick={() => state === "unknown" && setPicked(b)}>
              <Poster src={b.coverArtUrl} title={b.title} />
              {state === "available" ? (
                <span className="tag tag-status ok">In library</span>
              ) : state === "requested" ? (
                <span className="tag tag-status">Requested</span>
              ) : (
                <span className="tag tag-add"><Icon name="plus" size={12} /> Request</span>
              )}
              <span className="card-meta">
                <span className="card-title">{b.title}</span>
                <span className="card-sub">{b.author}{b.series ? ` · ${b.series}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <RequestBookModal
          book={picked}
          onClose={() => setPicked(undefined)}
          onRequested={() => {
            setRequested((s) => new Set(s).add(picked.asin));
            toast(`Requested “${picked.title}”. ReadMeABook will search for it; follow it under Downloads → Requests.`);
          }}
        />
      )}
    </section>
  );
}

/** Popular / new-release audiobooks from ReadMeABook, one click from a request. */
export function AudiobookListShelf({ list, order }: { list: "popular" | "new"; order?: number }) {
  const { toast } = useStore();
  const [state, setState] = useState<{ loading: boolean; configured?: boolean; items: AudiobookResult[]; message?: string; error?: string }>({ loading: true, items: [] });
  const [picked, setPicked] = useState<AudiobookResult>();
  const [requested, setRequested] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api.audiobookList(list).then(
      (r) => !cancelled && setState({ loading: false, configured: r.configured, items: r.items, message: r.message }),
      (err) => !cancelled && setState({ loading: false, items: [], error: (err as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [list]);

  if (state.loading || (state.configured === false && !state.error)) return null;
  if (state.error) return <p className="notice error">Couldn't load audiobook lists: {state.error}</p>;

  // ReadMeABook fills these lists from a scheduled Audible refresh; before it has run they are empty.
  if (state.items.length === 0) {
    if (list === "popular") return null; // one explanation is enough when both lists are on the page
    return (
      <div className="hint-card">
        <Icon name="compass" size={22} />
        <div>
          <strong>ReadMeABook has no audiobook lists yet</strong>
          <span className="muted"> — it builds them from Audible data on a schedule. {state.message ?? "Run its “Audible Data Refresh” job (in its admin area) and they'll appear here."}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Shelf order={order} title={list === "popular" ? "Popular audiobooks" : "New audiobook releases"} subtitle="From ReadMeABook (titles you already have are hidden)">
        {state.items.map((b) => {
          const done = requested.has(b.asin) || b.availability === "requested";
          return (
            <button key={b.asin} className="card" title={b.title} onClick={() => !done && setPicked(b)}>
              <Poster src={b.coverArtUrl} title={b.title} />
              {done ? <span className="tag tag-status">Requested</span> : <span className="tag tag-add"><Icon name="plus" size={12} /> Request</span>}
              <span className="card-meta">
                <span className="card-title">{b.title}</span>
                <span className="card-sub">{b.author}</span>
              </span>
            </button>
          );
        })}
      </Shelf>
      {picked && (
        <RequestBookModal
          book={picked}
          onClose={() => setPicked(undefined)}
          onRequested={() => {
            setRequested((s) => new Set(s).add(picked.asin));
            toast(`Requested “${picked.title}”. Follow it under Downloads → Requests.`);
          }}
        />
      )}
    </>
  );
}

function RequestBookModal({ book, onClose, onRequested }: { book: AudiobookResult; onClose: () => void; onRequested: () => void }) {
  const { services } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.requestAudiobook(book.serviceId, book);
      setDone(true);
      onRequested();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const facts = [formatRuntime(book.durationMinutes), book.releaseDate?.slice(0, 4), book.rating ? `★ ${book.rating.toFixed(1)}` : undefined].filter(Boolean).join(" · ");

  return createPortal(
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-label={`Request ${book.title}`}>
        <button type="button" className="icon-btn close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="modal-head">
          <Poster src={book.coverArtUrl} title={book.title} className="modal-poster" />
          <div>
            <h2>{book.title}</h2>
            <div className="muted small">{book.author}{book.narrator ? ` · read by ${book.narrator}` : ""}</div>
            <div className="muted small">{facts}{book.series ? ` · ${book.series}` : ""}</div>
            {book.description && <p className="modal-overview">{book.description}</p>}
          </div>
        </div>

        {done ? (
          <div className="modal-done">
            <Icon name="download" size={28} />
            <p><strong>Requested from {services[book.serviceId]?.name ?? "ReadMeABook"}.</strong> It will search for a release and add it to your library.</p>
            <div className="actions">
              <a className="btn primary" href="#/downloads/requests" onClick={onClose}>See requests</a>
              <button type="button" className="btn" onClick={onClose}>Keep searching</button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="notice error">{error}</p>}
            <div className="actions">
              <button className="btn primary" disabled={busy}>
                <Icon name="plus" size={16} /> {busy ? "Requesting…" : "Request audiobook"}
              </button>
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

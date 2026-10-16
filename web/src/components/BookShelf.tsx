import { useEffect, useState } from "react";
import { api, type BookItem } from "../api";
import { Poster } from "./Cards";
import { Shelf } from "./Shelf";

/** Recently added ebooks from Calibre-Web; clicking one opens it in Calibre-Web. */
export function BookShelf({ order }: { order?: number }) {
  const [state, setState] = useState<{ items: BookItem[]; error?: string; loading: boolean }>({ items: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    api.recentBooks().then(
      (r) => !cancelled && setState({ items: r.items, loading: false }),
      (e) => !cancelled && setState({ items: [], loading: false, error: (e as Error).message }),
    );
    return () => { cancelled = true; };
  }, []);

  if (state.error) return <p className="notice error">Couldn't load books from Calibre-Web: {state.error}</p>;
  if (state.loading || state.items.length === 0) return null;
  return (
    <Shelf order={order} title="New books" subtitle="Recently added to Calibre-Web">
      {state.items.map((b) => (
        <a key={b.id} className="card" href={b.url} target="_blank" rel="noreferrer" title={b.title}>
          <Poster src={b.cover} title={b.title} />
          <span className="card-meta">
            <span className="card-title">{b.title}</span>
            <span className="card-sub">{b.author ?? "Book"}</span>
          </span>
        </a>
      ))}
    </Shelf>
  );
}

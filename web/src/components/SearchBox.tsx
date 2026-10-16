import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABELS, api, statusOf, type MediaItem, type SearchResult } from "../api";
import { useStore } from "../store";
import { groupResults, type DiscoverGroup } from "../pages/Discover";
import { AddModal } from "./AddModal";
import { Poster } from "./Cards";
import { Icon } from "./Icons";

const LIBRARY_ROWS = 6;
const ADD_ROWS = 5;
const LOOKUP_DELAY_MS = 350;

type Row =
  | { kind: "item"; item: MediaItem }
  | { kind: "add"; group: DiscoverGroup }
  | { kind: "library-all"; count: number }
  | { kind: "discover" };

/** Top-bar search: finds titles you have, and titles you could add, in one dropdown. */
export function SearchBox() {
  const { items, services, setQuery, openItem, reload, toast } = useStore();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<SearchResult[]>([]);
  const [looking, setLooking] = useState(false);
  const [picked, setPicked] = useState<DiscoverGroup>();
  const [dirty, setDirty] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const t = term.trim();
  const canAdd = Object.values(services).some((s) => s.enabled && (s.kind === "radarr" || s.kind === "sonarr"));

  // "/" jumps to search from anywhere, like most web apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", onDown);
    return () => removeEventListener("mousedown", onDown);
  }, []);

  // Library matches are instant; lookups for new titles wait for a pause in typing.
  useEffect(() => {
    setFound([]);
    if (!canAdd || t.length < 2) {
      setLooking(false);
      return;
    }
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.search(t);
        if (!cancelled) setFound(res.items);
      } catch {
        // The dropdown just shows no "add" suggestions; the Discover page reports errors properly.
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [t, canAdd]);

  const matches = useMemo(() => {
    const q = t.toLowerCase();
    if (!q) return [];
    return items.filter((i) => i.title.toLowerCase().includes(q) || i.author?.toLowerCase().includes(q));
  }, [items, t]);

  const addable = useMemo(() => groupResults(found).filter((g) => !g.entries.every((e) => e.inLibrary)).slice(0, ADD_ROWS), [found]);

  const rows: Row[] = [
    ...matches.slice(0, LIBRARY_ROWS).map((item): Row => ({ kind: "item", item })),
    ...(matches.length > LIBRARY_ROWS ? [{ kind: "library-all", count: matches.length } as Row] : []),
    ...addable.map((group): Row => ({ kind: "add", group })),
    ...(canAdd && t.length >= 2 ? [{ kind: "discover" } as Row] : []),
  ];

  useEffect(() => setActive(0), [t]);

  const showAllInLibrary = () => {
    setQuery(t);
    setOpen(false);
    location.hash = "#/library";
  };

  const choose = (row: Row | undefined) => {
    if (!row) return showAllInLibrary();
    setOpen(false);
    if (row.kind === "item") openItem(row.item.key);
    else if (row.kind === "add") setPicked(row.group);
    else if (row.kind === "library-all") showAllInLibrary();
    else location.hash = `#/discover/${encodeURIComponent(t)}`;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // With nothing highlighted by arrow keys, Enter means "search the library for this".
      if (e.shiftKey || !rows.length) showAllInLibrary();
      else choose(rows[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const itemRows = rows.filter((r) => r.kind === "item");
  const addRows = rows.filter((r) => r.kind === "add");
  const idx = (r: Row) => rows.indexOf(r);

  const closeModal = () => {
    setPicked(undefined);
    if (dirty) {
      setDirty(false);
      reload(false);
    }
  };

  return (
    <div className="search-wrap" ref={wrap}>
      <label className="search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          placeholder={`Search ${items.length ? items.length.toLocaleString() + " titles" : "your library"}${canAdd ? " or find new ones" : ""}   ( / )`}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            if (!e.target.value) setQuery("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && !!t}
          aria-controls="search-results"
          autoComplete="off"
        />
      </label>

      {open && t && (
        <div className="search-pop" id="search-results" role="listbox">
          {itemRows.length > 0 && <div className="sr-head">In your library</div>}
          {itemRows.map((r) => r.kind === "item" && (
            <button key={r.item.key} role="option" aria-selected={idx(r) === active} className={`sr-row ${idx(r) === active ? "active" : ""}`}
              onMouseEnter={() => setActive(idx(r))} onClick={() => choose(r)}>
              <Poster src={r.item.poster} title={r.item.title} className="sr-thumb" />
              <span className="sr-text">
                <span className="sr-title">{r.item.title}</span>
                <span className="muted small">{[r.item.year, r.item.type === "movie" ? "Movie" : r.item.type === "series" ? "Show" : "Audiobook", r.item.libraries[0]].filter(Boolean).join(" · ")}</span>
              </span>
              {statusOf(r.item) === "missing" && <span className="chip status-missing">{STATUS_LABELS.missing}</span>}
              {statusOf(r.item) === "on-disk" && <span className="chip status-on-disk">Not on a server</span>}
            </button>
          ))}
          {rows.map((r) => r.kind === "library-all" && (
            <button key="all" className={`sr-row sr-link ${idx(r) === active ? "active" : ""}`} onMouseEnter={() => setActive(idx(r))} onClick={() => choose(r)}>
              See all {r.count} matches in Library <Icon name="right" size={14} />
            </button>
          ))}

          {canAdd && t.length >= 2 && <div className="sr-head">Add something new</div>}
          {addRows.map((r) => r.kind === "add" && (
            <button key={r.group.key} role="option" aria-selected={idx(r) === active} className={`sr-row ${idx(r) === active ? "active" : ""}`}
              onMouseEnter={() => setActive(idx(r))} onClick={() => choose(r)}>
              <Poster src={r.group.poster} title={r.group.title} className="sr-thumb" />
              <span className="sr-text">
                <span className="sr-title">{r.group.title}</span>
                <span className="muted small">{[r.group.year, r.group.type === "movie" ? "Movie" : "Show", r.group.rating ? `★ ${r.group.rating.toFixed(1)}` : undefined].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="chip add-chip"><Icon name="plus" size={12} /> Add</span>
            </button>
          ))}
          {canAdd && t.length >= 2 && looking && addRows.length === 0 && <div className="sr-note muted small">Looking for new titles…</div>}
          {canAdd && t.length >= 2 && !looking && addRows.length === 0 && <div className="sr-note muted small">Nothing new found for “{t}”.</div>}
          {rows.map((r) => r.kind === "discover" && (
            <button key="discover" className={`sr-row sr-link ${idx(r) === active ? "active" : ""}`} onMouseEnter={() => setActive(idx(r))} onClick={() => choose(r)}>
              Search “{t}” in Discover <Icon name="right" size={14} />
            </button>
          ))}
          {itemRows.length === 0 && !canAdd && <div className="sr-note muted small">No titles match “{t}”.</div>}
          <div className="sr-foot muted small">↑ ↓ to move · Enter to open · Shift+Enter searches the whole library</div>
        </div>
      )}

      {picked && (
        <AddModal
          group={picked}
          onClose={closeModal}
          onAdded={() => {
            setDirty(true);
            toast(`Added “${picked.title}”. It will show in your library after the next refresh.`);
          }}
        />
      )}
    </div>
  );
}

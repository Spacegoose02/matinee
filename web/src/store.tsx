import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import {
  api, type Collection, type HomeSettings, type MediaItem, type MediaType, type QueueItem, type ServiceConfig, type ServiceError,
} from "./api";

export interface LibraryInfo { name: string; count: number; type: MediaType }
export interface Toast { id: number; text: string; tone: "ok" | "error" }

/** Which top-level page lists each kind of media. */
export const SECTION_FOR: Record<MediaType, "movies" | "shows" | "books"> = { movie: "movies", series: "shows", book: "books" };

interface Store {
  items: MediaItem[];
  collections: Collection[];
  errors: ServiceError[];
  fetchedAt?: string;
  loading: boolean;
  failure?: string;
  services: Record<string, ServiceConfig>;
  byKey: Map<string, MediaItem>;
  libraries: LibraryInfo[];
  libraryHref: (name: string) => string;
  home: HomeSettings;
  openKey?: string;
  query: string;
  toasts: Toast[];
}

/** Functions that never change identity, so memoised cards that only need them don't re-render. */
interface Actions {
  reload: (force?: boolean) => Promise<void>;
  saveHome: (next: HomeSettings) => void;
  openItem: (key?: string) => void;
  setQuery: (q: string) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
}

const StoreContext = createContext<Store | undefined>(undefined);
const ActionsContext = createContext<Actions | undefined>(undefined);

export const sameLibrary = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const inLibrary = (item: MediaItem, name: string) => item.libraries.some((l) => sameLibrary(l, name));

export function StoreProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [errors, setErrors] = useState<ServiceError[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string>();
  const [services, setServices] = useState<Record<string, ServiceConfig>>({});
  const [home, setHome] = useState<HomeSettings>({ sections: null, pinned: [] });
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  const [openKey, setOpenKey] = useState<string>();
  const [query, setQuery] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 9000 : 5500);
  }, []);

  const reload = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [lib, svc, h] = await Promise.all([api.library(force), api.services(), api.home()]);
      setItems(lib.items);
      setCollections(lib.collections);
      setErrors(lib.errors);
      setFetchedAt(lib.fetchedAt);
      setServices(Object.fromEntries(svc.services.map((s) => [s.id, s])));
      setHome(h);
      setFailure(undefined);
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveHome = useCallback((next: HomeSettings) => {
    setHome(next); // optimistic: the layout should feel instant
    api.saveHome(next).catch(() => reload());
  }, [reload]);

  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const libraries = useMemo(() => {
    // Folder names differ only by case across services ("Movies"/"movies"), so group case-insensitively
    // and call a library whatever type most of its titles are.
    const groups = new Map<string, { name: string; count: number; types: Map<MediaType, number> }>();
    for (const item of items) {
      for (const name of item.libraries) {
        const id = name.toLowerCase();
        const g = groups.get(id) ?? { name, count: 0, types: new Map() };
        g.count++;
        g.types.set(item.type, (g.types.get(item.type) ?? 0) + 1);
        groups.set(id, g);
      }
    }
    return [...groups.values()]
      .map((g): LibraryInfo => ({ name: g.name, count: g.count, type: [...g.types.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const libraryHref = useCallback(
    (name: string) => {
      const lib = libraries.find((l) => sameLibrary(l.name, name));
      return `#/${SECTION_FOR[lib?.type ?? "movie"]}/${encodeURIComponent(name)}`;
    },
    [libraries],
  );

  const actions = useMemo<Actions>(() => ({ reload, saveHome, openItem: setOpenKey, setQuery, toast }), [reload, saveHome, toast]);

  const value = useMemo<Store>(
    () => ({ items, collections, errors, fetchedAt, loading, failure, services, byKey, libraries, libraryHref, home, openKey, query, toasts }),
    [items, collections, errors, fetchedAt, loading, failure, services, byKey, libraries, libraryHref, home, openKey, query, toasts],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Data plus actions, for pages. Re-renders whenever data changes. */
export function useStore(): Store & Actions {
  const s = useContext(StoreContext);
  const a = useContext(ActionsContext);
  if (!s || !a) throw new Error("useStore outside StoreProvider");
  return useMemo(() => ({ ...s, ...a }), [s, a]);
}

/** Actions only. Components that use just this don't re-render when the library changes. */
export function useActions(): Actions {
  const a = useContext(ActionsContext);
  if (!a) throw new Error("useActions outside StoreProvider");
  return a;
}

const SPEED_SAMPLES = 60;

/** Polls the download queue and keeps a short history of total speed for the sparkline. */
export function useQueue(intervalMs = 5000) {
  const [items, setItems] = useState<QueueItem[]>();
  const [errors, setErrors] = useState<ServiceError[]>([]);
  const [failure, setFailure] = useState<string>();
  const [speeds, setSpeeds] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await api.queue();
        if (cancelled) return;
        setItems(res.items);
        setErrors(res.errors);
        setFailure(undefined);
        const total = res.items.reduce((sum, i) => sum + (i.speedBytes ?? 0), 0);
        setSpeeds((prev) => [...prev.slice(-(SPEED_SAMPLES - 1)), total]);
      } catch (err) {
        if (!cancelled) setFailure((err as Error).message);
      }
      if (!cancelled) timer = setTimeout(poll, intervalMs);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [intervalMs, tick]);

  return { items, errors, failure, speeds, reload };
}

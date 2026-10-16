import { useEffect, useMemo, useState } from "react";
import { api, type MediaType } from "./api";
import { APP_NAME } from "./brand";
import { useAuth } from "./auth";
import { Details } from "./components/Details";
import { Icon } from "./components/Icons";
import { ManateeMark } from "./components/Logo";
import { SearchBox } from "./components/SearchBox";
import { Toasts } from "./components/Toasts";
import { Collections } from "./pages/Collections";
import { Discover } from "./pages/Discover";
import { Ebooks } from "./pages/Ebooks";
import { Downloads } from "./pages/Downloads";
import { Home } from "./pages/Home";
import { Library } from "./pages/Library";
import { ListPage } from "./pages/ListPage";
import { Settings } from "./pages/Settings";
import { sameLibrary, useQueue, useStore } from "./store";
import { applyTheme, loadTheme } from "./themes";

const PAGES = ["home", "movies", "shows", "books", "library", "collections", "discover", "downloads", "settings", "list", "ebooks"] as const;
type Page = (typeof PAGES)[number];

const KIND_OF: Partial<Record<Page, MediaType>> = { movies: "movie", shows: "series", books: "book" };

interface NavEntry { page: Page; label: string; icon: string; kind?: MediaType }
const BROWSE: NavEntry[] = [
  { page: "movies", label: "Movies", icon: "film", kind: "movie" },
  { page: "shows", label: "TV Shows", icon: "tv", kind: "series" },
  { page: "books", label: "Audiobooks", icon: "book", kind: "book" },
];

function parseRoute(): { page: Page; arg?: string } {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const page = PAGES.find((p) => p === parts[0]) ?? "home";
  return { page, arg: parts[1] };
}

export function App() {
  const [route, setRoute] = useState(parseRoute);
  const [theme, setThemeState] = useState(loadTheme);
  const { user, authEnabled, signOut } = useAuth();
  const setTheme = (id: string) => {
    setThemeState(id);
    if (user) void api.savePrefs({ theme: id }).catch(() => {});
  };
  const { libraries, items, loading, reload, services } = useStore();
  const hasEbooks = Object.values(services).some((s) => (s.kind === "calibreweb" || s.kind === "shelfmark") && s.enabled);
  const { items: queue } = useQueue(5000);
  // Everything the download clients are fetching (the managers' queues just mirror those).
  const downloading = (queue ?? []).filter((q) => q.client !== "radarr" && q.client !== "sonarr").length;

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      scrollTo({ top: 0 });
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const counts = useMemo(() => {
    const c: Record<MediaType, number> = { movie: 0, series: 0, book: 0 };
    for (const i of items) c[i.type]++;
    return c;
  }, [items]);

  const link = (page: Page, label: string, icon: string, count?: number) => (
    <a
      href={`#/${page}`}
      className={`nav-link ${route.page === page && !route.arg ? "active" : ""} ${route.page === page ? "current" : ""}`}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {count !== undefined && <span className="nav-count">{count.toLocaleString()}</span>}
    </a>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/home">
          <span className="brand-mark"><ManateeMark height={26} /></span>
          <span className="brand-name">{APP_NAME}</span>
        </a>
        <nav>
          <div className="nav-group">{link("home", "Home", "home")}</div>
          {BROWSE.filter((n) => counts[n.kind!] > 0).map((n) => {
            const libs = libraries.filter((l) => l.type === n.kind);
            return (
              <div key={n.page} className="nav-group">
                {link(n.page, n.label, n.icon, counts[n.kind!])}
                {route.page === n.page && libs.length > 1 && (
                  <div className="subnav">
                    {libs.map((l) => (
                      <a
                        key={l.name}
                        href={`#/${n.page}/${encodeURIComponent(l.name)}`}
                        className={route.arg && sameLibrary(route.arg, l.name) ? "active" : undefined}
                      >
                        <span>{l.name}</span>
                        <span className="count">{l.count.toLocaleString()}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="nav-group">{link("collections", "Collections", "stack")}</div>
          <div className="nav-group">{link("discover", "Discover", "compass")}</div>
          {hasEbooks && <div className="nav-group">{link("ebooks", "Books", "book")}</div>}
          <div className="nav-group">{link("downloads", "Downloads", "download", downloading > 0 ? downloading : undefined)}</div>
          <div className="nav-group">{link("settings", "Settings", "gear")}</div>
        </nav>
        {authEnabled && user && (
          <div className="side-user">
            <span title={user.role === "admin" ? "Administrator" : "User"}>{user.name}</span>
            <button className="btn small ghost" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </aside>

      <div className="content">
        <header className="topbar">
          <SearchBox />
          <button className={`icon-btn ${loading ? "spin" : ""}`} onClick={() => reload(true)} aria-label="Refresh library" title="Refresh library">
            <Icon name="refresh" />
          </button>
        </header>

        <main key={`${route.page}/${route.arg ?? ""}`}>
          {route.page === "home" && <Home />}
          {(route.page === "movies" || route.page === "shows" || route.page === "books") && (
            <Library kind={KIND_OF[route.page]} library={route.arg} />
          )}
          {route.page === "library" && <Library library={route.arg} />}
          {route.page === "collections" && <Collections selected={route.arg} />}
          {route.page === "discover" && <Discover initialQuery={route.arg} />}
          {route.page === "downloads" && <Downloads tab={route.arg} />}
          {route.page === "list" && <ListPage arg={route.arg} />}
          {route.page === "ebooks" && <Ebooks />}
          {route.page === "settings" && <Settings theme={theme} onTheme={setTheme} tab={route.arg} />}
        </main>
      </div>
      <Details />
      <Toasts />
    </div>
  );
}

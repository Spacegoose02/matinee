import { useEffect, useState } from "react";
import {
  DEFAULT_PORTS, KIND_LABELS, api,
  type CredentialField, type ServiceConfig, type ServiceKind, type ServicesResponse, type TestResult,
} from "../api";
import { Icon } from "../components/Icons";
import { useStore } from "../store";
import { THEMES } from "../themes";
import { UsersSettings } from "../components/UsersSettings";
import { useAuth } from "../auth";
import { StorageSettings } from "./StorageSettings";

const FIELD_LABELS: Record<CredentialField, string> = {
  apiKey: "API key / token",
  username: "Username",
  password: "Password",
};

const HINTS: Partial<Record<ServiceKind, Partial<Record<CredentialField, string>>>> = {
  radarr: { apiKey: "Settings → General → API Key" },
  sonarr: { apiKey: "Settings → General → API Key" },
  sabnzbd: { apiKey: "Config → General → API Key" },
  qbittorrent: { username: "Web UI login. Leave both empty if qBittorrent bypasses auth for your network.", password: "Web UI password" },
  deluge: { password: "The Deluge Web UI password (not the daemon's)" },
  plex: { apiKey: "Your X-Plex-Token" },
  jellyfin: { apiKey: "Dashboard → API Keys → add one for Matinee" },
  audiobookshelf: { apiKey: "Settings → API Keys (or your user's API token)" },
  shelfmark: { username: "Only needed if Shelfmark has a login enabled" },
  readmeabook: { apiKey: "An API token (starts with rmab_) created in ReadMeABook's admin settings. An admin token also lets Matinee show active downloads; any token can search and request." },
  calibreweb: { username: "The same username and password you use on Calibre-Web's login page. The address is where you open it, for example http://192.168.1.10:8083. OPDS must be switched on (Calibre-Web admin → Edit Basic Configuration → Feature Configuration → Enable OPDS feed).", password: "Your Calibre-Web password" },
  mdblist: { apiKey: "Free at mdblist.com → your profile → API key. Lets you put any MDBList list on the Home page." },
  tmdb: { apiKey: "Free at themoviedb.org → Settings → API: paste the API Read Access Token (or the v3 key). Powers trending on Home and Discover." },
};

type Draft = Omit<ServiceConfig, "id"> & { id?: string };

const blank = (kind: ServiceKind): Draft => ({
  kind, name: KIND_LABELS[kind], url: kind === "tmdb" ? "https://api.themoviedb.org" : kind === "mdblist" ? "https://api.mdblist.com" : "", apiKey: "", username: "", password: "", enabled: true,
});

type Tab = "services" | "storage" | "appearance" | "users";

export function Settings({ theme, onTheme, tab: initialTab }: { theme: string; onTheme: (id: string) => void; tab?: string }) {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>(!isAdmin ? "appearance" : initialTab === "storage" ? "storage" : initialTab === "appearance" ? "appearance" : initialTab === "users" ? "users" : "services");
  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="segmented tabs">
        {isAdmin && <button className={tab === "services" ? "active" : undefined} onClick={() => setTab("services")}>Services</button>}
        {isAdmin && <button className={tab === "storage" ? "active" : undefined} onClick={() => setTab("storage")}>Storage</button>}
        <button className={tab === "appearance" ? "active" : undefined} onClick={() => setTab("appearance")}>Appearance</button>
        {isAdmin && <button className={tab === "users" ? "active" : undefined} onClick={() => setTab("users")}>Users</button>}
      </div>
      {tab === "users" ? <UsersSettings /> : tab === "services" ? <Services /> : tab === "storage" ? <StorageSettings /> : <Appearance theme={theme} onTheme={onTheme} />}
    </div>
  );
}

function Appearance({ theme, onTheme }: { theme: string; onTheme: (id: string) => void }) {
  return (
    <section>
      <p className="muted">Pick a look. It applies instantly and is remembered in this browser.</p>
      {(["Modern", "Retro"] as const).map((group) => (
        <div key={group}>
          <h2 className="group-heading">{group}</h2>
          <div className="theme-grid">
            {THEMES.filter((t) => t.group === group).map((t) => (
              <button key={t.id} className={`theme-card ${t.id === theme ? "selected" : ""}`} onClick={() => onTheme(t.id)}>
                <span className="theme-preview" style={{ background: t.swatch[0] }}>
                  <span className="theme-bar" style={{ background: t.swatch[1] }} />
                  <span className="theme-dots">
                    <i style={{ background: t.swatch[2] }} />
                    <i style={{ background: t.swatch[3] }} />
                  </span>
                </span>
                <span className="theme-name">{t.name}</span>
                <span className="muted small">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Services() {
  const { reload } = useStore();
  const [meta, setMeta] = useState<ServicesResponse>();
  const [draft, setDraft] = useState<Draft>();
  const [failure, setFailure] = useState<string>();
  const [health, setHealth] = useState<Record<string, TestResult | "running">>({});

  const load = async () => {
    try {
      const res = await api.services();
      setMeta(res);
      // Check every saved connection so problems are visible without opening each one.
      setHealth(Object.fromEntries(res.services.map((s) => [s.id, "running" as const])));
      res.services.forEach((s) =>
        api.testService(s).then(
          (r) => setHealth((h) => ({ ...h, [s.id]: r })),
          (e) => setHealth((h) => ({ ...h, [s.id]: { ok: false, message: e.message } })),
        ),
      );
    } catch (err) {
      setFailure((err as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (failure) return <p className="notice error">Couldn't load services: {failure}</p>;
  if (!meta) return <p className="muted">Loading…</p>;

  return (
    <section>
      <div className="services-head">
        <p className="muted">Connect the apps Matinee reads from. Secrets stay on the server.</p>
        <select
          value=""
          onChange={(e) => e.target.value && setDraft(blank(e.target.value as ServiceKind))}
          aria-label="Add a service"
        >
          <option value="">+ Add service…</option>
          {meta.kinds.map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {meta.services.length === 0 && !draft && (
        <p className="muted empty-line">Nothing connected yet. Add Radarr, Sonarr, your download clients and Plex/Jellyfin to get started.</p>
      )}

      <ul className="services">
        {meta.services.map((s) => {
          const h = health[s.id];
          return (
            <li key={s.id} className={draft?.id === s.id ? "editing" : undefined}>
              <span className={`health ${h === "running" || !h ? "pending" : h.ok ? "ok" : "bad"}`} title={h && h !== "running" ? (h.ok ? `Connected${h.version ? ` · v${h.version}` : ""}` : h.message) : "Checking…"} />
              <span className={`chip kind-${s.kind}`}>{KIND_LABELS[s.kind]}</span>
              <div className="service-main">
                <strong>{s.name}</strong>
                <span className="muted small">{s.url}</span>
                {h && h !== "running" && !h.ok && <span className="service-error small">{h.message}</span>}
              </div>
              {!s.enabled && <span className="chip dim">Disabled</span>}
              <button className="btn" onClick={() => setDraft({ ...s })}>Edit</button>
            </li>
          );
        })}
      </ul>

      {draft && (
        <ServiceForm
          key={draft.id ?? draft.kind}
          initial={draft}
          fields={meta.credentialFields[draft.kind]}
          onDone={(changed) => {
            setDraft(undefined);
            if (changed) {
              load();
              reload(true);
            }
          }}
        />
      )}
    </section>
  );
}

function ServiceForm({ initial, fields, onDone }: { initial: Draft; fields: CredentialField[]; onDone: (changed: boolean) => void }) {
  const [d, setD] = useState(initial);
  const [test, setTest] = useState<TestResult | "running">();
  const [error, setError] = useState<string>();
  const [reveal, setReveal] = useState<Partial<Record<CredentialField, boolean>>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const runTest = async () => {
    setTest("running");
    try {
      setTest(await api.testService(d, true));
    } catch (err) {
      setTest({ ok: false, message: (err as Error).message });
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await (d.id ? api.updateService(d as ServiceConfig) : api.createService(d));
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!d.id || !confirm(`Remove ${d.name}?`)) return;
    await api.deleteService(d.id);
    onDone(true);
  };

  return (
    <form className="service-form" onSubmit={save}>
      <h2>{d.id ? `Edit ${d.name}` : `Add ${KIND_LABELS[d.kind]}`}</h2>
      <label>
        Name
        <input value={d.name} onChange={(e) => set("name", e.target.value)} required />
      </label>
      <label>
        URL
        <input
          value={d.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder={`http://192.168.1.10:${DEFAULT_PORTS[d.kind]}`}
          required
        />
        <span className="muted small">Use the address Matinee's container can reach — a LAN IP or your reverse-proxy URL, not localhost.</span>
      </label>
      {fields.map((f) => (
        <label key={f}>
          {FIELD_LABELS[f]}
          <span className="input-action">
            <input
              type={f === "username" || reveal[f] ? "text" : "password"}
              value={d[f]}
              onChange={(e) => set(f, e.target.value)}
              autoComplete={f === "username" ? "off" : "new-password"}
              spellCheck={false}
            />
            {f !== "username" && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setReveal((r) => ({ ...r, [f]: !r[f] }))}
                aria-label={reveal[f] ? "Hide" : "Show"}
                title={reveal[f] ? "Hide" : "Show what's typed"}
              >
                <Icon name={reveal[f] ? "eyeoff" : "eye"} size={16} />
              </button>
            )}
          </span>
          {HINTS[d.kind]?.[f] && <span className="muted small">{HINTS[d.kind]?.[f]}</span>}
        </label>
      ))}
      <label className="inline">
        <input type="checkbox" checked={d.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Enabled
      </label>

      {test && (
        <p className={`notice ${test === "running" ? "" : test.ok ? "ok" : "error"}`}>
          {test === "running"
            ? "Testing…"
            : test.ok
              ? `Connected${test.version ? ` · v${test.version}` : ""}${test.message ? ` · ${test.message}` : ""}`
              : test.message ?? "Connection failed"}
        </p>
      )}
      {error && <p className="notice error">{error}</p>}

      <div className="actions">
        <button type="button" className="btn" onClick={runTest} disabled={!d.url || test === "running"}>
          <Icon name="refresh" size={16} /> Test
        </button>
        <button type="submit" className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={() => onDone(false)}>Cancel</button>
        {d.id && (
          <button type="button" className="btn danger" onClick={remove}>Remove</button>
        )}
      </div>
    </form>
  );
}

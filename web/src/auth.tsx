import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, type AuthUser } from "./api";
import { APP_NAME } from "./brand";
import { ManateeMark } from "./components/Logo";
import { applyTheme } from "./themes";

interface AuthState { user: AuthUser | null; authEnabled: boolean; isAdmin: boolean; refresh: () => Promise<void>; signOut: () => Promise<void> }

const AuthContext = createContext<AuthState>({ user: null, authEnabled: false, isAdmin: true, refresh: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

/** Shows the sign-in page when login is on and nobody is signed in; otherwise the app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; user: AuthUser | null; authEnabled: boolean }>({ ready: false, user: null, authEnabled: false });

  const refresh = useCallback(async () => {
    try {
      const s = await api.authStatus();
      // Each person's saved look follows them to any browser.
      if (s.user && s.prefs.theme) applyTheme(s.prefs.theme);
      setState({ ready: true, user: s.user, authEnabled: s.authEnabled });
    } catch {
      setState((p) => ({ ...p, ready: true }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onLapse = () => setState((p) => (p.authEnabled ? { ...p, user: null } : p));
    window.addEventListener("matinee-unauthorized", onLapse);
    return () => window.removeEventListener("matinee-unauthorized", onLapse);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setState((p) => ({ ...p, user: null }));
  }, []);

  if (!state.ready) return null;
  if (state.authEnabled && !state.user) return <Login onDone={refresh} />;

  const value: AuthState = { user: state.user, authEnabled: state.authEnabled, isAdmin: !state.authEnabled || state.user?.role === "admin", refresh, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.login(name.trim(), password);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><ManateeMark height={44} /><h1>{APP_NAME}</h1></div>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="notice error">{error}</p>}
        <button className="btn primary" disabled={busy || !name.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

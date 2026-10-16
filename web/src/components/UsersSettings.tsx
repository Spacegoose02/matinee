import { useEffect, useState, type FormEvent } from "react";
import { api, type UserSummary } from "../api";
import { useAuth } from "../auth";
import { useStore } from "../store";

/** Turn on sign-in and manage who can use Matinee. */
export function UsersSettings() {
  const { authEnabled, user, refresh } = useAuth();
  return authEnabled ? <Manage me={user?.id} onChange={refresh} /> : <TurnOn onDone={refresh} />;
}

function TurnOn({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.setupLogin(name.trim(), password);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section>
      <p className="muted">
        Right now anyone who can open Matinee can use it, change settings and delete things. Turn on sign-in to give each person their own account, Home layout and theme.
        The first account becomes an administrator; you can add regular users afterwards. Regular users can browse, search, add and request; only administrators change
        settings, manage or delete files, or control downloads.
      </p>
      <form className="rule-body" onSubmit={submit}>
        <h3>Create the administrator</h3>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" /></label>
        <label>Password (at least 8 characters)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
        {error && <p className="notice error">{error}</p>}
        <div className="actions"><button className="btn primary" disabled={busy || !name.trim() || password.length < 8}>Turn on sign-in</button></div>
      </form>
    </section>
  );
}

function Manage({ me, onChange }: { me?: string; onChange: () => Promise<void> }) {
  const { toast } = useStore();
  const [users, setUsers] = useState<UserSummary[]>();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState<string>();

  const load = () => api.users().then((r) => setUsers(r.users), (e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      await api.addUser(name.trim(), password, role);
      setName("");
      setPassword("");
      toast("Account created.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const reset = async (u: UserSummary) => {
    const pw = prompt(`New password for ${u.name} (at least 8 characters). They will be signed out everywhere.`);
    if (!pw) return;
    try {
      await api.setUserPassword(u.id, pw);
      toast("Password changed.");
      if (u.id === me) await onChange();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const remove = async (u: UserSummary) => {
    if (!confirm(`Delete ${u.name}'s account and their saved Home layout?`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const turnOff = async () => {
    if (!confirm("Turn off sign-in? Every account is deleted and anyone who can open Matinee can use it again.")) return;
    await api.disableLogin();
    await onChange();
  };

  return (
    <section>
      {error && <p className="notice error">{error}</p>}
      <ul className="rule-list">
        {(users ?? []).map((u) => (
          <li key={u.id} className="rule">
            <span><strong>{u.name}</strong> <span className="chip dim">{u.role === "admin" ? "Administrator" : "User"}</span>{u.id === me && <span className="muted small"> · you</span>}</span>
            <span className="actions">
              <button className="btn small" onClick={() => reset(u)}>Change password</button>
              {u.id !== me && <button className="btn small danger" onClick={() => remove(u)}>Delete</button>}
            </span>
          </li>
        ))}
      </ul>
      <form className="rule-body" onSubmit={add}>
        <h3>Add someone</h3>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Password (at least 8 characters)<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
        <label>Can<select value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}>
          <option value="user">Browse, search, add and request</option>
          <option value="admin">Do everything (administrator)</option>
        </select></label>
        <div className="actions"><button className="btn primary" disabled={!name.trim() || password.length < 8}>Create account</button></div>
      </form>
      <div className="actions"><button className="btn danger" onClick={turnOff}>Turn off sign-in…</button></div>
    </section>
  );
}

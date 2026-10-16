import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ServiceConfig, ServiceKind } from "./services/types.js";

export const configDir = process.env.CONFIG_DIR ?? "./config";
export const postersDir = join(configDir, "posters");
mkdirSync(postersDir, { recursive: true });

const db = new DatabaseSync(join(configDir, "marquee.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

type Row = {
  id: string; kind: string; name: string; url: string;
  api_key: string; username: string; password: string; enabled: number;
};

const fromRow = (r: Row): ServiceConfig => ({
  id: r.id,
  kind: r.kind as ServiceKind,
  name: r.name,
  url: r.url,
  apiKey: r.api_key,
  username: r.username,
  password: r.password,
  enabled: r.enabled === 1,
});

export function listServices(): ServiceConfig[] {
  return (db.prepare("SELECT * FROM services ORDER BY kind, name").all() as Row[]).map(fromRow);
}

export function getService(id: string): ServiceConfig | undefined {
  const row = db.prepare("SELECT * FROM services WHERE id = ?").get(id) as Row | undefined;
  return row && fromRow(row);
}

export function saveService(s: ServiceConfig): void {
  db.prepare(`
    INSERT INTO services (id, kind, name, url, api_key, username, password, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, name = excluded.name, url = excluded.url,
      api_key = excluded.api_key, username = excluded.username,
      password = excluded.password, enabled = excluded.enabled
  `).run(s.id, s.kind, s.name, s.url, s.apiKey, s.username, s.password, s.enabled ? 1 : 0);
}

export function deleteService(id: string): void {
  db.prepare("DELETE FROM services WHERE id = ?").run(id);
}

/** Small JSON key/value store for UI state (home layout, poster overrides). */
export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

// --- Users and sessions (optional sign-in; see auth.ts) -------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

export interface UserRow { id: string; name: string; salt: string; hash: string; role: "admin" | "user"; created_at: string }

export const countUsers = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
export const countAdmins = () => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
export const listUsers = () => db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[];
export const getUserById = (id: string) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
export const getUserByName = (name: string) => db.prepare("SELECT * FROM users WHERE name = ?").get(name) as unknown as UserRow | undefined;

export function createUser(u: UserRow): void {
  db.prepare("INSERT INTO users (id, name, salt, hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(u.id, u.name, u.salt, u.hash, u.role, u.created_at);
}

export function deleteUser(id: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(`home:${id}`, `theme:${id}`);
}

export function setUserPassword(id: string, salt: string, hash: string): void {
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hash, id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
}

export function clearUsers(): void {
  db.exec("DELETE FROM sessions; DELETE FROM users; DELETE FROM settings WHERE key LIKE 'home:%' OR key LIKE 'theme:%';");
}

export function createSession(tokenHash: string, userId: string, expiresAt: number): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function deleteSession(tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function sessionUser(tokenHash: string): { id: string; name: string; role: "admin" | "user" } | undefined {
  const row = db.prepare(`
    SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now()) as { id: string; name: string; role: "admin" | "user" } | undefined;
  return row;
}

// Optional sign-in. With no users, Matinee is open like it always was. Creating the first administrator turns
// login on; after that every /api call needs a session, and only administrators can change settings or files.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  clearUsers, countAdmins, countUsers, createSession, createUser, deleteSession, deleteUser, getSetting, getUserById, getUserByName,
  listUsers, sessionUser, setSetting, setUserPassword, type UserRow,
} from "./db.js";

export interface SessionUser { id: string; name: string; role: "admin" | "user" }

declare module "fastify" {
  interface FastifyRequest { user?: SessionUser }
}

const COOKIE = "matinee_session";
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const scryptAsync = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

async function makeHash(password: string) {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: (await scryptAsync(password, salt)).toString("hex") };
}

async function checkPassword(user: UserRow, password: string) {
  const expected = Buffer.from(user.hash, "hex");
  const actual = await scryptAsync(password, Buffer.from(user.salt, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const parseCookies = (header: string | undefined) =>
  Object.fromEntries((header ?? "").split(";").map((p) => p.trim().split("=")).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join("=")]));

// A few wrong passwords from one address locks it out for a while.
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 6;
const LOCK_MS = 15 * 60_000;

/** Only administrators may call these (any method), because they read or change server-side paths and credentials. */
const ADMIN_ANY = ["/api/storage", "/api/users", "/api/import-browse", "/api/import-scan", "/api/import-issues", "/api/auth/disable"];
/** Everything else here is read-only for regular users and writable by administrators. */
const ADMIN_WRITE = [
  "/api/services", "/api/manage", "/api/downloads/control", "/api/import-", "/api/remote-path", "/api/collections", "/api/trailers/download",
  "/api/poster", "/api/podcasts/delete-episodes", "/api/settings/storage",
];
const PUBLIC = ["/api/auth/status", "/api/auth/login", "/api/auth/setup"];

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("user", undefined);

  // Locked out? Start once with MATINEE_RESET_AUTH=1 to remove every account and turn sign-in off.
  if (process.env.MATINEE_RESET_AUTH === "1") {
    clearUsers();
    app.log.warn("MATINEE_RESET_AUTH is set: all accounts removed, sign-in is off. Remove the variable again.");
  }

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || PUBLIC.includes(path)) {
      // Even public routes know who is asking, so the page can show it.
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) req.user = sessionUser(hashToken(token));
      return;
    }
    if (countUsers() === 0) return; // login is off
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const user = token ? sessionUser(hashToken(token)) : undefined;
    if (!user) return reply.code(401).send({ message: "Sign in to continue" });
    req.user = user;
    const write = req.method !== "GET" && req.method !== "HEAD";
    const needsAdmin = ADMIN_ANY.some((p) => path.startsWith(p)) || (write && ADMIN_WRITE.some((p) => path.startsWith(p)));
    if (needsAdmin && user.role !== "admin") return reply.code(403).send({ message: "Only an administrator can do that" });
  });

  const cookie = (token: string, maxAge: number) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

  const prefs = (user?: SessionUser) => ({ theme: user ? getSetting<string | null>(`theme:${user.id}`, null) : null });

  app.get("/api/auth/status", async (req) => ({
    authEnabled: countUsers() > 0,
    user: req.user ?? null,
    prefs: prefs(req.user),
  }));

  async function startSession(user: UserRow, reply: { header: (k: string, v: string) => unknown }) {
    const token = randomBytes(32).toString("hex");
    createSession(hashToken(token), user.id, Date.now() + SESSION_DAYS * 86_400_000);
    reply.header("Set-Cookie", cookie(token, SESSION_DAYS * 86_400));
  }

  // The very first account is the administrator, and creating it turns login on.
  app.post<{ Body: { name?: string; password?: string } }>("/api/auth/setup", async (req, reply) => {
    if (countUsers() > 0) throw app.httpErrors.forbidden("Login is already set up");
    const { name, password } = req.body ?? {};
    const user = await addUser(name, password, "admin");
    await startSession(user, reply);
    return { user: { id: user.id, name: user.name, role: user.role } };
  });

  app.post<{ Body: { name?: string; password?: string } }>("/api/auth/login", async (req, reply) => {
    const key = `${req.ip}|${(req.body?.name ?? "").toLowerCase()}`;
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILS && f.until > Date.now()) throw app.httpErrors.tooManyRequests("Too many wrong passwords. Try again in a few minutes.");
    const user = req.body?.name ? getUserByName(req.body.name) : undefined;
    const ok = user && typeof req.body?.password === "string" && (await checkPassword(user, req.body.password));
    if (!user || !ok) {
      failures.set(key, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + LOCK_MS });
      throw app.httpErrors.unauthorized("Wrong name or password");
    }
    failures.delete(key);
    await startSession(user, reply);
    return { user: { id: user.id, name: user.name, role: user.role } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) deleteSession(hashToken(token));
    reply.header("Set-Cookie", cookie("", 0));
    return { ok: true };
  });

  app.put<{ Body: { theme?: string } }>("/api/auth/prefs", async (req) => {
    if (!req.user) return { ok: true };
    const theme = req.body?.theme;
    if (typeof theme === "string" && /^[a-z0-9-]{1,30}$/.test(theme)) setSetting(`theme:${req.user.id}`, theme);
    return { ok: true };
  });

  async function addUser(name: string | undefined, password: string | undefined, role: "admin" | "user") {
    const clean = (name ?? "").trim();
    if (!/^[\w .@-]{2,40}$/.test(clean)) throw app.httpErrors.badRequest("Use 2 to 40 letters, numbers or . _ - @ for the name");
    if (!password || password.length < MIN_PASSWORD) throw app.httpErrors.badRequest(`The password needs at least ${MIN_PASSWORD} characters`);
    if (getUserByName(clean)) throw app.httpErrors.conflict("That name is taken");
    const { salt, hash } = await makeHash(password);
    const user: UserRow = { id: randomUUID(), name: clean, salt, hash, role, created_at: new Date().toISOString() };
    createUser(user);
    return user;
  }

  app.get("/api/users", async () => ({ users: listUsers().map((u) => ({ id: u.id, name: u.name, role: u.role, createdAt: u.created_at })) }));

  app.post<{ Body: { name?: string; password?: string; role?: string } }>("/api/users", async (req) => {
    const user = await addUser(req.body?.name, req.body?.password, req.body?.role === "admin" ? "admin" : "user");
    return { user: { id: user.id, name: user.name, role: user.role } };
  });

  app.put<{ Params: { id: string }; Body: { password?: string } }>("/api/users/:id/password", async (req) => {
    const user = getUserById(req.params.id);
    if (!user) throw app.httpErrors.notFound();
    if (!req.body?.password || req.body.password.length < MIN_PASSWORD) throw app.httpErrors.badRequest(`The password needs at least ${MIN_PASSWORD} characters`);
    const { salt, hash } = await makeHash(req.body.password);
    setUserPassword(user.id, salt, hash); // also signs that person out everywhere
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/users/:id", async (req) => {
    const user = getUserById(req.params.id);
    if (!user) throw app.httpErrors.notFound();
    if (req.user?.id === user.id) throw app.httpErrors.badRequest("You can't delete the account you're signed in with");
    if (user.role === "admin" && countAdmins() <= 1) throw app.httpErrors.badRequest("There must be at least one administrator");
    deleteUser(user.id);
    return { ok: true };
  });

  // Back to an open Matinee: removes every account.
  app.post("/api/auth/disable", async (_req, reply) => {
    clearUsers();
    reply.header("Set-Cookie", cookie("", 0));
    return { ok: true };
  });
}

/** Each person's own Home layout; falls back to the shared one until they save theirs. */
export const homeKeyFor = (req: FastifyRequest) => (req.user ? `home:${req.user.id}` : "home");

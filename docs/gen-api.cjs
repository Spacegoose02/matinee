// Generates docs/API.md from the route declarations so it cannot drift from the code.
const fs = require("fs");
const path0 = require("path");
const repo = path0.resolve(__dirname, "..");
const root = repo + "/server/src/";
const files = ["index.ts", "auth.ts"];
const ADMIN_ANY = ["/api/storage", "/api/users", "/api/import-browse", "/api/import-scan", "/api/import-issues", "/api/auth/disable"];
const ADMIN_WRITE = ["/api/services", "/api/manage", "/api/downloads/control", "/api/import-", "/api/remote-path", "/api/collections", "/api/trailers/download", "/api/poster", "/api/podcasts/delete-episodes", "/api/settings/storage"];
const PUBLIC = ["/api/auth/status", "/api/auth/login", "/api/auth/setup"];

const rows = [];
for (const f of files) {
  const lines = fs.readFileSync(root + f, "utf8").split("\n");
  let section = f === "auth.ts" ? "Sign-in and users" : "";
  lines.forEach((line, i) => {
    const banner = /^\/\/ --- (.+?)(?: -+)?$/.exec(line);
    if (banner) section = banner[1].replace(/\s*-+\s*$/, "");
    const m = /^\s*app\.(get|post|put|delete)(?:<[\s\S]*?>)?\("([^"]+)"/.exec(line) || /^\s*app\.(get|post|put|delete)\("([^"]+)"/.exec(line);
    if (!m) return;
    const method = m[1].toUpperCase();
    const path = m[2];
    const write = method !== "GET";
    let access = "signed in";
    if (PUBLIC.includes(path)) access = "public";
    else if (ADMIN_ANY.some((p) => path.startsWith(p)) || (write && ADMIN_WRITE.some((p) => path.startsWith(p)))) access = "admin";
    rows.push({ section: section || "General", method, path, access, where: `${f}:${i + 1}` });
  });
}
const bySection = new Map();
for (const r of rows) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r]);

let out = `# HTTP API

Routes exposed by Matinee itself. The web app is the only intended client, so this is a reference for development and
debugging rather than a stable public API. **Generated from the route declarations** by
\`docs/gen-api.cjs\`; run \`node docs/gen-api.cjs\` after adding or changing routes.

Access levels (enforced in \`server/src/auth.ts\`):

- **public**: no sign-in needed (login screen helpers).
- **signed in**: needs a session when sign-in is turned on; always open when no accounts exist.
- **admin**: administrators only when sign-in is on. Chosen by the \`ADMIN_ANY\` / \`ADMIN_WRITE\` prefix lists in \`auth.ts\`.

Errors are JSON \`{ "statusCode", "error", "message" }\`. A 502 means an upstream service failed; its message is passed through.
A 401 from \`/api/*\` means the session lapsed.

`;
for (const [section, list] of bySection) {
  out += `## ${section}\n\n| Method | Path | Access | Source |\n| --- | --- | --- | --- |\n`;
  for (const r of list) out += `| ${r.method} | \`${r.path}\` | ${r.access} | \`server/src/${r.where}\` |\n`;
  out += "\n";
}
out += `## Static

- \`/posters/*\`: poster and cover overrides saved in the config folder (public).
- Everything else serves the built web app (\`web/dist\`) with an SPA fallback.
`;
fs.writeFileSync(repo + "/docs/API.md", out);

console.log(rows.length, "routes,", bySection.size, "sections");

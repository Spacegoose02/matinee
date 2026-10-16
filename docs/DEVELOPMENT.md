<!-- brand:start -->
<p align="center"><a href="../README.md"><img src="../brand/logo.svg" alt="Matinee" height="56"></a></p>

<p align="center"><a href="../README.md">Home</a> · <a href="HANDOVER.md">Handover</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="DEVELOPMENT.md">Development</a> · <a href="EXTENDING.md">Extending</a> · <a href="FEATURES.md">Features</a> · <a href="SERVICES.md">Services</a> · <a href="API.md">API</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="OPERATIONS.md">Operations</a></p>

---
<!-- brand:end -->

# Development

## Requirements

- Node.js **24** (the server uses the built-in `node:sqlite`; Node 22 and earlier will not work).
- npm 10+. No other tools are required to work on the code.
- Docker, only to build the image. `yt-dlp` and `ffmpeg` only if you want to exercise trailer downloads locally.

## Setup

```bash
git clone https://github.com/Spacegoose02/matinee.git
cd matinee
npm install            # installs both workspaces
npm run dev:server     # http://localhost:7171  (tsx watch; restarts on change)
npm run dev:web        # http://localhost:5173  (Vite; proxies /api to :7171)
```

Open `http://localhost:5173`. Add services under Settings → Services. State goes to `server/config` (git-ignored).
Use a different folder with `CONFIG_DIR=/tmp/matinee-dev npm run dev:server` to keep experiments separate.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev:server` | API with live reload |
| `npm run dev:web` | UI with hot reload |
| `npm run typecheck` | `tsc --noEmit` in both workspaces |
| `npm run build` | Builds `web/dist`, then compiles `server/dist` |
| `npm start` | Runs the compiled server (needs a build first); serves the built web app |
| `node docs/gen-api.cjs` | Regenerates `docs/API.md` from the route declarations |

The server serves `web/dist` when it exists, so `npm run build && npm start` gives you the production shape on one port.

## Working without real services

Most development does not need the real apps. The technique used throughout this project: write a tiny HTTP server
that answers the few endpoints an adapter calls, point an adapter at it, and print what it received. Example:

```js
// save as scratch/fake.mjs and run with: node scratch/fake.mjs
import http from "node:http";
import { sabnzbdAdapter } from "../server/dist/services/sabnzbd.js";   // build first

const seen = [];
const srv = http.createServer((req, res) => {
  seen.push(req.method + " " + req.url);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ status: true }));
}).listen(9999);

const sab = sabnzbdAdapter({ id: "s", kind: "sabnzbd", name: "SAB", url: "http://localhost:9999", apiKey: "k", username: "", password: "", enabled: true });
await sab.control("nzo_1", "pause");
console.log(seen);          // ["GET /api?output=json&apikey=k&mode=queue&name=pause&value=nzo_1"]
srv.close();
```

Checking the **URLs, methods and bodies** an adapter sends is exactly what catches the most common bug in this project:
a wrong endpoint name. A fake cannot prove the real service agrees, so always note unverified endpoints in
`docs/SERVICES.md` and `docs/HANDOVER.md`.

To exercise the whole app, run the server with an empty `CONFIG_DIR`, point several service entries at fake servers,
and use the UI or `curl`. Sign-in can be tested entirely with `curl` and a cookie jar:

```bash
curl -c jar -H 'Content-Type: application/json' -d '{"name":"admin","password":"longenough1"}' localhost:7171/api/auth/setup
curl -b jar localhost:7171/api/services
```

## Probing a real service safely

Prefer read-only calls (`GET`). The browser dev tools of the service's own web app are the best API documentation:
open its UI, watch the Network tab, and copy the exact requests. Several adapters were fixed this way. For services
with a single-page front end you can also fetch its JavaScript bundle and search it for `/api/` paths.

## Code style

- TypeScript strict, ES modules. Server imports use the `.js` extension (NodeNext resolution).
- Keep adapters thin: translate the service's shape into Matinee's types, nothing else.
- Comments explain *why* (a quirk, a limit) rather than *what*. Match the surrounding density.
- No new dependencies without a strong reason. The server has four runtime dependencies; the web app has React and
  React DOM. Hand-written code is preferred over a library for small jobs.
- UI text is plain and specific ("Delete 3 episode files", not "Confirm"). Destructive buttons say what they delete.
- Every destructive or outward-facing action needs a confirmation step the server also enforces.

## Building the image

```bash
docker build -t matinee .
docker run --rm -p 7171:7171 -v "$PWD/config:/config" matinee
```

The Dockerfile is multi-stage: it builds both workspaces in a Node 24 Alpine image, then copies only `server/dist`,
`web/dist` and production dependencies into a clean Alpine image that also installs `ffmpeg` and `yt-dlp`.
It runs as uid/gid `99:100` (Unraid's `nobody:users`) so files in `/config` stay editable from the host.

## Releasing

Releases are automated by `.github/workflows/release.yml`:

1. Update `CHANGELOG.md` and the version in the root `package.json`.
2. Commit, then tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The workflow builds the multi-arch image, pushes it to `ghcr.io/spacegoose02/matinee` (`:1.2.3`, `:1.2`, `:latest`),
   and creates a GitHub Release with the changelog section and a source archive.

`.github/workflows/ci.yml` runs typecheck and build on every push and pull request.

## Common tasks

| I want to... | Go to |
| --- | --- |
| Add a new service | [EXTENDING.md](EXTENDING.md) "Add a service" |
| Add an API route | [EXTENDING.md](EXTENDING.md) "Add a route" |
| Add a page or a Home shelf | [EXTENDING.md](EXTENDING.md) "Add a page" / "Add a Home section" |
| Add a theme | add an entry to `web/src/themes.ts` and a `:root[data-theme="id"]` block in `styles.css` |
| Change what the library list contains | `server/src/library.ts` and `slimItem()` in `index.ts`; bump `CACHE_VERSION` |
| Find what a button calls | search the label in `web/src/components`, then the `api.` call, then the route in `index.ts` |

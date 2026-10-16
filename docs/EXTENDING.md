<!-- brand:start -->
<p align="center"><a href="../README.md"><img src="../brand/logo.svg" alt="Matinee" height="56"></a></p>

<p align="center"><a href="../README.md">Home</a> · <a href="HANDOVER.md">Handover</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="DEVELOPMENT.md">Development</a> · <a href="EXTENDING.md">Extending</a> · <a href="FEATURES.md">Features</a> · <a href="SERVICES.md">Services</a> · <a href="API.md">API</a> · <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="OPERATIONS.md">Operations</a></p>

---
<!-- brand:end -->

# Extending Matinee

Step-by-step recipes. Each lists every file you have to touch, in order. Searching the repository for an existing
feature of the same shape (for example `mdblist` for "a new list provider", `calibreweb` for "a new read-only
service", `qbittorrent` for "a client with actions") is the fastest way to see the pattern in full.

## Add a service (a new kind of app to connect)

Example: a new service called `foo` with an API key.

1. **Declare the kind.** In `server/src/services/types.ts` add `"foo"` to the `SERVICE_KINDS` array.
2. **Write the adapter.** Create `server/src/services/foo.ts` exporting `fooAdapter(cfg: ServiceConfig): ServiceAdapter`.
   Implement `test()` (return `{ ok: true }` or throw a readable `ServiceError`) and any optional methods it supports.
   Use the helpers in `server/src/http.ts` (`getJson`, `postJson`, `putJson`, `fetchChecked`, `joinUrl`) so timeouts and
   error messages are consistent.
3. **Register it.** In `server/src/services/registry.ts` add it to `factories` and to `credentialFields`
   (`["apiKey"]`, `["username","password"]`, ...). If images from the service need auth headers, add a branch to
   `imageHeaders()`.
4. **Add new adapter methods** you need to the `ServiceAdapter` interface in `types.ts` (optional, `method?(...)`).
5. **Add routes** in `server/src/index.ts` that call the adapter (see "Add a route"). Use `targets(["foo"])` to get the
   enabled services of that kind, and `fanOut` to aggregate across several.
6. **Web labels.** In `web/src/api.ts` add the kind to the `ServiceKind` union, `KIND_LABELS` and `DEFAULT_PORTS`.
7. **Settings hint.** In `web/src/pages/Settings.tsx` add a hint for its credential fields (what to paste and where
   to find it) and, if it has a standard URL, a default in `blank()`.
8. **Colour (optional).** Add `.kind-foo { color: ... }` to `styles.css` so its chip has a colour.
9. **Document it.** Add a section to `docs/SERVICES.md` including the endpoints you call and whether each was
   verified against a real instance.

If the service contributes *library items*, return `RawItem[]` from `library()` and add its kind to `SERVER_KINDS`
(or `MANAGER_KINDS`) in `registry.ts`; the merge in `library.ts` does the rest. If it only feeds a shelf or a page
(like MDBList or Calibre-Web), it is not part of the library merge.

## Add a route

1. Decide the **access level**. If it reads secrets or paths, or changes files or settings, add its path prefix to
   `ADMIN_ANY` (all methods) or `ADMIN_WRITE` (non-GET) in `server/src/auth.ts`.
2. In `server/src/index.ts`, find the matching banner section (or add one: `// --- Name ---`) and add the route:

   ```ts
   app.post<{ Body: { key?: string } }>("/api/manage/thing", async (req) => {
     await ensureLibrary(false);
     const { arrId, adapter } = managedTitle(req.body?.key);       // resolve from the cache, not from the page
     try {
       await adapter.doThing!(arrId);
     } catch (err) {
       throw app.httpErrors.badGateway(errorMessage(err));          // upstream failures become 502 with a readable message
     }
     await refreshManagers();                                       // keep the cache honest after a write
     return { ok: true };
   });
   ```
3. Validate everything from the body or query: integers are integers, strings have a length cap, lists have a maximum
   size. Never pass a client-supplied URL or path to a service without checking it.
4. Add a typed call to `web/src/api.ts` (`api.doThing(...)`).
5. Run `node docs/gen-api.cjs` to refresh `docs/API.md`.

## Add a page

1. Create `web/src/pages/Thing.tsx` exporting `Thing`.
2. In `web/src/App.tsx` add `"thing"` to `PAGES`, render it in the `<main>` list
   (`{route.page === "thing" && <Thing arg={route.arg} />}`), and add a `link("thing", "Thing", "icon")` in the sidebar
   (`Icon` names are in `web/src/components/Icons.tsx`). Sub-pages use the single `arg` (the segment after the page name).
3. Keep list pages incremental (`useIncremental` in `web/src/hooks.ts`) so thousands of items do not block rendering.

## Add a Home section (a shelf the user can add/reorder)

Home sections are data (`HomeSection { id, kind, ref }`) stored per user.

1. Add the kind to `SectionKind` in `web/src/api.ts`.
2. In `web/src/pages/Home.tsx`: add an entry to `addOptions` (the menu), to `sectionTitle()` and to `renderSection()`.
   Return `null` when the needed service is not connected.
3. Build the shelf with `Shelf` (`components/Shelf.tsx`), `Card` (`components/Cards.tsx`) and a small component of its
   own; `components/BookShelf.tsx` and `components/Trending.tsx` are good templates.
4. Optionally add it to the default list in `Home.tsx` (new installs) and a one-time `useEffect` (existing layouts),
   guarded by a `localStorage` flag as the others are.

## Add a field to library items

1. Add it to `MediaItem` (or `ServerEntry`/`ManagedEntry`) in `server/src/services/types.ts` and the mirrored type in
   `web/src/api.ts`.
2. Fill it in the adapter's `toItem` mapping.
3. If the merge must combine it, update `absorb()` in `server/src/library.ts`.
4. If it should appear in the *list* payload, make sure `slimItem()` in `index.ts` does not drop it; if it is large,
   keep it out of the list and read it from `/api/item`.
5. **Bump `CACHE_VERSION`** in `index.ts` so old caches are discarded.

## Add a collection operation

Everything that writes collections goes through `ensureCollections()` in `server/src/collections.ts`
(`EnsureOp` in, `OpResult` out, with `dryRun`). Add new behaviour there so previews and real runs share one code path,
then expose it through `/api/collections/run`.

## Add a theme

Add `{ id, name, group, blurb, swatch }` to `web/src/themes.ts` and a `:root[data-theme="id"] { ... }` block to
`web/src/styles.css` that sets the colour tokens (copy an existing one). Retro themes may add component overrides below.

## Checklist before you merge

- [ ] `npm run typecheck` and `npm run build` pass.
- [ ] New route has an access level in `auth.ts` and appears in `docs/API.md`.
- [ ] Destructive actions have a confirmation in the UI **and** a server-side check.
- [ ] Anything sent to a third-party API is noted in `docs/SERVICES.md` with its verification status.
- [ ] `CACHE_VERSION` bumped if the raw item shape changed.
- [ ] `CHANGELOG.md` updated.

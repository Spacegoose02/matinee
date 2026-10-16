# Contributing

Thanks for helping. Start with [docs/HANDOVER.md](docs/HANDOVER.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Workflow

1. Fork and branch from `main`.
2. `npm install`, then `npm run dev:server` and `npm run dev:web`.
3. Make a focused change. Follow the recipes in [docs/EXTENDING.md](docs/EXTENDING.md).
4. `npm run typecheck && npm run build` must pass. If you added a route, run `node docs/gen-api.cjs`.
5. Update `CHANGELOG.md` (under *Unreleased*) and any affected document in `docs/`.
6. Open a pull request describing what changed and how you verified it. Say which external calls you could not
   check against a real service.

## Rules of thumb

- Radarr/Sonarr/Plex/Jellyfin do the file work; Matinee asks them to. Do not add code that moves or deletes files itself.
- Destructive actions need a UI confirmation and a server-side check.
- Keep personal data out of the repository: no real hostnames, IP addresses, API keys, usernames or screenshots of your
  own setup. Use `192.168.1.10`, `example.com` and similar in examples.
- Prefer small, additive changes to the shared types in `server/src/services/types.ts`.
- Match the existing style; comments explain why, not what.

By contributing you agree your work is released under the [MIT license](LICENSE).

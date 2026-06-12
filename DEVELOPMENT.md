# BlueNote Distribution Development

## Expected sibling checkout layout

```text
../bluenote-core
../bluenote-term
../bluenote-webui
../bluenote
```

The parent folder may also contain local `.agent/*` workflow memory. If the parent is not a git repo, that memory is not versioned; this repo carries the versioned cross-repo guidance.

## Local dependency strategy

`@lordierclaw/bluenote` depends directly on core for daemon-side behavior. Optional clients are installed separately and discovered through public executables on `PATH`:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "git+https://github.com/LordierClaw/bluenote-core.git#<pinned-commit-sha>"
  }
}
```

End-user optional clients are independent global packages exposing `bluenote-webui` and `bluenote-term` executables. End users normally install the app entrypoint first and then add clients:

```sh
npm install -g @lordierclaw/bluenote
npm install -g bluenote-webui   # optional browser UI
npm install -g bluenote-term    # optional terminal UI; requires Bun
bluenote doctor
```

`@lordierclaw/bluenote-core` is a library dependency, not a user-facing command package. Install it directly only for library development or when manually wiring local source checkouts.

When publishing or testing reproducible releases, prefer published npm versions or pinned immutable Git tags/commits over moving branches. Do not use branch dependencies such as `#main` for release-like dependency modes.

## Build/check and local install order

For cross-repo changes, verify and link from the dependency leaf outward:

1. `bluenote-core`: `npm run check`
2. `bluenote-term`: `bun run check`
3. `bluenote-webui`: `npm run check`
4. `bluenote`: `npm run check`

For a manual source install that behaves like the app, build/check core first, link the optional clients you want on `PATH`, then link the distribution CLI last:

```sh
cd ../bluenote-core
npm ci --include=dev
npm run check

cd ../bluenote-webui
npm ci --include=dev
npm run check
npm link

cd ../bluenote-term
bun install
bun run check
bun link

cd ../bluenote
npm ci --include=dev
npm run check
npm link

bluenote doctor
```

For docs-only changes, use `git status` plus basic file inspection unless package files or code changed. When documentation describes the CLI contract, also run the relevant help/smoke commands when practical.

## Distribution package scripts

```sh
npm install
npm run clean
npm run typecheck
npm run test
npm run build
npm run check
```

`npm run test` builds `dist/` first and runs the Node-based CLI contract tests. `npm run check` runs typecheck, tests, and a final build.

## Implemented command surface

- `bluenote --help`: top-level help for `tui`, `web`, `daemon`, `doctor`, and `version`; no heavy client imports.
- `bluenote version`: distribution version plus required runtime package metadata; no heavy client imports.
- `bluenote doctor`: platform, Node compatibility, daemon status, optional `bluenote-webui`/`bluenote-term` PATH discovery, and Bun availability; no secrets or workspace mutation.
- `bluenote daemon start|status|stop`: minimal local-only HTTP daemon lifecycle with `/health` and `/capabilities`; tokens are stored in daemon metadata but never printed.
- `bluenote web [...args]`: requires daemon metadata, discovers the public `bluenote-webui` executable on PATH, and launches it with `BLUENOTE_DAEMON_URL` / `BLUENOTE_DAEMON_TOKEN` in the child environment.
- `bluenote tui [...args]`: requires daemon metadata, discovers the public `bluenote-term` executable on PATH, and launches it with `BLUENOTE_DAEMON_URL` / `BLUENOTE_DAEMON_TOKEN` in the child environment.
- `bn`: alias for the same distribution binary.

## Choosing the correct repo for a feature

- Note model, storage, search, AI, and core API semantics -> `bluenote-core`.
- Terminal layout, keybindings, OpenTUI behavior, terminal command API -> `bluenote-term`.
- Browser UI, local web server/proxy, setup flow -> `bluenote-webui`.
- Top-level command routing, help, version, doctor, minimal local daemon lifecycle, PATH client discovery/launch, binary packaging -> `bluenote`.
- Expanded daemon/runtime/sync protocol beyond local health/capabilities -> design cross-repo first; protocol/core first; clients later.

## Runtime compatibility matrix

| Repo | Runtime |
|---|---|
| `bluenote-core` | Node `>=16.14 <17 || >=18`, npm |
| `bluenote-term` | Bun/OpenTUI allowed; newer Node allowed when required |
| `bluenote-webui` | Node `>=16.14 <17 || >=18`, npm |
| `bluenote` | Node `>=16.14 <17 || >=18`; lazy-load/spawn heavy clients only for their commands |

## Never import internal paths

Across repos, import only public package exports or use public package bins. Forbidden examples:

```ts
import "@lordierclaw/bluenote-core/src/..."
import "../bluenote-core/src/..."
import "../bluenote-term/packages/term/src/..."
import "../bluenote-webui/src/..."
```

If a client or distribution command needs new behavior, add a public API in the owning repo first, with tests and docs there.

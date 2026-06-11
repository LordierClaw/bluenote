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

`@lordierclaw/bluenote` composes the sibling packages through public package APIs/bins only:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core",
    "bluenote-term": "file:../bluenote-term/packages/term",
    "bluenote-webui": "file:../bluenote-webui"
  }
}
```

When publishing or testing reproducible releases, prefer published npm versions or pinned immutable Git tags/commits over moving branches. Do not use branch dependencies such as `#main` for release-like dependency modes.

## Build/check order

For cross-repo changes, verify from the dependency leaf outward:

1. `bluenote-core`: `npm run check`
2. `bluenote-term`: `bun run check`
3. `bluenote-webui`: `npm run check`
4. `bluenote`: `npm run check`

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
- `bluenote version`: distribution version plus best-effort sibling package metadata; no heavy client imports.
- `bluenote doctor`: platform, Node compatibility, package resolution, and Bun availability; no secrets or workspace mutation.
- `bluenote tui [...args]`: resolves the public `bluenote-term` package bin and spawns it through Bun as `bun <bin> tui [...args]`. If Bun or the public package is unavailable, it prints an actionable runtime error.
- `bluenote web [...args]`: lazy dynamic import of the public `bluenote-webui` command API.
- `bluenote daemon start|status|stop`: scaffold-only future local daemon command; no sync/runtime daemon is implemented.
- `bn`: alias for the same distribution binary.

## Choosing the correct repo for a feature

- Note model, storage, search, AI, and core API semantics -> `bluenote-core`.
- Terminal layout, keybindings, OpenTUI behavior, terminal command API -> `bluenote-term`.
- Browser UI, local web server/proxy, setup flow -> `bluenote-webui`.
- Top-level command routing, help, version, doctor, daemon scaffold, binary packaging -> `bluenote`.
- Real daemon/runtime/sync protocol -> design cross-repo first; protocol/core first; clients later.

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

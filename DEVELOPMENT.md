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

During local multi-repo development, use local file dependencies where practical:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core",
    "bluenote-term": "file:../bluenote-term/packages/term",
    "bluenote-webui": "file:../bluenote-webui"
  }
}
```

When publishing or testing reproducible releases, prefer published npm versions or pinned immutable Git tags/commits over moving branches.

## Build/check order

For cross-repo changes, verify from the dependency leaf outward:

1. `bluenote-core`: `npm run check`
2. `bluenote-term`: `bun run check`
3. `bluenote-webui`: `npm run check`
4. `bluenote`: distribution checks when package scripts exist

For docs-only changes, use `git status` plus basic file inspection unless package files or code changed.

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
| `bluenote` | Node 16.14-compatible; lazy-load heavy clients |

## Never import internal paths

Across repos, import only public package exports. Forbidden examples:

```ts
import "@lordierclaw/bluenote-core/src/..."
import "../bluenote-core/src/..."
import "../bluenote-term/packages/term/src/..."
```

If a client or distribution command needs new behavior, add a public API in the owning repo first, with tests and docs there.

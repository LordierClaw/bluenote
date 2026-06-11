# BlueNote Distribution CLI

`bluenote` is the official BlueNote distribution package and top-level command router. It keeps the distribution binary thin: product behavior lives in the owning client or core packages.

## Requirements

- Node.js `>=16.14`
- npm for local checks

## Commands

```sh
bluenote --help
bluenote version
bluenote doctor
bluenote tui
bluenote web
bluenote daemon --help
```

Current command surface:

- `bluenote --help` prints top-level help for `tui`, `web`, `daemon`, `doctor`, and `version`.
- `bluenote version` prints this distribution package version.
- `bluenote doctor` reports the current Node version, the package baseline, and whether the runtime is supported. It does not inspect workspaces or product storage.
- `bluenote tui` lazy-loads the public `bluenote-term` package and expects `runTuiCommand` or `runCommand`.
- `bluenote web` lazy-loads the public `bluenote-webui` package and expects `runWebCommand` or `runCommand`.
- `bluenote daemon --help` shows scaffold help. `bluenote daemon` is reserved and exits nonzero because daemon/runtime/sync protocol work is not implemented.

If a lazy-loaded client package is not installed or does not expose the expected public command API, the CLI prints an actionable error instead of importing internal sibling paths.

## Development checks

```sh
npm test
npm run check
```

See `DEVELOPMENT.md` for cross-repo ownership, dependency strategy, and compatibility guidance.

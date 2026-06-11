# BlueNote Distribution CLI

`@lordierclaw/bluenote` is the official BlueNote distribution package and top-level command router. It keeps the binary thin: core note behavior stays in `@lordierclaw/bluenote-core`, the terminal UI stays in `bluenote-term`, and the local browser UI stays in `bluenote-webui`.

## Requirements

- Node.js `>=16.14 <17 || >=18` for distribution commands.
- npm 8-compatible local development.
- Optional UI clients are discovered as executables on `PATH`: `bluenote-webui` and `bluenote-term`.
- Bun is required by the terminal client package, but not by lightweight distribution commands.

## End-user install model

Install the distribution CLI and whichever optional clients you want as independent global packages:

```sh
npm install -g @lordierclaw/bluenote
npm install -g bluenote-webui
npm install -g bluenote-term
```

The distribution CLI does not bundle WebUI/TUI. `bluenote doctor` reports whether optional client executables are present on `PATH`.

## Commands

```sh
bluenote --help
bluenote version
bluenote doctor
bluenote tui [...args]
bluenote web [...args]
bluenote daemon start
bluenote daemon status
bluenote daemon stop
```

`bn` is exposed as the same binary alias as `bluenote`.

Current command surface:

- `bluenote --help` prints top-level help without importing terminal or web clients.
- `bluenote version` prints the distribution package version and best-effort sibling package versions from package metadata only.
- `bluenote doctor` checks platform, Node compatibility, daemon state, optional client executables, and Bun availability for the TUI. It reports token presence without printing token values.
- `bluenote daemon <start|status|stop>` manages a minimal local-only daemon with HTTP `/health` and `/capabilities` endpoints.
- `bluenote web` launches the `bluenote-webui` executable found on `PATH` only when daemon metadata exists, passing daemon connection details through environment variables without printing tokens.
- `bluenote tui` launches the `bluenote-term` executable found on `PATH` only when daemon metadata exists, passing daemon connection details through environment variables without printing tokens.

## Local sibling checkout

Expected local development layout:

```text
../bluenote-core
../bluenote-term
../bluenote-webui
../bluenote
```

Local file dependencies are used for multi-repo development only, not as the end-user install path:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core",
    "bluenote-term": "file:../bluenote-term/packages/term",
    "bluenote-webui": "file:../bluenote-webui"
  }
}
```

For release-like dependency modes, prefer published npm versions or pinned immutable Git tags/commits. Do not use moving branch dependencies such as `#main` for release-like installs.

## Development checks

```sh
npm install
npm run typecheck
npm run test
npm run build
npm run check
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
```

Baseline CI runs on Node 16.14 and intentionally does not require Bun for basic `--help`, `version`, or `doctor` smoke commands.

## Ownership boundaries

- Core note model, storage layout, search semantics, and AI behavior: `bluenote-core`.
- Terminal layout, keybindings, OpenTUI behavior, and TUI command API: `bluenote-term`.
- Browser UI, localhost server/proxy, and web setup flow: `bluenote-webui`.
- Top-level routing, help, version, doctor, minimal local daemon lifecycle, PATH client discovery/launch, and distribution packaging: `bluenote`.

Cross-repo imports must use public package exports or public package bins only. Do not import sibling `src/*`, `dist/*`, tests, or hidden internals from this repo.

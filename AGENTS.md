# bluenote Agent Guide

## Role

`bluenote` is the official distribution CLI / multi-command binary repo.

## Owns

- top-level command routing
- `bluenote --help` and command help
- `bluenote version`
- `bluenote doctor`
- minimal local `bluenote daemon` lifecycle and distribution-facing daemon command surface
- optional client PATH discovery and daemon-context launch
- binary packaging and distribution docs

## Does not own

- core note model, storage layout, search semantics, or AI semantics
- terminal/TUI/OpenTUI implementation
- browser UI implementation or web layout
- expanded daemon/runtime/sync protocol beyond local health/capabilities without cross-repo design first

## Runtime compatibility

Must remain Node `>=16.14 <17 || >=18` compatible. Lazy-load or spawn heavy/runtime-specific clients so `--help`, `version`, and `doctor` run in restricted Node 16.14 environments without Bun/OpenTUI imports.

## Public API/export rules

- Consume `@lordierclaw/bluenote-core`, `bluenote-term`, and `bluenote-webui` through public package exports or public package bins only.
- Do not import sibling `src/*`, `dist/*`, tests, or hidden internals.
- If a needed command API does not exist, add it in the owning repo first.
- Current direct dependency name:
  - `@lordierclaw/bluenote-core`: pinned release dependency, currently a GitHub commit dependency until npm package publication is available
- Optional clients are independent global packages discovered through `bluenote-webui` and `bluenote-term` executables on `PATH`.

## Dependency rules

- May orchestrate clients, but must not copy their implementations.
- Must not contain core business logic.
- Keep command boundaries thin and explicit.
- `bluenote tui` may spawn the public `bluenote-term` bin through Bun; it must not import OpenTUI internals.
- `bluenote web` may lazy-load the public `bluenote-webui` command API.

## Read first

1. Parent `.agent/CURRENT_TASK.md` when working from the parent workspace.
2. Parent `AGENTS.md`.
3. This file.
4. `DEVELOPMENT.md`.
5. `docs/repo-ownership.md`, `docs/runtime-compatibility.md`, and `docs/agent-workflow.md` when present.

Older sibling phase docs are historical unless the active task references them.

## Common tasks

- Add/adjust official top-level command: edit this repo, then add public APIs in client/core repos only if needed.
- Add core behavior: edit `bluenote-core`.
- Add terminal behavior: edit `bluenote-term`.
- Add browser UI behavior: edit `bluenote-webui`.
- Add expanded daemon/runtime/sync behavior beyond local health/capabilities: stop and design cross-repo first.

## Checks

- Runtime changes: `npm install`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run check`, and smoke `node dist/bin.js --help`, `node dist/bin.js version`, `node dist/bin.js doctor`.
- Docs-only: `git status` plus file inspection; run CLI help/smoke when docs describe command behavior.

## Documentation update rule

Update `README.md`, `DEVELOPMENT.md`, and `docs/*` when command ownership, runtime compatibility, dependency strategy, public APIs, or workflow changes. Keep cross-repo docs concise.

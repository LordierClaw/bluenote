# bluenote Agent Guide

## Role

`bluenote` is the official distribution CLI / multi-command binary repo.

## Owns

- top-level command routing
- `bluenote --help` and command help
- `bluenote version`
- `bluenote doctor`
- `bluenote daemon` scaffold and distribution-facing daemon command surface
- binary packaging and distribution docs

## Does not own

- core note model, storage layout, search semantics, or AI semantics
- terminal/TUI/OpenTUI implementation
- browser UI implementation or web layout
- real daemon/runtime/sync protocol without cross-repo design first

## Runtime compatibility

Must remain Node 16.14-compatible. Lazy-load heavy or runtime-specific clients so basic commands can run in restricted environments.

## Public API/export rules

- Consume `@lordierclaw/bluenote-core`, `bluenote-term`, and `bluenote-webui` through public package exports only.
- Do not import sibling `src/*`, `dist/*`, tests, or hidden internals.
- If a needed command API does not exist, add it in the owning repo first.

## Dependency rules

- May orchestrate clients, but must not copy their implementations.
- Must not contain core business logic.
- Keep command boundaries thin and explicit.

## Read first

1. Parent `.agent/CURRENT_TASK.md` when working from the parent workspace.
2. Parent `AGENTS.md`.
3. This file.
4. `DEVELOPMENT.md`.
5. `docs/repo-ownership.md`, `docs/runtime-compatibility.md`, and `docs/agent-workflow.md`.

Older sibling phase docs are historical unless the active task references them.

## Common tasks

- Add/adjust official top-level command: edit this repo, then add public APIs in client/core repos only if needed.
- Add core behavior: edit `bluenote-core`.
- Add terminal behavior: edit `bluenote-term`.
- Add browser UI behavior: edit `bluenote-webui`.

## Checks

- Docs-only: `git status` plus file inspection.
- Runtime changes: run this repo's checks when package scripts exist and any affected sibling checks required by changed APIs.

## Documentation update rule

Update `DEVELOPMENT.md` and `docs/*` when command ownership, runtime compatibility, dependency strategy, or workflow changes. Keep cross-repo docs concise.

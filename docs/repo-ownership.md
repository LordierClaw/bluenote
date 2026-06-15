# BlueNote Repo Ownership

## Repositories

- `bluenote-core`: headless engine/library.
- `bluenote-term`: terminal/TUI client.
- `bluenote-webui`: local browser UI client.
- `bluenote`: official distribution CLI/orchestrator.

## Feature ownership

| Feature area | Owning repo |
|---|---|
| note model, storage layout, sidecar metadata | `bluenote-core` |
| search semantics and indexing | `bluenote-core` |
| AI config, prompts, queue, provider semantics | `bluenote-core` |
| terminal layout, keybindings, OpenTUI behavior | `bluenote-term` |
| browser UI, local web server/proxy, setup flow | `bluenote-webui` |
| top-level command routing/help/version/doctor/binary packaging | `bluenote` |
| real daemon/runtime/sync protocol | design cross-repo first; protocol/core first; clients later |

## Boundary rules

- Core does not import clients or distribution code.
- Clients consume core public APIs and do not duplicate core semantics.
- Distribution orchestrates commands and lazy-loads clients.
- Cross-repo imports must use public package exports, never internals.

## Install roles

- `@lordierclaw/bluenote` is the user-facing app entrypoint. It provides `bluenote` and `bn`.
- `@lordierclaw/bluenote-core` is a library dependency. End users normally do not install it globally.
- `bluenote-webui` and `bluenote-term` are optional client packages installed separately so their public executables are on `PATH`.
- Cross-repo verification order is dependency-first: `bluenote-core`, optional clients (`bluenote-webui`, `bluenote-term`), then `bluenote` last.
- Manual source-link install order for app-like local use is distribution first, then optional clients, so `bluenote doctor` can verify each client executable as it is linked.

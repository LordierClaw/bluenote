# BlueNote Daemon API Migration Design

## Status

Approved direction from the user on 2026-06-12: prioritize the heavier daemon API migration now so the project does not grow around direct client/core access that becomes hard to unwind later.

## Goal

Make the BlueNote daemon the normal local runtime/API boundary for terminal and web clients while preserving current local-first storage, plain Markdown note files, search behavior, and opt-in AI semantics.

## Problem

The current installable distribution branch established:

- `bluenote` as distribution CLI and daemon lifecycle owner,
- optional `bluenote-term` and `bluenote-webui` executable discovery,
- daemon token/endpoint handoff,
- doctor/client checks.

But the daemon currently exposes only lifecycle endpoints:

- `GET /health`
- `GET /capabilities`
- `POST /shutdown`

`bluenote-term` still calls `bluenote-core` directly for CLI/TUI operations. `bluenote-webui` already exposes a useful `/api/*` surface, but that API is owned by the WebUI server and calls core directly. If those direct paths keep growing, a later daemon migration becomes riskier and more expensive.

## Architecture

Adopt daemon-owned local API as the normal user path:

```text
bluenote-term CLI  ┐
bluenote-term TUI  ├── daemon API client ──> bluenote daemon HTTP API ──> bluenote-core
bluenote-webui     ┘
```

Repository responsibilities:

- `bluenote-core`: shared domain/storage/search/AI semantics plus runtime-light daemon API contract/types and optional fetch client/helpers. No daemon process, no HTTP server, no UI dependencies.
- `bluenote`: daemon lifecycle, local HTTP server, auth, route registration, distribution command routing, doctor/help/version.
- `bluenote-term`: terminal CLI/TUI UX and adapters that consume daemon API in normal user paths.
- `bluenote-webui`: browser UI and local static/proxy server; normal `/api/*` traffic proxies to daemon instead of owning core storage behavior.

## API contract baseline

Start from WebUI's existing API shape because it already covers most browser and future TUI needs.

### Lifecycle

```text
GET  /health
GET  /capabilities
POST /shutdown
```

### Workspace

```text
GET  /api/workspace
GET  /api/workspace/status
POST /api/workspace/open
POST /api/workspace/init
```

### Folders and notes

```text
GET   /api/folders
POST  /api/folders
PATCH /api/folders/rename
GET   /api/notes/startup
GET   /api/notes?folder=&query=
GET   /api/notes/:id
POST  /api/notes
PATCH /api/notes/:id
DELETE /api/notes/:id
POST  /api/notes/:id/archive
POST  /api/notes/:id/move
POST  /api/notes/:id/promote
POST  /api/rebuild
```

### AI

```text
GET  /api/ai/status
GET  /api/ai/config
POST /api/ai/config
GET  /api/ai/queue
POST /api/ai/describe
POST /api/ai/process-queue
```

## Shared types

Move or mirror current WebUI shared API types into a public runtime-light contract, preferably in `bluenote-core`:

- `ApiErrorBody`
- `WorkspaceStatus`
- `FolderView`
- `NoteSummaryView`
- `NoteDetailView`
- `SearchResultView`
- `CreateNoteRequest`
- `UpdateNoteRequest`
- `AiStatusSummary`
- `AiConfigView`
- `AiQueueView`
- `AiDescribeRequest`
- `AiProcessQueueRequest`
- `AiProcessQueueResult`

The contract module must not import client code, OpenTUI, Vite, React, or daemon process code.

## Daemon auth and security

- `/health` may remain unauthenticated.
- Every other endpoint requires `Authorization: Bearer <token>`.
- Daemon token stays in daemon metadata/config and environment handoff; never pass it through argv.
- `doctor`, CLI errors, WebUI logs, and TUI status must redact token-like values and configured AI secrets.
- WebUI browser code must not receive the daemon token. WebUI's local server should proxy `/api/*` to daemon with the token server-side.

## Error model

Use a stable JSON error shape:

```ts
interface ApiErrorBody {
  error: {
    code: string
    message: string
    hint?: string
  }
}
```

Suggested mapping:

- `400`: invalid request/validation/usage errors
- `401`: missing or invalid daemon token
- `404`: missing note/folder/workspace route resource
- `409`: workspace not open/conflict/stale mutation
- `500`: unexpected daemon error with safe message only

## Client migration policy

Normal installed/user paths should use daemon API. Direct core access may temporarily remain only as an explicit development/testing fallback while migration is in progress.

Recommended rule after migration:

> New user-facing terminal or web behavior is implemented as core capability → daemon API → client adapter → CLI/TUI/WebUI surface.

## Term CLI migration

`bluenote` should eventually expose term-owned note commands by spawning `bluenote-term` with daemon environment:

```text
bluenote init
bluenote new ...
bluenote list
bluenote show ...
bluenote search ...
bluenote edit ...
bluenote archive ...
bluenote delete ...
bluenote rebuild
bluenote ai ...
```

`bluenote-term` implements these commands by calling daemon API. It must not duplicate distribution daemon lifecycle logic.

## Term TUI migration

Introduce a TUI data provider boundary. Migrate in order:

1. read-only startup/list/show/search,
2. create/update/save/delete/archive/move/promote/rebuild,
3. latest-opened/startup state,
4. AI status/queue/process/auth/config.

TUI save/autosave requires real file-mutation verification through daemon API, not just controller mocks.

## WebUI migration

WebUI normal installed mode becomes static server + daemon proxy:

```text
browser -> bluenote-webui local server -> bluenote daemon -> core
```

The browser keeps using `/api/*`; the WebUI server proxies to daemon with server-side token. Direct core-backed WebUI services become development-only or are removed after migration.

## Compatibility

- `bluenote`, `bluenote-core`, and `bluenote-webui` remain Node `>=16.14 <17 || >=18` compatible.
- `bluenote-term` may continue using Bun/OpenTUI/newer Node.
- Distribution help/version/doctor and daemon lifecycle must not import heavy terminal/web modules.

## Risks and mitigations

### TUI persistence and autosave

Risk: daemon adapter tests pass but real TUI input/save does not mutate files.

Mitigation: include PTY/manual verification that types through the actual TUI path, saves/autosaves through daemon, and verifies Markdown file content changed.

### AI queue concurrency

Risk: moving queue processing behind daemon changes non-blocking behavior or stale-result safety.

Mitigation: preserve current queue semantics, setup-blocker behavior, token redaction, stale result guards, and background status tests.

### WebUI token exposure

Risk: browser JS receives daemon bearer token.

Mitigation: WebUI server proxies API; token stays server-side only.

### Migration size

Risk: one giant PR becomes unreviewable.

Mitigation: sequence into BN-DAEMON-001..006 with independent tests and commits.

## Proposed phases

1. BN-DAEMON-001: shared contract and authenticated daemon route scaffold.
2. BN-DAEMON-002: daemon workspace/note/folder/search/rebuild APIs.
3. BN-DAEMON-003: term CLI daemon adapter and distribution note-command routing.
4. BN-DAEMON-004: term TUI daemon data provider.
5. BN-DAEMON-005: WebUI proxy-to-daemon mode.
6. BN-DAEMON-006: guardrails removing normal-path direct client/core access.

# BlueNote Daemon API Migration Implementation Plan

> **For implementer:** Use TDD throughout. Write failing tests first, confirm they fail, implement the smallest change, run the focused test and the repo gate, then commit per repo.

**Goal:** Move BlueNote toward a daemon-owned local API boundary consumed by `bluenote-term` CLI/TUI and `bluenote-webui`, while preserving existing storage/search/AI behavior.

**Architecture:** `bluenote-core` provides runtime-light API contract/types and pure app services; `bluenote` owns daemon HTTP/auth/lifecycle; `bluenote-term` and `bluenote-webui` consume daemon APIs in normal user paths. Direct client/core access is kept only as explicit temporary dev fallback during migration.

**Tech Stack:** TypeScript, Node 16.14-compatible distribution/core/webui, Bun/OpenTUI for terminal client, localhost HTTP daemon, bearer-token auth, npm/Bun checks.

---

## Source-of-truth docs

Implementers must read before coding:

- Parent `AGENTS.md`
- Parent `.agent/CURRENT_TASK.md`
- `bluenote/AGENTS.md`
- `bluenote/docs/repo-ownership.md`
- `bluenote/docs/runtime-compatibility.md`
- `bluenote/docs/plans/2026-06-12-daemon-api-migration-design.md`
- Target repo `AGENTS.md` files if present

Historical installable distribution plans are context only; this plan supersedes them for daemon API migration sequencing.

## Global invariants

- Do not change note file format.
- Do not change storage layout.
- Do not change search semantics.
- Do not change AI provider/queue semantics except moving access behind daemon APIs.
- Do not import sibling `src/*` or `dist/*` across repos.
- Do not make `bluenote-core` depend on `bluenote`, `bluenote-term`, or `bluenote-webui`.
- Do not leak daemon token or AI/API secrets in argv, logs, errors, doctor output, or browser JS.
- Keep `bluenote`, `bluenote-core`, and `bluenote-webui` Node 16.14-compatible.
- Keep `bluenote --help`, `version`, `doctor`, and daemon lifecycle free of Bun/OpenTUI imports.

---

## BN-DAEMON-001: Shared API contract and daemon route scaffold

**Repos:** `bluenote-core`, `bluenote`

**Goal:** Add a shared daemon API contract and expand daemon routing/auth infrastructure without adding full note behavior yet.

### Task 1.1 — Add daemon contract types

**Files:**
- Create: `bluenote-core/src/api/daemon-contract.ts`
- Modify: `bluenote-core/src/index.ts` or existing public barrel
- Test: `bluenote-core/tests/daemon-contract.test.ts`

**RED:** Add tests asserting exported contract helper constants/types are importable from the public package entrypoint and do not require client packages.

**Implementation:** Define shared API types copied/adapted from current WebUI shared types:

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
- request/result types for AI commands
- API version/capabilities constants

**Verify:**

```bash
cd bluenote-core
npm run check
```

**Commit:** `feat: add daemon api contract`

### Task 1.2 — Add authenticated daemon router primitives

**Files:**
- Modify: `bluenote/src/daemon/server.ts`
- Create: `bluenote/src/daemon/router.ts`
- Test: `bluenote/tests/run-tests.js`

**RED:** Add tests for:

- `/health` is public.
- `/capabilities` requires token.
- unknown `/api/*` returns JSON error shape.
- unauthorized route returns 401 JSON error shape.

**Implementation:** Extract small router helpers:

- JSON response writer
- request body reader with size limit
- bearer auth guard
- route registration for method/path
- safe error conversion to `ApiErrorBody`

**Verify:**

```bash
cd bluenote
npm run check
npx -y node@16.14.0 dist/bin.js daemon status
```

**Commit:** `feat: add daemon api router scaffold`

### Task 1.3 — Capabilities advertise daemon API readiness

**Files:**
- Modify: `bluenote/src/daemon/server.ts`
- Test: `bluenote/tests/run-tests.js`

**RED:** Extend capabilities test to expect API version and initially scaffolded groups:

```json
{
  "workspaceApi": true,
  "notesApi": false,
  "aiApi": false
}
```

**Implementation:** Update `/capabilities` to include versioned API capability flags without claiming unimplemented endpoints.

**Verify:** `cd bluenote && npm run check`

**Commit:** `feat: advertise daemon api capabilities`

---

## BN-DAEMON-002: Workspace, notes, folders, search, and rebuild APIs

**Repos:** `bluenote-core`, `bluenote`

**Goal:** Move the WebUI-equivalent core app service surface behind the daemon.

### Task 2.1 — Add runtime-light workspace app service

**Files:**
- Create: `bluenote-core/src/app/workspace-service.ts`
- Modify: core public exports
- Test: `bluenote-core/tests/workspace-service.test.ts`

**RED:** Test temp-root cases:

- status with no selected workspace equivalent/default root
- init root creates managed root
- open rejects missing path
- hidden `.data`/`.state` path is rejected

**Implementation:** Extract/adapt logic from WebUI `workspace-service.ts` into core without HTTP dependencies.

**Verify:** `cd bluenote-core && npm run check`

**Commit:** `feat: add workspace app service`

### Task 2.2 — Add runtime-light note/folder app service

**Files:**
- Create: `bluenote-core/src/app/note-service.ts`
- Modify: core public exports
- Test: `bluenote-core/tests/note-service.test.ts`

**RED:** Cover existing WebUI API behavior against temp roots:

- list folders
- create folder
- create draft/normal note
- list notes by folder/query
- get note detail
- update body/title
- archive/delete/move/promote
- rebuild

**Implementation:** Reuse existing core public APIs only. Preserve plain Markdown and sidecar behavior.

**Verify:** `cd bluenote-core && npm run check`

**Commit:** `feat: add note app service`

### Task 2.3 — Register workspace/note daemon routes

**Files:**
- Modify: `bluenote/src/daemon/server.ts`
- Create: `bluenote/src/daemon/routes/workspace.ts`
- Create: `bluenote/src/daemon/routes/notes.ts`
- Test: `bluenote/tests/run-tests.js`

**RED:** Add integration tests that start daemon server with temp state/root env and call:

- `GET /api/workspace/status`
- `POST /api/workspace/init`
- `POST /api/notes`
- `GET /api/notes`
- `GET /api/notes/:id`
- `PATCH /api/notes/:id`
- `POST /api/rebuild`

Tests must prove token auth required and response shape matches contract.

**Implementation:** Wire daemon routes to core app services.

**Verify:**

```bash
cd bluenote
npm run check
npx -y node@16.14.0 dist/bin.js --help
```

**Commit:** `feat: serve workspace and note daemon apis`

### Task 2.4 — Add daemon fetch client

**Files:**
- Create: `bluenote-core/src/api/daemon-client.ts`
- Modify: core public exports
- Test: `bluenote-core/tests/daemon-client.test.ts`

**RED:** Mock fetch tests for:

- bearer auth header
- JSON request/response
- error body mapping
- no token included in thrown messages

**Implementation:** Browser/Node-compatible fetch client around the shared contract.

**Verify:** `cd bluenote-core && npm run check`

**Commit:** `feat: add daemon fetch client`

---

## BN-DAEMON-003: Terminal CLI daemon adapter and distribution command routing

**Repos:** `bluenote-term`, `bluenote`

**Goal:** Make terminal CLI commands use daemon API in normal distribution mode, then expose those commands through `bluenote`.

### Task 3.1 — Add term daemon CLI adapter

**Files:**
- Create: `bluenote-term/packages/term/src/cli/daemon-entry.ts`
- Modify: `bluenote-term/packages/term/src/command.ts`
- Test: `bluenote-term/tests/unit/command-api.test.ts`

**RED:** Tests prove when `BLUENOTE_DAEMON_URL` is present:

- `list` calls daemon client, not direct core runner
- daemon errors map to CLI result
- token is not printed
- missing daemon URL gives actionable error for normal user path

**Implementation:** Use core daemon fetch client and preserve CLI output formatting as much as possible.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `feat: add daemon-backed terminal cli adapter`

### Task 3.2 — Migrate simple read CLI commands

**Files:**
- Modify: terminal daemon adapter/tests
- Test: terminal CLI tests

**RED:** Add tests for daemon-backed:

- `list`
- `show`
- `search`
- `rebuild`

**Implementation:** Translate daemon responses to existing CLI output.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `feat: route read cli commands through daemon`

### Task 3.3 — Migrate write CLI commands

**Files:**
- Modify: terminal daemon adapter/tests

**RED:** Add tests for daemon-backed:

- `init`
- `new`
- `edit` behavior decision: external editor still runs client-side, but final file mutation must go through daemon `PATCH /api/notes/:id`
- `archive`
- `delete`

**Implementation:** Keep editor process/clipboard terminal-owned, but mutations go through daemon API.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `feat: route write cli commands through daemon`

### Task 3.4 — Expose term CLI commands through distribution

**Files:**
- Modify: `bluenote/src/cli.ts`
- Modify: `bluenote/src/commands/help.ts`
- Create/modify: `bluenote/src/commands/term.ts`
- Test: `bluenote/tests/run-tests.js`

**RED:** Distribution tests prove:

- `bluenote --help` lists term CLI commands in a separate section.
- `bluenote list` spawns `bluenote-term list` with daemon env.
- `bluenote term list` pass-through works.
- missing daemon gives `bluenote daemon start` guidance.
- missing `bluenote-term` gives install guidance.

**Implementation:** Command registry for term-owned commands:

```text
init,new,list,show,search,edit,archive,delete,rebuild,ai
```

**Verify:**

```bash
cd bluenote
npm run check
npx -y node@16.14.0 dist/bin.js --help
```

**Commit:** `feat: expose terminal cli commands through distribution`

### Task 3.5 — Clean temp-prefix CLI verification

**Files:** local-only `.agent/STATUS.md` update; no committed manual logs.

**Verify:** Install distribution and term into temp prefix, then run:

```bash
bluenote daemon start
bluenote init
bluenote new "hello"
bluenote list
bluenote search hello
bluenote show <selector>
bluenote daemon stop
```

Record only summarized results in parent `.agent/STATUS.md`.

---

## BN-DAEMON-004: Terminal TUI daemon data provider

**Repos:** `bluenote-term`, possibly `bluenote-core` for missing contract/client helpers

**Goal:** Replace normal TUI direct core access with daemon-backed data provider.

### Task 4.1 — Introduce TUI data provider interface

**Files:**
- Create: `bluenote-term/packages/term/src/tui/data-provider.ts`
- Modify: `bluenote-term/packages/term/src/tui/app.ts`
- Test: TUI controller/app tests

**RED:** Existing TUI startup/list/search tests should run against injected provider mocks.

**Implementation:** Extract provider interface for startup note, list/show/search, create/update/delete/rebuild, folders, and AI status/queue.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `refactor: add tui data provider boundary`

### Task 4.2 — Add daemon-backed read provider

**Files:**
- Create: `bluenote-term/packages/term/src/tui/daemon-data-provider.ts`
- Test: provider unit tests

**RED:** Tests cover startup/list/show/search using mocked daemon fetch client.

**Implementation:** Use daemon fetch client.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `feat: read tui data from daemon`

### Task 4.3 — Add daemon-backed mutation provider

**Files:** daemon provider and TUI wiring/tests

**RED:** Tests cover create draft, create normal note, update/save, delete, move/promote/rebuild through daemon provider.

**Implementation:** Replace normal TUI runtime provider with daemon provider when daemon env exists. Direct-core provider only remains explicit dev fallback if retained.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `feat: mutate tui data through daemon`

### Task 4.4 — Real TUI file-mutation verification

**Files:** tests/smoke or e2e under term repo; local manual status.

**RED:** Add a realistic PTY/runtime test or manual script that fails before daemon save path is wired.

**Required proof:**

- start daemon with temp root,
- launch TUI,
- type through real input path,
- save/autosave,
- verify Markdown file content changed on disk,
- verify token not printed,
- quit and confirm no TUI process leaks.

**Verify:** `cd bluenote-term && bun run check`

**Commit:** `test: verify tui saves through daemon`

---

## BN-DAEMON-005: WebUI proxy-to-daemon mode

**Repos:** `bluenote-webui`, maybe `bluenote-core`

**Goal:** Make installed WebUI proxy `/api/*` to daemon so browser behavior remains while storage/AI ownership moves to daemon.

### Task 5.1 — Add WebUI daemon proxy

**Files:**
- Create: `bluenote-webui/src/server/services/daemon-proxy.ts`
- Modify: `bluenote-webui/src/server/index.ts`
- Test: `bluenote-webui/tests/server-daemon-proxy.test.ts`

**RED:** Tests prove:

- `/api/notes` proxies to daemon when daemon env exists.
- authorization token is sent server-side.
- browser response does not include token.
- daemon error body is preserved safely.

**Implementation:** Proxy `/api/*` before direct-core routes when daemon env exists.

**Verify:** `cd bluenote-webui && npm run check`

**Commit:** `feat: proxy webui api to daemon`

### Task 5.2 — Make direct-core WebUI services dev-only

**Files:** WebUI server config/docs/tests

**RED:** Tests prove installed/normal mode with daemon env does not call direct services; dev fallback requires explicit env such as `BLUENOTE_WEBUI_DIRECT_CORE=1` if retained.

**Implementation:** Guard direct server services.

**Verify:** `cd bluenote-webui && npm run check`

**Commit:** `fix: require explicit direct-core webui mode`

### Task 5.3 — WebUI clean install verification

**Verify:** temp prefix:

```bash
bluenote daemon start
bluenote web --check-daemon
# API smoke through WebUI proxy
bluenote daemon stop
```

Commit docs only if public behavior/help changed.

---

## BN-DAEMON-006: Guardrails and final migration cleanup

**Repos:** all four as needed

**Goal:** Prevent regression to direct client/core normal paths and align docs/help/doctor.

### Task 6.1 — Forbidden import and normal-path guard tests

**Files:** package boundary tests in term/webui/bluenote

**RED:** Add scans that fail if normal runtime adapters import forbidden direct core operations after migration.

**Implementation:** Allow imports only in core app services, daemon server, explicit dev fallback files, or tests.

**Verify:** all repo checks.

**Commit:** `test: guard daemon api client boundaries`

### Task 6.2 — Doctor reports daemon API readiness

**Files:** `bluenote/src/commands/doctor.ts`, tests

**RED:** Doctor tests expect:

- daemon API version/capabilities,
- term CLI daemon API readiness,
- term TUI daemon API readiness,
- WebUI daemon proxy readiness,
- missing/broken actionable guidance.

**Implementation:** Extend doctor checks without secrets.

**Verify:** `cd bluenote && npm run check`

**Commit:** `feat: report daemon api readiness in doctor`

### Task 6.3 — Docs/help alignment

**Files:**
- `bluenote/README.md`
- `bluenote/DEVELOPMENT.md`
- `bluenote/docs/repo-ownership.md`
- target repo AGENTS/DEVELOPMENT docs as needed

**RED:** If docs tests exist, add assertions for new command/API contract and negative assertions for stale direct-core/client-owned wording.

**Implementation:** Concise docs only. Avoid documentation spam.

**Verify:** all changed repo checks.

**Commit:** `docs: document daemon api ownership`

### Task 6.4 — Full clean install and runtime verification

**Verify all repos:**

```bash
cd bluenote-core && npm run check
cd bluenote && npm run check
cd bluenote-webui && npm run check
cd bluenote-term && bun run check
```

**Node 16 smoke:**

```bash
cd bluenote
npx -y node@16.14.0 dist/bin.js --help
npx -y node@16.14.0 dist/bin.js version
npx -y node@16.14.0 dist/bin.js doctor
```

**Manual temp-prefix:**

- install distribution and clients into a temp prefix,
- start daemon,
- run term CLI commands through `bluenote`,
- run TUI file-mutation verification,
- run WebUI proxy API smoke,
- stop daemon,
- remove temp dirs,
- prove no project-owned processes remain.

**Commit:** per-repo final docs/test cleanup if any.

---

## Review workflow

For each BN-DAEMON phase:

1. Parent session reconciles git status and active task.
2. Implement via TDD in narrow commits.
3. Run repo-specific checks.
4. Run independent spec review subagent.
5. Run independent code-quality review subagent.
6. Fix blockers and re-review.
7. Push/PR per repo when the phase is coherent.
8. Request Codex review and resolve comments before moving to the next phase if the user wants PR-gated development.

## Recommended first execution slice

Start with BN-DAEMON-001 only. Do not begin term or WebUI migration until the daemon contract/router scaffold is merged or at least green and reviewed.

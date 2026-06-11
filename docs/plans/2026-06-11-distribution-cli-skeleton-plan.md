# Distribution CLI Skeleton Plan

> **For Hermes:** This is a plan-only artifact. Do not implement until the user explicitly approves this plan. When approved, use subagent-driven-development to implement task-by-task with review.

**Goal:** Design the initial Node 16.14-compatible `bluenote` distribution CLI skeleton for `bluenote tui`, `bluenote web`, `bluenote doctor`, and `bluenote version`.

**Architecture:** The `bluenote` repo owns top-level command routing, help/version/doctor behavior, packaging, and distribution docs. It should stay thin: basic commands run on Node 16.14 without loading Bun/OpenTUI/web dependencies, while client commands lazy-load public APIs from the owning client packages. Core note/storage/search/AI semantics remain in `bluenote-core`.

**Tech Stack:** Node 16.14-compatible ESM or CJS TypeScript/JavaScript, npm, public package exports only, dynamic imports for runtime-specific clients.

---

## Current constraints

- `bluenote` is currently a minimal repo with docs, `LICENSE`, and `.gitignore`; it has no package scaffold yet.
- `bluenote-core`, `bluenote-webui`, and `bluenote` must remain compatible with Node 16.14.
- `bluenote-term` may require Bun/OpenTUI/newer Node.
- Product behavior must not change until implementation is approved.
- Do not rewrite TUI or WebUI.
- Do not change note file format, storage layout, search semantics, or AI behavior.
- Do not implement sync/server/cloud/real daemon protocol in this skeleton.

## Proposed command surface

```text
bluenote --help
bluenote version
bluenote doctor
bluenote tui [...args]
bluenote web [...args]
bluenote daemon [...args]
```

Initial implementation should keep `daemon` as an explicit scaffold/help command only unless a later cross-repo design approves runtime protocol work.

## Boundary decisions

1. `bluenote` owns argument parsing and top-level help.
2. `bluenote` owns `version` output and distribution package metadata reading.
3. `bluenote` owns `doctor` checks that are about distribution/runtime availability.
4. `bluenote tui` delegates to a public `bluenote-term` command API, loaded only after the `tui` command is selected.
5. `bluenote web` delegates to a public `bluenote-webui` command/server API, loaded only after the `web` command is selected.
6. `bluenote` must never import sibling `src/*`, generated `dist/*`, or tests.
7. If `bluenote-term` or `bluenote-webui` lacks a public command API, add that API in the owning repo in a separate approved task before wiring the distribution command.

## Proposed package shape

Future implementation should create a minimal package scaffold such as:

```text
package.json
src/
  cli.ts
  commands/
    doctor.ts
    version.ts
    tui.ts
    web.ts
    daemon.ts
  runtime/
    node-version.ts
    lazy-load.ts
bin/
  bluenote.js
tests/
  cli-help.test.ts
  version.test.ts
  doctor.test.ts
```

Exact extensions/build tooling may be adjusted during implementation, but the chosen tooling must support Node 16.14 and npm in restricted environments.

## Planned tasks after approval

### Task 1: Scaffold the distribution package metadata

**Objective:** Add the minimal npm package scaffold without runtime client dependencies.

**Files:**

- Create: `package.json`
- Create: `bin/bluenote.js`
- Create: `src/cli.ts` or `src/cli.js`
- Create: `tests/cli-help.test.*`

**Implementation notes:**

- Set the package name to the intended distribution package name only after confirming publish naming.
- Use npm, not Bun, for this repo unless an approved plan changes it.
- Ensure the binary entrypoint can run on Node 16.14.
- Keep help/version code independent of `bluenote-term` and `bluenote-webui`.

**Verification:**

- Run the package's lightweight test/check command once package scripts exist.
- Run `node bin/bluenote.js --help` under the available runtime.

### Task 2: Add top-level help and command routing tests

**Objective:** Define the command contract before wiring clients.

**Files:**

- Modify: `src/cli.*`
- Create/modify: `tests/cli-help.test.*`

**Expected behavior:**

- `bluenote --help` lists `tui`, `web`, `daemon`, `doctor`, and `version`.
- Unknown commands print a concise error and suggest `--help`.
- Help does not import or require TUI/WebUI packages.

**Verification:**

- Run the focused help tests.
- Run `node bin/bluenote.js --help`.

### Task 3: Add `version` command

**Objective:** Implement Node 16.14-compatible version output owned by the distribution repo.

**Files:**

- Modify: `src/commands/version.*`
- Create/modify: `tests/version.test.*`

**Expected behavior:**

- `bluenote version` prints the distribution package version.
- It does not inspect note workspaces or load clients.

**Verification:**

- Run focused version tests.
- Run `node bin/bluenote.js version`.

### Task 4: Add `doctor` command with runtime checks only

**Objective:** Add a thin diagnostic command for runtime/dependency availability without touching workspaces.

**Files:**

- Modify: `src/commands/doctor.*`
- Create/modify: `tests/doctor.test.*`

**Expected behavior:**

- Reports current Node version.
- Reports whether Node satisfies the distribution baseline.
- Optionally reports whether client command dependencies appear installed, without importing them eagerly.
- Does not validate note storage, search, AI, or daemon protocol.

**Verification:**

- Run focused doctor tests.
- Run `node bin/bluenote.js doctor`.

### Task 5: Add lazy-load wrappers for `tui` and `web`

**Objective:** Route client commands through public package exports without eager imports.

**Files:**

- Modify: `src/commands/tui.*`
- Modify: `src/commands/web.*`
- Create/modify: focused lazy-load tests

**Expected behavior:**

- `bluenote tui` dynamically imports the public `bluenote-term` command API only after command selection.
- `bluenote web` dynamically imports the public `bluenote-webui` command/server API only after command selection.
- Missing client APIs produce actionable errors.
- No sibling internal paths are imported.

**Verification:**

- Run tests that prove `--help`, `version`, and `doctor` do not load client modules.
- Run focused command wrapper tests with mocked public APIs.

### Task 6: Add `daemon` scaffold command

**Objective:** Reserve the command name without implementing daemon/runtime/sync protocol.

**Files:**

- Modify: `src/commands/daemon.*`
- Create/modify: focused daemon help tests

**Expected behavior:**

- `bluenote daemon --help` explains that real daemon/runtime protocol requires a future cross-repo design.
- The command exits clearly without modifying workspaces.

**Verification:**

- Run daemon help tests.
- Run `node bin/bluenote.js daemon --help`.

### Task 7: Update distribution docs

**Objective:** Align docs with the implemented command surface.

**Files:**

- Modify: `README.md` if created by implementation.
- Modify: `DEVELOPMENT.md` if package scripts/dependency strategy changed.
- Modify: `docs/runtime-compatibility.md` only if compatibility details need clarification.

**Verification:**

- Run doc/help contract tests if added.
- Inspect `README.md`, `AGENTS.md`, and `DEVELOPMENT.md` for consistency.

## Approval gate

Implementation must not begin until the user approves this plan or asks for a modified plan. Approval should also confirm:

1. package name for the distribution repo,
2. TypeScript vs plain JavaScript scaffold preference,
3. whether to add mocked client wrapper tests before client public APIs exist,
4. whether `daemon` should be help-only or return a non-zero "not implemented" status initially.

## Risks and mitigations

- **Risk:** Eager imports pull Bun/OpenTUI into Node 16.14-only commands.  
  **Mitigation:** Add tests that assert help/version/doctor do not import client modules.

- **Risk:** Distribution repo duplicates core or client behavior.  
  **Mitigation:** Keep command wrappers thin; add public APIs in owning repos before wiring.

- **Risk:** Daemon command implies a protocol that does not exist.  
  **Mitigation:** Keep daemon scaffold help-only until a cross-repo protocol design is approved.

- **Risk:** Package scaffold creates lockfile/tooling churn.  
  **Mitigation:** Keep implementation package dependencies minimal and npm-based.

## Verification matrix for future implementation

- `bluenote`: new package checks and command smoke tests.
- `bluenote-term`: only if adding/changing public TUI command API.
- `bluenote-webui`: only if adding/changing public web command API.
- `bluenote-core`: only if changing core APIs, which this plan should avoid.

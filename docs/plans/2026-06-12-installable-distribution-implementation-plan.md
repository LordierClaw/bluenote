# Installable Distribution CLI Implementation Plan

> **For implementer:** Use TDD throughout. Write failing tests first. Watch them fail. Then implement. Keep manual verification artifacts local-only; do not commit temp-prefix logs, cleanup scripts, machine-specific paths, or one-off QA transcripts.

**Goal:** Make the BlueNote distribution CLI model installable as an end-user global npm package that discovers optional globally installed `bluenote-webui` and `bluenote-term` clients through PATH/package resolution, runs a minimal real local daemon, launches clients against that daemon, reports everything in `doctor`, and verifies the flow manually in an isolated temporary npm prefix.

**Architecture:** Option B only. `@lordierclaw/bluenote` is the distribution CLI/daemon entrypoint and does not require WebUI/TUI as bundled dependencies in release mode. Optional clients expose stable public executables named `bluenote-webui` and `bluenote-term`; `bluenote` discovers those executables on PATH and launches them only after a daemon endpoint is available. The daemon is a local HTTP process with random/free port, token metadata, health/capabilities endpoints, start/status/stop commands, and enough API surface for clients to prove daemon connectivity. Manual verification uses a temporary npm prefix and temporary BlueNote config/data/cache roots, with cleanup proof kept outside git.

**Tech Stack:** Node `>=16.14 <17 || >=18`, npm 8-compatible packages, Bun/OpenTUI for TUI only, TypeScript, existing Node-based CLI contract tests, Vitest in client repos.

**Approved design:** `docs/plans/2026-06-12-installable-distribution-design.md`

---

## Scope rules

- Do not implement explicit `client link` or `client install` commands in this milestone.
- Do not auto-start the daemon from `bluenote web` or `bluenote tui`.
- Do not commit manual verification files, local temp-prefix logs, local cleanup scripts, or local QA transcripts.
- Do not change storage/search/AI semantics.
- Do not rewrite WebUI or TUI layout.
- Do not import sibling `src/*` or `dist/*` internals.
- Keep `bluenote --help`, `version`, and `doctor` lightweight and Node 16.14-compatible.

---

## Task 1: Add cross-platform PATH command discovery in `bluenote`

**Files:**

- Create: `src/utils/command-discovery.ts`
- Modify: `tests/run-tests.js`

**Behavior:**

Add a utility that can locate an executable on PATH without shelling out through platform-specific commands. It should support Windows `PATHEXT` behavior when `platform === "win32"`, and normal exact executable names on Linux/macOS.

**Step 1: Write failing tests**

Add tests in `tests/run-tests.js` that create a temporary directory with fake executable files and assert:

- `findCommandOnPath("bluenote-webui", { path: tempBin, platform: "linux" })` returns the fake executable path.
- missing command returns `undefined`.
- Windows lookup finds `bluenote-webui.CMD` when `PATHEXT=.COM;.EXE;.BAT;.CMD`.
- lookup does not use the developer machine's real PATH when an explicit PATH is provided.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test
```

Expected: FAIL because `src/utils/command-discovery.ts` does not exist or is not exported to the test harness.

**Step 3: Implement minimal utility**

Create `src/utils/command-discovery.ts` with exported functions:

```ts
export type CommandDiscoveryOptions = {
  path?: string
  pathext?: string
  platform?: NodeJS.Platform
}

export type CommandResolution = {
  command: string
  path: string
}

export function findCommandOnPath(command: string, options?: CommandDiscoveryOptions): CommandResolution | undefined
```

Use `fs.existsSync` / `fs.statSync`, `path.delimiter`, and PATHEXT expansion. Keep it side-effect-free.

**Step 4: Run test — confirm it passes**

Command:

```sh
npm run test
```

Expected: PASS for the new discovery tests.

**Step 5: Commit**

```sh
git add src/utils/command-discovery.ts tests/run-tests.js && git commit -m "feat: discover optional client commands on path"
```

---

## Task 2: Update `doctor` to report optional client executables accurately

**Files:**

- Modify: `src/commands/doctor.ts`
- Modify: `src/types.ts` if needed for injectable env/platform/path discovery.
- Modify: `tests/run-tests.js`

**Behavior:**

`doctor` should report optional client command status without treating missing clients as a distribution failure.

Target client names:

- `bluenote-webui`
- `bluenote-term`

Doctor should still fail on unsupported Node, but missing optional clients should be actionable status, not command failure.

**Step 1: Write failing tests**

Add tests that assert:

- With no fake clients on PATH, `doctor` exits 0 on supported Node and prints `bluenote-webui: missing` and `bluenote-term: missing`.
- With fake `bluenote-webui` and `bluenote-term` executables on PATH, `doctor` prints `found` plus their paths.
- Doctor still reports Bun availability for TUI without requiring Bun for basic doctor success.
- Doctor output does not print `BLUENOTE_DAEMON_TOKEN` if present in the environment.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test
```

Expected: FAIL because current doctor checks bundled package resolution instead of optional PATH client commands.

**Step 3: Implement doctor sections**

Update `runDoctor` to include sections:

- Distribution
- Daemon
- Clients
- AI/config placeholder status

For this implementation, daemon status should report stopped/running/stale/unreachable from real daemon metadata and health checks. Client status should use `findCommandOnPath`.

**Step 4: Run test — confirm it passes**

Command:

```sh
npm run test
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/commands/doctor.ts src/types.ts tests/run-tests.js && git commit -m "feat: report optional clients in doctor"
```

---

## Task 3: Make `bluenote web` and `bluenote tui` launch optional PATH clients only when daemon metadata exists

**Files:**

- Modify: `src/commands/web.ts`
- Modify: `src/commands/tui.ts`
- Create or modify: `src/utils/daemon-state.ts`
- Modify: `tests/run-tests.js`

**Behavior:**

`bluenote web` and `bluenote tui` should:

1. Check daemon state metadata.
2. If daemon metadata/health is unavailable, fail clearly:

   ```text
   BlueNote daemon is not running.
   Run: bluenote daemon start
   ```

3. If daemon metadata exists, discover the relevant PATH executable.
4. Launch the client executable with:

   ```text
   BLUENOTE_DAEMON_URL=<url>
   BLUENOTE_DAEMON_TOKEN=<token>
   ```

5. Do not print the token.

**Step 1: Write failing tests**

Add tests that assert:

- `bluenote web` fails with daemon-start guidance when no daemon metadata exists.
- `bluenote tui` fails with daemon-start guidance when no daemon metadata exists.
- With fake daemon metadata and fake client command, web launch calls the fake command with env vars.
- With fake daemon metadata and fake client command, tui launch calls the fake command with env vars.
- Missing client command produces an actionable missing-client message.

Use dependency injection for spawn/env/config path rather than launching real clients in unit tests.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test
```

Expected: FAIL because current commands lazy-load package deps or spawn `bluenote-term` package bin, not PATH clients gated by daemon state.

**Step 3: Implement minimal daemon state utility and launch changes**

Create `src/utils/daemon-state.ts` with a small metadata reader. For this milestone, it may support a test-injected metadata path and return `undefined` when no daemon is running.

Expected shape:

```ts
export type DaemonConnection = {
  url: string
  token: string
  pid?: number
}
```

Update `web.ts` and `tui.ts` to use PATH command names:

- web -> `bluenote-webui`
- tui -> `bluenote-term`

**Step 4: Run test — confirm it passes**

Command:

```sh
npm run test
```

Expected: PASS.

**Step 5: Commit**

```sh
git add src/commands/web.ts src/commands/tui.ts src/utils/daemon-state.ts tests/run-tests.js && git commit -m "feat: launch optional clients through daemon context"
```

---

## Task 3A: Implement minimal real daemon lifecycle and HTTP health API

**Files:**

- Modify: `src/commands/daemon.ts`
- Modify: `src/utils/daemon-state.ts`
- Create: `src/daemon/server.ts`
- Create: `src/daemon/paths.ts`
- Create: `src/daemon/token.ts`
- Modify: `tests/run-tests.js`

**Behavior:**

Implement a local-only daemon that can be started, queried, and stopped by the distribution CLI. The daemon owns the first real HTTP API surface that clients can use to prove daemon connectivity.

Minimum API:

- `GET /health` returns JSON `{ ok: true, name: "bluenote-daemon", version }`.
- `GET /capabilities` returns JSON with at least daemon version, local-only mode, and client capability hints.
- All non-health endpoints require the token when introduced; health may remain tokenless only if no secrets are returned.

State:

- Use localhost `127.0.0.1` and an OS-assigned/random free port.
- Store daemon metadata in a user config/state location that can be overridden in tests/manual verification with environment variables.
- Metadata includes `pid`, `url`, `token`, `startedAt`, and version.
- `doctor` and client-launch commands consume this metadata.
- Tokens must never be printed.

Lifecycle:

- `bluenote daemon start` starts the daemon detached enough for the command to return after health is ready.
- `bluenote daemon status` reports running/stopped/stale/unreachable accurately.
- `bluenote daemon stop` stops the daemon and removes/stales metadata.
- Stale PID/metadata is handled without crashing.

**Step 1: Write failing tests**

Add tests that assert:

- `daemon status` reports stopped before start.
- `daemon start` creates metadata with url/token/pid but does not print token.
- `daemon status` reports running after start and verifies health.
- `daemon stop` stops the process and status returns stopped.
- stale metadata is reported as stale/unreachable and can be cleaned.
- Node 16.14 can run `daemon status` and health metadata parsing.

Use temporary config/state paths in tests and clean up child processes.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test
```

Expected: FAIL because daemon commands do not yet provide the required real lifecycle behavior.

**Step 3: Implement minimal daemon**

Implement the smallest Node 16-compatible HTTP daemon and lifecycle helpers. Avoid heavy frameworks.

**Step 4: Run tests and smoke daemon manually**

Commands:

```sh
npm run test
npm run build
node dist/bin.js daemon status
node dist/bin.js daemon start
node dist/bin.js daemon status
node dist/bin.js doctor
node dist/bin.js daemon stop
node dist/bin.js daemon status
```

Expected: PASS; no token printed.

**Step 5: Commit**

```sh
git add src/commands/daemon.ts src/utils/daemon-state.ts src/daemon tests/run-tests.js && git commit -m "feat: implement local daemon lifecycle"
```

---

## Task 4: Add stable `bluenote-webui` bin to WebUI package

**Files:**

- Modify: `package.json` in `bluenote-webui`
- Create if needed: `bin/bluenote-webui.js`
- Modify or add: `tests/command.test.ts`

**Behavior:**

`bluenote-webui` should expose a public executable named `bluenote-webui` suitable for npm global install PATH discovery.

The bin should:

- call the existing public WebUI command API,
- support `--help`,
- accept daemon flags `--daemon-url` and `--daemon-token` for manual testing even if full daemon mode is implemented later,
- perform a daemon health/capabilities check when daemon flags or environment variables are present, and expose a non-browser smoke mode such as `--check-daemon` for manual verification,
- preserve existing dev/start behavior.

**Step 1: Write failing tests**

Add or extend tests that assert:

- `package.json` has `bin.bluenote-webui`.
- The command parser accepts `--daemon-url` and `--daemon-token` without crashing.
- `--help` still prints WebUI usage.
- `--check-daemon --daemon-url <url> --daemon-token <token>` returns success when the daemon health/capabilities endpoint is reachable and failure when it is not.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test -- tests/command.test.ts
```

Expected: FAIL because `bin.bluenote-webui` is currently missing and daemon flags are not yet accepted.

**Step 3: Implement bin and flag support**

Add the minimal bin wrapper and parser support. Do not change WebUI layout.

**Step 4: Run checks**

Commands:

```sh
npm run test -- tests/command.test.ts
npm run check
```

Expected: PASS.

**Step 5: Commit**

```sh
git add package.json bin/bluenote-webui.js src/command.ts tests/command.test.ts && git commit -m "feat: expose webui client executable"
```

---

## Task 5: Add stable `bluenote-term` bin to TUI package

**Files:**

- Modify: `packages/term/package.json` in `bluenote-term`
- Modify or create: `packages/term/bin/bluenote-term.ts`
- Modify or add relevant command API tests.

**Behavior:**

`bluenote-term` should expose a public executable named `bluenote-term` suitable for npm global install PATH discovery.

The bin should:

- delegate to the existing `runTuiCommand(args)` public API,
- accept daemon flags `--daemon-url` and `--daemon-token` for manual testing / future daemon mode,
- perform a daemon health/capabilities check when daemon flags or environment variables are present, and expose a non-fullscreen smoke mode such as `--check-daemon` for manual verification,
- preserve existing `bn` / `bluenote` compatibility if currently required by the package.

**Step 1: Write failing tests**

Add or extend tests that assert:

- `packages/term/package.json` has `bin.bluenote-term`.
- The command API accepts daemon flags without crashing.
- The command API can run `--check-daemon` against a fake daemon endpoint without launching the full-screen TUI.
- Existing bin behavior remains compatible.

**Step 2: Run test — confirm it fails**

Command:

```sh
bun test tests/unit/command-api.test.ts
```

or the closest existing targeted command test.

Expected: FAIL because `bin.bluenote-term` is currently missing and daemon flags are not yet accepted.

**Step 3: Implement bin and flag support**

Add a minimal bin wrapper and parser support. Do not change TUI screens, layout, keybindings, storage/search/AI behavior, or OpenTUI internals.

**Step 4: Run checks**

Command:

```sh
bun run check
```

Expected: PASS.

**Step 5: Commit**

```sh
git add packages/term/package.json packages/term/bin/bluenote-term.ts packages/term/src/command.ts tests/unit/command-api.test.ts && git commit -m "feat: expose terminal client executable"
```

---

## Task 6: Update distribution package metadata and docs for Option B release behavior

**Files:**

- Modify: `package.json` in `bluenote`
- Modify: `README.md`
- Modify: `DEVELOPMENT.md`
- Modify: `AGENTS.md` if ownership/dependency rules need clarification.
- Modify: `docs/runtime-compatibility.md` if install/runtime docs change.

**Behavior:**

The release-facing docs should describe independent global installs and PATH discovery. Local sibling `file:` dependencies can remain documented as development-only if still needed for local checks, but end-user install docs must not imply WebUI/TUI are bundled with the distribution CLI.

**Step 1: Write failing tests**

Add doc/help contract assertions in `tests/run-tests.js` that verify:

- README includes the independent global install commands.
- README does not present local `file:` dependencies as the end-user install path.
- CLI help or doctor wording references optional clients accurately.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run test
```

Expected: FAIL because current README emphasizes local sibling file dependencies.

**Step 3: Update docs and package metadata**

Update docs so they distinguish:

- end-user install mode: independent global packages,
- local development mode: sibling checkout / file dependencies if still applicable,
- optional client discovery names,
- daemon not-running behavior,
- local-only manual verification evidence rule.

If removing `bluenote-webui` / `bluenote-term` from distribution dependencies is in-scope for this milestone, do it here and adjust tests. If package-manager constraints require keeping local dev dependencies temporarily, clearly mark them as dev/local only and record the release packaging follow-up.

**Step 4: Run checks**

Commands:

```sh
npm run check
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
npx -y node@16.14.0 dist/bin.js --help
npx -y node@16.14.0 dist/bin.js doctor
```

Expected: PASS.

**Step 5: Commit**

```sh
git add package.json package-lock.json README.md DEVELOPMENT.md AGENTS.md docs/runtime-compatibility.md tests/run-tests.js && git commit -m "docs: document independent client install model"
```

---

## Task 7: Add local-only manual verification procedure and execute it

**Files:**

- Local-only: parent `.agent/STATUS.md`
- Local-only: ignored temp directory under `/tmp` or parent `.agent/tmp/`
- Do not commit manual verification files.

**Behavior:**

Run a real install simulation with a temporary npm prefix. This must be done after package changes are implemented and built.

**Step 1: Prepare local-only temp environment**

Use commands shaped like:

```sh
MANUAL_ROOT=$(mktemp -d /tmp/bluenote-manual-verify-XXXXXX)
NPM_PREFIX="$MANUAL_ROOT/npm-prefix"
BN_CONFIG_HOME="$MANUAL_ROOT/config"
BN_DATA_HOME="$MANUAL_ROOT/data"
BN_CACHE_HOME="$MANUAL_ROOT/cache"
mkdir -p "$NPM_PREFIX" "$BN_CONFIG_HOME" "$BN_DATA_HOME" "$BN_CACHE_HOME"
```

Do not save this script in a git-tracked file.

**Step 2: Build and pack local artifacts**

From each relevant repo, build/package with repo-approved commands. Prefer `npm pack --pack-destination "$MANUAL_ROOT/packs"` or equivalent.

**Step 3: Install as an end user into temp prefix**

Install into the temporary prefix only:

```sh
npm install -g --prefix "$NPM_PREFIX" <path-to-bluenote-tarball>
```

Then add clients one at a time:

```sh
npm install -g --prefix "$NPM_PREFIX" <path-to-bluenote-webui-tarball>
npm install -g --prefix "$NPM_PREFIX" <path-to-bluenote-term-tarball>
```

**Step 4: Run manual commands with temp PATH/config**

Use environment variables to isolate the run:

```sh
PATH="$NPM_PREFIX/bin:$PATH" \
XDG_CONFIG_HOME="$BN_CONFIG_HOME" \
XDG_DATA_HOME="$BN_DATA_HOME" \
XDG_CACHE_HOME="$BN_CACHE_HOME" \
bluenote --help
```

Verify after each install stage:

```sh
bluenote version
bluenote doctor
bluenote daemon start
bluenote daemon status
bluenote web
bluenote tui
bluenote daemon stop
```

Expected:

- before clients: doctor reports both clients missing but exits successfully on supported Node,
- after WebUI install: doctor reports WebUI found,
- after TUI install: doctor reports TUI found and Bun readiness accurately,
- before daemon start, web/tui fail with clear daemon-start guidance,
- after daemon start, web/tui launch/check their installed client executables with daemon environment handoff,
- daemon status reports running while started and stopped after stop.

**Step 5: Cleanup and prove clean state**

Stop any daemon/manual-test process. Remove temp dirs:

```sh
rm -rf "$MANUAL_ROOT"
```

Verify:

```sh
test ! -e "$MANUAL_ROOT"
pgrep -af 'bluenote|bluenote-webui|bluenote-term' || true
```

Only project-owned processes from the manual verification should be considered cleanup failures; do not kill unrelated user processes.

**Step 6: Record local-only evidence**

Update parent `.agent/STATUS.md` with a concise summary:

- temp prefix path used,
- commands run,
- pass/fail result,
- cleanup result,
- any limitations.

Do not commit that local status file.

---

## Final verification gates

Run, as applicable:

### `bluenote`

```sh
npm install --include=dev
npm run check
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
npx -y node@16.14.0 dist/bin.js --help
npx -y node@16.14.0 dist/bin.js version
npx -y node@16.14.0 dist/bin.js doctor
```

### `bluenote-webui` if changed

```sh
npm install --include=dev
npm run check
```

### `bluenote-term` if changed

```sh
bun install
bun run check
```

### Manual local verification

Run Task 7 exactly. Manual evidence remains local-only.

---

## Expected commit grouping

- `bluenote`: discovery/doctor/client-launch commits.
- `bluenote-webui`: client executable commit if changed.
- `bluenote-term`: client executable commit if changed.
- `bluenote`: docs/release behavior commit.

Do not push until the user asks.

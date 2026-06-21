# Distribution CLI / Terminal TUI Ownership Split Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement. Do not commit unless the user explicitly authorizes commits in this session; make each task a clean checkpoint with `git status` and exact verification output instead.

**Goal:** Move normal note-management CLI commands to the `bluenote` distribution CLI and make `@lordierclaw/bluenote-term` TUI-only, so `bluenote tui` / `bluenote term` launch the terminal UI rather than legacy terminal CLI help.

**Architecture:** `bluenote` owns command presentation and routes note-management commands to public `@lordierclaw/bluenote-core` APIs using Node-compatible adapters. `bluenote-term` keeps TUI launch/probe/daemon-check behavior only. The distribution continues to discover/spawn `bluenote-term` through public executable or built-client discovery, never by importing OpenTUI/Bun internals.

**Tech Stack:** TypeScript, Node 16-compatible distribution build, Bun/OpenTUI in terminal package, public `@lordierclaw/bluenote-core` APIs, existing `npm run check` and `bun run check` gates.

**Approved design:** `docs/plans/2026-06-20-distribution-cli-term-tui-split-design.md`

---

## Execution notes

- Parent workspace `.agent/CURRENT_TASK.md` is `BN-DIST-CLI-TERM-TUI-SPLIT`; release work is paused.
- Do not import `bluenote-term/src/*`, `bluenote-term/dist/*`, Bun-only code, or OpenTUI into `/root/code/bluenote`.
- Do not change storage/search/AI semantics in `/root/code/bluenote-core` unless a task discovers a missing public API and stops for approval.
- Preserve current CLI behavior where practical, but update emitted hints from `bn ...` to `bluenote ...` where the distribution owns the command.
- Parent-session acceptance after each subagent task must re-read changed files and rerun the task’s targeted tests.

---

## Task 1: Add distribution note-command RED tests

**Files:**
- Modify: `/root/code/bluenote/tests/run-tests.js`
- Do not modify production files in this task.

**Step 1: Write failing tests**

Add helper coverage to `/root/code/bluenote/tests/run-tests.js` near existing CLI command tests:

- A temp-root workflow that calls `cli.run()` through the distribution API with `BLUENOTE_ROOT` set.
- Assertions for:
  - `bluenote init`
  - `bluenote new --path note --title "Workflow Alpha" "Alpha normal body"`
  - `bluenote new "Draft body"`
  - `bluenote list` excludes draft by default.
  - `bluenote list --drafts` includes draft.
  - `bluenote show <key>` prints title/key/path/body.
  - `bluenote search Alpha` finds the normal note.
  - `bluenote archive <key>` archives a normal note.
  - `bluenote delete --all <key> --force` deletes it.
  - `bluenote rebuild` reports rebuilt note count.

Suggested test function shape:

```js
async function testDistributionNoteCommands() {
  const root = makeTempDir('distribution-note-commands');
  const env = { ...process.env, BLUENOTE_ROOT: root };
  const run = (args) => runCli(args, { env });

  const init = await run(['init']);
  assert.equal(init.code, 0);
  assert.match(init.stdout, new RegExp(`Initialized BlueNote root: ${escapeRegExp(root)}`));

  const created = await run(['new', '--path', 'note', '--title', 'Workflow Alpha', 'Alpha normal body']);
  assert.equal(created.code, 0);
  const normalKey = created.stdout.match(/^Created note\nKey: ([^\n]+)\nPath: note\/[^\n]+\.md\n$/)?.[1];
  assert.ok(normalKey, created.stdout);

  const draft = await run(['new', 'Draft body']);
  assert.equal(draft.code, 0);
  const draftKey = draft.stdout.match(/^Created note\nKey: ([^\n]+)\nPath: draft\/[^\n]+\.md\n$/)?.[1];
  assert.ok(draftKey, draft.stdout);

  const list = await run(['list']);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /Workflow Alpha\t/);
  assert.doesNotMatch(list.stdout, /Draft body/);

  const drafts = await run(['list', '--drafts']);
  assert.equal(drafts.code, 0);
  assert.match(drafts.stdout, new RegExp(`${escapeRegExp(draftKey)}\\tDraft body`));

  const show = await run(['show', normalKey]);
  assert.equal(show.code, 0);
  assert.match(show.stdout, /Title: Workflow Alpha/);
  assert.match(show.stdout, /Alpha normal body/);

  const search = await run(['search', 'Alpha']);
  assert.equal(search.code, 0);
  assert.match(search.stdout, /Workflow Alpha/);

  const archive = await run(['archive', normalKey]);
  assert.equal(archive.code, 0);
  assert.match(archive.stdout, /^Archived note: note\//);

  const del = await run(['delete', '--all', normalKey, '--force']);
  assert.equal(del.code, 0);
  assert.match(del.stdout, /^Deleted note: \.data\/archive\//);

  const rebuild = await run(['rebuild']);
  assert.equal(rebuild.code, 0);
  assert.match(rebuild.stdout, /^Rebuilt indexes for \d+ note\(s\)\./);
}
```

Call `await testDistributionNoteCommands()` from the main test runner sequence.

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: FAIL because `bluenote/src/cli.ts` currently reports `Unknown command: init` or similar for note commands.

**Step 3: Stop**

Do not implement in this task. Report the RED failure and changed test file.

**Step 4: Parent verification**

Parent reruns the same command and confirms the failure is expected before dispatching Task 2.

---

## Task 2: Port core note CLI commands into distribution

**Files:**
- Create: `/root/code/bluenote/src/commands/notes.ts`
- Modify: `/root/code/bluenote/src/cli.ts`
- Modify if needed: `/root/code/bluenote/src/commands/help.ts`
- Test: `/root/code/bluenote/tests/run-tests.js`

**Step 1: Confirm RED from Task 1 still fails**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: FAIL on distribution note commands.

**Step 2: Write minimal implementation**

Create `/root/code/bluenote/src/commands/notes.ts` as a Node-compatible distribution-owned command module. Port presentation/parsing from `bluenote-term/packages/term/src/cli/entry.ts`, but:

- Import only public `@lordierclaw/bluenote-core` exports.
- Do not import terminal package files.
- Omit `tui` handling; distribution `tui` remains in `src/commands/tui.ts`.
- Omit `ai` for this task unless public Node-compatible AI APIs are straightforward; Task 4 covers AI separately.
- Update hints to `bluenote ...` rather than `bn ...` for distribution-owned errors.

Required exports:

```ts
export const NOTE_COMMANDS = ["init", "new", "list", "show", "search", "edit", "archive", "delete", "rebuild"] as const
export type NoteCommand = typeof NOTE_COMMANDS[number]
export function isNoteCommand(command: string): command is NoteCommand
export async function runNoteCommand(command: NoteCommand, args: string[], io?: CommandIo): Promise<number>
```

Update `/root/code/bluenote/src/cli.ts`:

```ts
import { isNoteCommand, runNoteCommand } from "./commands/notes"

// ...
if (isNoteCommand(command)) return runNoteCommand(command, commandArgs, io)
```

Implementation details to preserve:

- `formatCliError` maps validation/data errors to exit code `2`, other app errors to exit code `1`.
- `parseVisibilityArgs` keeps discovery flags leading-only for list/search.
- `parseSelectorArgs` accepts `--drafts`, `--all`, and `--force` only where allowed, preserving current selector behavior.
- `new` supports `--title`, `-t`, `--path`, `--clipboard`, and positional body.
- Clipboard support must use a Node-compatible adapter; if `clipboardy` is not a distribution dependency, either add it intentionally to `bluenote/package.json` or implement a clear usage error for `--clipboard` and stop for approval. Prefer adding `clipboardy` only if package/runtime compatibility is verified.
- `edit` must use `$EDITOR` behavior equivalent to the existing terminal CLI helper. If the helper cannot be ported without terminal internals, add a Node-compatible adapter in `bluenote/src/utils/editor.ts`.

**Step 3: Run test — confirm it passes**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: PASS for the new distribution note-command workflow and existing tests.

**Step 4: Run typecheck**

Command:

```sh
npm run typecheck
```

Expected: PASS.

**Step 5: Checkpoint**

Do not commit unless authorized. Run:

```sh
git status --short
```

Report changed files and verification output.

---

## Task 3: Update distribution help/docs for first-class note CLI

**Files:**
- Modify: `/root/code/bluenote/src/commands/help.ts`
- Modify: `/root/code/bluenote/README.md`
- Modify if needed: `/root/code/bluenote/AGENTS.md`
- Test: `/root/code/bluenote/tests/run-tests.js`

**Step 1: Write failing help/docs contract tests**

In `/root/code/bluenote/tests/run-tests.js`, add assertions that:

- `bluenote --help` includes note commands: `init`, `new`, `list`, `show`, `search`, `edit`, `archive`, `delete`, `rebuild`.
- `bluenote --help` still includes `tui`, `term`, `web`, `daemon`, `doctor`, `version`.
- `bluenote/README.md` states that `bluenote` is the normal note-management CLI.
- `bluenote/README.md` includes examples for `bluenote new`, `bluenote list`, and `bluenote tui`.

Suggested assertion fragment:

```js
async function testDistributionHelpDocumentsNoteCommands() {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  for (const command of ['init', 'new', 'list', 'show', 'search', 'edit', 'archive', 'delete', 'rebuild', 'tui', 'term', 'web', 'daemon', 'doctor', 'version']) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
}
```

**Step 2: Run test — confirm it fails**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: FAIL because help/README do not yet fully document distribution-owned note commands.

**Step 3: Implement docs/help update**

- Expand `HELP_TEXT` in `/root/code/bluenote/src/commands/help.ts` with note commands and concise usage.
- Update `/root/code/bluenote/README.md`:
  - Role section: distribution owns normal note CLI and client launchers.
  - Install section: show `bluenote init`, `bluenote new`, `bluenote list`, `bluenote tui`.
  - Packaging section: note commands are in distribution; terminal package is optional TUI client.
- Update `/root/code/bluenote/AGENTS.md` only if it still says distribution does not own command presentation for notes.

**Step 4: Run test — confirm it passes**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: PASS.

**Step 5: Checkpoint**

Run:

```sh
git status --short
```

Report changed files and verification output.

---

## Task 4: Decide and port AI CLI command surface safely

**Files:**
- Inspect: `/root/code/bluenote-term/packages/term/src/cli/ai.ts`
- Inspect public core exports in `/root/code/bluenote-core/package.json` and source exports.
- Modify only if APIs are public/Node-compatible:
  - `/root/code/bluenote/src/commands/notes.ts` or `/root/code/bluenote/src/commands/ai.ts`
  - `/root/code/bluenote/src/cli.ts`
  - `/root/code/bluenote/tests/run-tests.js`

**Step 1: Inspect dependencies before tests**

Read the current terminal AI CLI file and public core exports. Determine whether `ai` can be moved without importing terminal internals or Bun/OpenTUI-only modules.

**Step 2: Write failing tests only for supported AI paths**

If public APIs are available, add distribution tests for lightweight AI commands that do not require real provider secrets, such as:

- `bluenote ai --help` or equivalent help output.
- `bluenote ai config` validation/setup paths with temp `BLUENOTE_ROOT`.
- `bluenote ai queue` on an initialized root.

Do not add tests that require external provider network calls or real secrets.

**Step 3: Run test — confirm it fails**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: FAIL because `bluenote ai` is not implemented yet.

**Step 4: Implement minimal AI CLI routing**

- If the old `runAiCli` can be ported as Node-compatible presentation over public core APIs, add a distribution-owned module.
- If it depends on terminal-private or Bun-only code, stop and report the missing boundary instead of copying internals.
- Ensure secret redaction behavior is preserved in errors/logging.

**Step 5: Run tests**

Command:

```sh
npm run build && node tests/run-tests.js
npm run typecheck
```

Expected: PASS, or explicit stop with a missing-public-API finding.

**Step 6: Checkpoint**

Run:

```sh
git status --short
```

Report either implemented files or the stop condition requiring design/plan amendment.

---

## Task 5: Add distribution launcher regression for `tui` and `term`

**Files:**
- Modify: `/root/code/bluenote/tests/run-tests.js`
- Modify if needed: `/root/code/bluenote/src/commands/tui.ts`

**Step 1: Write failing launcher tests**

Add tests using fake daemon metadata and a fake `spawn`/`spawnSync` to prove:

- `bluenote tui` launches `bluenote-term` with no extra legacy CLI command.
- `bluenote term` is an alias for the same launcher path.
- When command args are passed, only post-launch args are passed to the terminal executable.
- The distribution does not run terminal help as a fallback for TUI launch.

Suggested test shape:

```js
async function testTuiAndTermSpawnTerminalClient() {
  const { env } = makeDaemonEnv();
  writeDaemonMetadata(env, { pid: process.pid, url: 'http://127.0.0.1:12345', token: 'test-token', startedAt: new Date().toISOString() });
  const spawned = [];
  const fakeSpawn = (command, args, options) => {
    spawned.push({ command, args, env: options.env });
    const child = new EventEmitter();
    process.nextTick(() => child.emit('exit', 0));
    return child;
  };
  const fakeSpawnSync = () => ({ status: 0, stdout: 'BlueNote packaged TUI runtime available.\n', stderr: '' });
  const binDir = makeTempDir('fake-term-bin');
  const termPath = path.join(binDir, 'bluenote-term');
  writeExecutable(termPath);
  const launchEnv = { ...env, PATH: `${binDir}${path.delimiter}${env.PATH || ''}`, BLUENOTE_CLIENT_MODE: 'path' };

  const tui = await runCli(['tui'], { env: launchEnv, spawn: fakeSpawn, spawnSync: fakeSpawnSync });
  assert.equal(tui.code, 0);
  const term = await runCli(['term', '--probe-only-test'], { env: launchEnv, spawn: fakeSpawn, spawnSync: fakeSpawnSync });
  assert.equal(term.code, 0);

  assert.equal(spawned[0].command, termPath);
  assert.deepEqual(spawned[0].args, []);
  assert.equal(spawned[0].env.BLUENOTE_DAEMON_URL, 'http://127.0.0.1:12345');
  assert.equal(spawned[1].command, termPath);
  assert.deepEqual(spawned[1].args, ['--probe-only-test']);
}
```

**Step 2: Run test — confirm current behavior**

Command:

```sh
npm run build && node tests/run-tests.js
```

Expected: If it already passes, preserve it as regression coverage. If it fails, fix `src/commands/tui.ts` minimally.

**Step 3: Implement if needed**

Only change `/root/code/bluenote/src/commands/tui.ts` if the regression exposes incorrect argument forwarding or legacy-help fallback behavior.

**Step 4: Run tests**

Command:

```sh
npm run build && node tests/run-tests.js
npm run typecheck
```

Expected: PASS.

**Step 5: Checkpoint**

Run:

```sh
git status --short
```

Report changed files and verification output.

---

## Task 6: Make `bluenote-term` TUI-only at public command API and bin

**Files:**
- Modify: `/root/code/bluenote-term/packages/term/src/command.ts`
- Modify: `/root/code/bluenote-term/packages/term/src/command.d.ts`
- Modify if needed: `/root/code/bluenote-term/packages/term/bin/bluenote-term.js`
- Test: `/root/code/bluenote-term/tests/unit/command-api.test.ts`
- Test: `/root/code/bluenote-term/tests/integration/cli-help.test.ts`
- Test: other terminal CLI tests only as needed to remove/relocate legacy assumptions.

**Step 1: Write failing tests**

Add/update tests so:

- `runTuiCommand([])` calls the provided `tuiRunner` and returns its exit code.
- `runTuiCommand(['--help'])` prints TUI-only help and does not contain `new`, `list`, `archive`, `delete`, `rebuild`, or `ai` as note CLI commands.
- `runCommand(['new'])`, if kept temporarily, returns a migration error: `Use bluenote new; bluenote-term is TUI-only.`
- If `runCommand` is removed from public typings, tests assert the package export no longer advertises it.

Preferred direction: remove `runCommand` from the public type surface if no in-repo consumers require it. If removal causes too much test churn, keep a narrowed compatibility wrapper that only delegates `tui`/empty args and rejects note commands with migration guidance.

**Step 2: Run targeted tests — confirm fail**

Command:

```sh
bun test tests/unit/command-api.test.ts tests/integration/cli-help.test.ts
```

Expected: FAIL because current API/help still supports or advertises legacy CLI behavior.

**Step 3: Implement TUI-only command API**

In `/root/code/bluenote-term/packages/term/src/command.ts`:

- Keep `runTuiCommand`.
- Ensure empty args launch TUI through `tuiRunner`.
- Keep `--help`, `--version`, `--probe-tui-runtime`, `--check-daemon`, `--daemon-url`, `--daemon-token` behavior.
- Remove `runDefaultCli` and any dynamic import of `./cli/entry` from this public command module.
- Remove or narrow `runCommand` so note-management commands cannot run.
- Update help title from `Usage: bluenote tui [options]` to `Usage: bluenote-term [options]` unless called through distribution-specific docs later require otherwise.

In `/root/code/bluenote-term/packages/term/src/command.d.ts`:

- Remove `cliRunner` from `RunTuiCommandOptions` if no longer used.
- Remove `runCommand` declaration, or declare only the narrowed compatibility wrapper if retained.

**Step 4: Run targeted tests — confirm pass**

Command:

```sh
bun test tests/unit/command-api.test.ts tests/integration/cli-help.test.ts
```

Expected: PASS.

**Step 5: Run broader terminal checks**

Command:

```sh
bun run typecheck
bun test
```

Expected: PASS, or clear remaining test drift for Task 7.

**Step 6: Checkpoint**

Run:

```sh
git status --short
```

Report changed files and verification output.

---

## Task 7: Remove or rehome terminal-owned CLI tests/docs assumptions

**Files:**
- Modify: `/root/code/bluenote-term/README.md`
- Modify if needed: `/root/code/bluenote-term/AGENTS.md`
- Modify terminal tests that assert terminal-owned note CLI command presentation.
- Do not delete core/TUI tests that still verify terminal behavior or core behavior.

**Step 1: Write/adjust docs contract tests**

Update existing terminal docs/help tests so they assert:

- README describes `@lordierclaw/bluenote-term` as TUI-only.
- README points note-management CLI users to `bluenote`.
- README no longer presents `bun run ./bin/bn.ts new/list/show/...` as the main terminal package command surface.
- Package command API examples use `runTuiCommand`, not `runCommand` for note commands.

**Step 2: Run tests — confirm fail before docs changes**

Command:

```sh
bun test tests/unit/package-metadata.test.ts tests/integration/cli-help.test.ts tests/unit/command-api.test.ts
```

Expected: FAIL on stale docs/help assertions.

**Step 3: Update docs and stale tests**

- Update `bluenote-term/README.md` role and examples.
- Keep source-development notes if `bin/bn.ts` remains as a dev-only harness, but label it explicitly as legacy/internal or remove examples that conflict with TUI-only package ownership.
- Update `bluenote-term/AGENTS.md` if it still says terminal owns CLI command presentation.
- For integration/e2e tests under `bluenote-term/tests/integration/cli-*` and `tests/e2e/cli-*`, decide whether they are now testing core CLI semantics that should move to `bluenote` or remain as lower-level historical coverage. Do not delete broad coverage blindly; rehome or narrow only the tests that block the TUI-only public package contract.

**Step 4: Run terminal tests**

Command:

```sh
bun test
bun run typecheck
```

Expected: PASS or an explicit list of tests that need migration to distribution repo in Task 8.

**Step 5: Checkpoint**

Run:

```sh
git status --short
```

Report changed files and verification output.

---

## Task 8: Move critical CLI workflow coverage to distribution and trim terminal legacy coverage

**Files:**
- Modify: `/root/code/bluenote/tests/run-tests.js`
- Modify/remove only stale public-package CLI tests in `/root/code/bluenote-term/tests/integration/` and `/root/code/bluenote-term/tests/e2e/`.
- Do not remove core package tests or TUI tests.

**Step 1: Identify stale terminal CLI tests**

List terminal tests that call the old terminal CLI entrypoint for note-management behavior:

```sh
bun test tests/integration/cli-new.test.ts tests/integration/cli-list-show.test.ts tests/integration/cli-search.test.ts tests/integration/cli-archive.test.ts tests/integration/cli-delete.test.ts tests/integration/cli-edit.test.ts tests/integration/cli-rebuild.test.ts tests/e2e/cli-storage-ux-workflow.test.ts --dry-run
```

If Bun has no `--dry-run`, use file inspection instead.

**Step 2: Add equivalent distribution coverage before trimming terminal tests**

Extend `/root/code/bluenote/tests/run-tests.js` only where Task 1 did not already cover behavior. Required coverage before any terminal test removal:

- create draft and normal note
- list default/drafts/all
- show body
- search excerpt
- edit via fake `$EDITOR`
- archive normal only
- delete with `--force`
- rebuild validation success

**Step 3: Run distribution tests**

Command:

```sh
cd /root/code/bluenote && npm run build && node tests/run-tests.js
```

Expected: PASS.

**Step 4: Trim terminal tests only after distribution coverage exists**

- Remove tests that only prove public terminal package note CLI command ownership.
- Keep tests that exercise core behavior directly or terminal/TUI-specific behavior.
- If a terminal helper such as `tests/helpers/run-cli.ts` remains needed for internal dev/test coverage, document it as internal and ensure public package help does not advertise it.

**Step 5: Run terminal tests**

Command:

```sh
cd /root/code/bluenote-term && bun test
```

Expected: PASS.

**Step 6: Checkpoint**

Run status in both repos:

```sh
git -C /root/code/bluenote status --short
git -C /root/code/bluenote-term status --short
```

Report changed files and verification output.

---

## Task 9: Package-boundary and install-smoke verification

**Files:**
- Modify tests/scripts only if verification exposes a real gap.

**Step 1: Run repo-local gates**

Commands:

```sh
cd /root/code/bluenote && npm run check
cd /root/code/bluenote-term && bun run check
```

Expected: PASS.

**Step 2: Verify distribution command smoke**

Commands:

```sh
cd /root/code/bluenote
node dist/bin.js --help
node dist/bin.js version
TMP_ROOT=$(mktemp -d)
BLUENOTE_ROOT="$TMP_ROOT" node dist/bin.js init
BLUENOTE_ROOT="$TMP_ROOT" node dist/bin.js new --path note --title "Smoke" "Smoke body"
BLUENOTE_ROOT="$TMP_ROOT" node dist/bin.js list
rm -rf "$TMP_ROOT"
```

Expected:

- help includes note commands and `tui`/`term`
- version prints package version
- init/new/list succeed

**Step 3: Verify terminal package TUI-only smoke**

Commands:

```sh
cd /root/code/bluenote-term
bun run build:package-runtime
node packages/term/bin/bluenote-term.js --help
node packages/term/bin/bluenote-term.js --version
node packages/term/bin/bluenote-term.js new || true
```

Expected:

- help is TUI-only and does not list legacy note CLI commands
- version prints package version
- `new` does not run note creation; it prints migration guidance or a TUI-only error

**Step 4: Verify package boundaries**

Commands:

```sh
cd /root/code/bluenote
npm pack --dry-run --json
node -e "const fs=require('fs'); const bad=['bluenote-term/src','bluenote-term/dist','@opentui/core','Bun']; const files=fs.readdirSync('dist',{recursive:true}).filter(f=>String(f).endsWith('.js')); for (const f of files) { const s=fs.readFileSync('dist/'+f,'utf8'); for (const b of bad) if (s.includes(b)) throw new Error(f+' contains '+b); }"
```

Expected: PASS; distribution package does not include forbidden terminal/OpenTUI/Bun imports.

**Step 5: Final status**

Commands:

```sh
git -C /root/code/bluenote status --short
git -C /root/code/bluenote-term status --short
git -C /root/code/bluenote-core status --short
git -C /root/code/bluenote-webui status --short
```

Expected: only scoped changes in `bluenote` and `bluenote-term`, plus parent `.agent/*` local workspace notes.

---

## Task 10: Auto-clean up stale legacy portable `bn` binaries during built-client repair

**Files:**
- Modify: `/root/code/bluenote/src/commands/tui.ts`
- Modify: `/root/code/bluenote/src/utils/built-tui-install.ts`
- Modify: `/root/code/bluenote/src/utils/command-discovery.ts` only if a reusable PATH-helper is needed
- Modify: `/root/code/bluenote/tests/run-tests.js`
- Modify docs/help only if user-facing cleanup messaging changes materially

**Goal:** When `bluenote tui` detects an installed PATH `bn`/`bluenote-term` client that is actually a stale legacy portable TUI binary, aggressively clean it up **only when it is clearly identified as the old BlueNote portable binary and only in locations the current user can safely mutate**, then continue by installing the managed built client.

**Safety constraints:**

- Never delete arbitrary PATH entries or npm-managed shims by filename alone.
- Only remove a stale binary when all of these are true:
  - the candidate is discovered from PATH while resolving the TUI client for `auto` mode repair,
  - the runtime probe failed,
  - the candidate path basename is the legacy portable executable name for that platform (`bn` or `bn.exe`),
  - the file contents or nearby release markers identify it as a BlueNote portable artifact (for example adjacent `sql-wasm.wasm`, `README.txt`, and/or portable-release readme text),
  - the directory is user-writable and not an npm global shim directory for the active install,
  - the path is not the currently executing `bluenote` distribution binary.
- If any safety check is inconclusive, do **not** delete. Fall back to warning + managed built-client install.

**Step 1: Write failing tests first**

Add focused tests in `/root/code/bluenote/tests/run-tests.js` around the existing TUI auto-install coverage:

- A fixture helper that creates a legacy portable package directory containing:
  - `bn` (or platform-equivalent legacy name),
  - `README.txt` with the old portable release wording,
  - `sql-wasm.wasm`.
- A test where PATH resolution finds that stale `bn`, `--probe-tui-runtime` fails, cleanup is allowed, and `bluenote tui --smoke`:
  - removes the stale legacy binary,
  - installs the managed built client,
  - launches the managed built client instead.
- A negative test where probe fails for a PATH binary that is **not** clearly the legacy portable artifact; verify it is **not** deleted and the command emits a warning before falling back.
- A negative test where the candidate lives under an npm-managed bin/shim location fixture; verify it is **not** deleted.

Suggested assertions:

- stale legacy `bn` no longer exists after repair
- managed built `bluenote-term` exists and is launched
- stderr includes an explicit cleanup message such as `Removed stale legacy BlueNote portable binary:`
- non-deletable candidates remain on disk and emit `Found stale-looking PATH client but skipped automatic cleanup:` or equivalent

**Step 2: Run RED test**

Command:

```sh
cd /root/code/bluenote && npm run build && node tests/run-tests.js
```

Expected: FAIL because no cleanup logic exists yet.

**Step 3: Implement the minimal cleanup boundary**

Add a narrow cleanup helper near the built-client repair path. Preferred shape:

```ts
type LegacyPortableCleanupResult = {
  removed: boolean
  skippedReason?: string
  removedPath?: string
}

function tryRemoveStaleLegacyPortableClient(...): LegacyPortableCleanupResult
```

Implementation guidance:

- Keep detection local to the distribution repo; do not add cleanup logic to `bluenote-term` install scripts.
- Inspect the PATH candidate’s directory for portable-release markers before deleting.
- Treat deletion as best-effort: if removal fails, report the reason and continue with built-client install instead of aborting.
- Preserve the existing `bluenote tui` self-healing flow: probe PATH client → optional safe cleanup → install managed built client → launch managed client.

**Step 4: Run GREEN tests**

Commands:

```sh
cd /root/code/bluenote && npm run build && node tests/run-tests.js
cd /root/code/bluenote && npm run check
```

Expected: PASS.

**Step 5: Smoke the release-repair behavior**

Add or run a targeted smoke path proving the built-client repair still writes the persisted built-client mode config and prefers the managed client after cleanup.

**Step 6: Checkpoint**

Run:

```sh
git -C /root/code/bluenote status --short
```

Report changed files, exact cleanup safety rules implemented, and verification output.

---

## Final review checklist

Before declaring the branch ready:

- Spec review confirms:
  - `bluenote` owns note-management CLI commands.
  - `bluenote-term` public command/bin behavior is TUI-only.
  - `bluenote tui` and `bluenote term` launch/spawn terminal TUI behavior.
  - No storage/search/AI semantics were duplicated or changed outside command presentation.
- Quality review confirms:
  - no terminal internals imported by distribution.
  - no dead legacy `runCommand` path routes note commands in the terminal package.
  - docs/help agree across both repos.
- Parent-session verification reruns:
  - `cd /root/code/bluenote && npm run check`
  - `cd /root/code/bluenote-term && bun run check`
  - smoke commands from Task 9.
  - stale-legacy-binary repair coverage from Task 10 when that task is in scope.

## Execution mode options

After this plan is approved, execute with the superpowers subagent-driven loop:

1. implementer subagent for one task
2. spec-reviewer subagent
3. code-quality reviewer subagent
4. parent reruns tests and accepts/rejects
5. repeat for next task

Manual execution is also possible if the user chooses to run tasks themselves.

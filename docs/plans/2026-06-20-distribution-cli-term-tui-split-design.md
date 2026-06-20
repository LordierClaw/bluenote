# Distribution CLI / Terminal TUI Ownership Split Design

## Status

Draft for approval. This design responds to the new requirement that `bluenote` becomes the normal note-management CLI while `@lordierclaw/bluenote-term` becomes TUI-only.

The previous active release task is paused. This design is the current source of truth for the command-ownership refactor after parent `.agent/CURRENT_TASK.md` was updated to `BN-DIST-CLI-TERM-TUI-SPLIT`.

## Problem

Two user-facing command contracts currently conflict:

1. Users expect `bluenote tui` and `bluenote term` from the distribution CLI to launch the TUI after installing the terminal package.
2. `bluenote-term` still contains the original note-management CLI and help surface, so an installed or linked terminal package can still expose `init`, `new`, `list`, `show`, `search`, `edit`, `archive`, `delete`, `rebuild`, and `ai` as terminal-owned commands.

This makes ownership unclear: the distribution CLI is the official app entrypoint, but the terminal package still owns much of the command-line note workflow.

## Goals

- Make `bluenote` / `bn` the normal CLI entrypoint for note management.
- Keep `bluenote-term` focused on terminal UI launch/probe behavior and reusable TUI command APIs.
- Ensure `bluenote tui` and `bluenote term` launch the TUI, never the legacy terminal CLI help surface.
- Preserve `bluenote` runtime compatibility: Node `>=16.14 <17 || >=18`; no Bun/OpenTUI imports in distribution startup/help/doctor/note commands.
- Keep note model, storage, search, AI semantics in `@lordierclaw/bluenote-core`; the distribution CLI should only provide command presentation and orchestration.
- Update README-first documentation and command help so users learn `bluenote <note-command>` for CLI workflows and `bluenote tui` for TUI workflows.
- Cover the split with tests before implementation changes.

## Non-goals

- No change to the plain Markdown note storage contract.
- No change to `.data` app-state semantics.
- No WebUI changes.
- No daemon protocol expansion beyond what current TUI launch/probe behavior already needs.
- No release workflow continuation in this task.
- No attempt to make `bluenote-term` own note-management CLI compatibility forever.

## Chosen approach

Move the note-management CLI presentation into `/root/code/bluenote` and narrow `/root/code/bluenote-term` to TUI-only behavior.

### Why this approach

- It directly matches repo ownership: `bluenote` owns top-level routing/help/distribution, while `bluenote-term` owns terminal layout/OpenTUI behavior.
- It keeps `bluenote` lightweight by using public `@lordierclaw/bluenote-core` APIs instead of importing terminal internals.
- It avoids expanding `bluenote-core` into a user-facing CLI presentation package.
- It prevents the distribution `tui`/`term` launcher from accidentally invoking a legacy terminal CLI command path.

## Architecture

### Distribution CLI (`/root/code/bluenote`)

`bluenote` becomes the owner of the normal note-management command surface:

- `init`
- `new`
- `list`
- `show`
- `search`
- `edit`
- `archive`
- `delete`
- `rebuild`
- `ai` where the needed AI command APIs are already public and Node-compatible
- existing distribution commands: `tui`, `term`, `web`, `daemon`, `doctor`, `version`, `help`

Implementation should add Node-compatible command modules in `bluenote/src/commands/` backed by public `@lordierclaw/bluenote-core` exports. Where current terminal CLI behavior uses terminal-owned helpers such as external editor/clipboard adapters, those helpers must either be reimplemented as distribution-owned Node-compatible adapters or use public package/runtime APIs that do not import OpenTUI/Bun-only code.

`bluenote/src/cli.ts` should route note-management commands before unknown-command handling. Help text should document the note commands as first-class distribution commands.

### Terminal package (`/root/code/bluenote-term`)

`@lordierclaw/bluenote-term` keeps:

- TUI launch logic.
- TUI runtime probe behavior.
- daemon health/capabilities probe behavior needed by `bluenote doctor`.
- the public `runTuiCommand` API.
- the `bluenote-term` executable as a TUI launcher/prober.

It should stop advertising or routing normal note-management CLI commands. The broader `runCommand` API should be removed or reduced so it cannot route legacy note commands. If compatibility messaging is needed, non-TUI note commands should fail with a short migration error such as: `Use bluenote <command>; bluenote-term is TUI-only.`

The `bluenote-term` bin should treat no arguments as TUI launch, `--help` as TUI launcher help, `--version` as package version, `--probe-tui-runtime` as runtime probe, and `--check-daemon`/daemon flags as daemon probe. It should not print the old full note-management CLI help.

### TUI launch from distribution

`bluenote tui` and `bluenote term` should keep using public package executable discovery or built-client discovery. The spawned terminal command should receive only the post-`tui`/`term` arguments. The distribution should not invoke any terminal-owned note CLI path.

Tests must prove:

- `bluenote tui` resolves and spawns `bluenote-term` with TUI args under daemon-ready conditions.
- `bluenote term` behaves as an alias.
- A linked/installed `bluenote-term` whose default help no longer contains legacy note commands cannot surface that old help through `bluenote tui`.
- Distribution note commands work without a terminal package installed.

## Command contract

### Distribution help

`bluenote --help` should show both core note commands and distribution/client commands. The top-level examples should guide users toward:

```sh
bluenote init
bluenote new "body"
bluenote list
bluenote show <key|path>
bluenote tui
```

### Terminal help

`bluenote-term --help` should be TUI-specific:

```text
Usage: bluenote-term [options]

Launch the BlueNote terminal UI workspace.
```

It may mention that note-management commands live under `bluenote`, but it should not list legacy command syntax as if `bluenote-term` owns it.

## Data flow

Normal note CLI flow after the refactor:

```text
user -> bluenote/bin -> bluenote/src/cli.ts -> distribution command module -> @lordierclaw/bluenote-core public API -> Markdown/.data
```

TUI launch flow after the refactor:

```text
user -> bluenote tui|term -> daemon status/readiness -> discover built/PATH bluenote-term -> spawn bluenote-term -> TUI runtime
```

Direct terminal-package flow:

```text
user -> bluenote-term -> TUI command parser -> TUI launch/probe only
```

## Error handling

- Distribution note commands should preserve existing `AppError`/`UsageError` formatting semantics from the old terminal CLI where they remain appropriate.
- Unknown note-command flags should keep stable usage guidance, updated to say `bluenote ...` rather than `bn ...` when emitted by the distribution CLI.
- Terminal-package non-TUI commands should fail explicitly with a migration message rather than silently falling through to old help.
- `bluenote tui` should keep actionable diagnostics for daemon-not-running, missing client, broken TUI runtime, and built-client install failures.

## Testing strategy

Use TDD per task.

### Distribution repo tests

- Add failing tests for `bluenote init/new/list/show/search/edit/archive/delete/rebuild` routing from `bluenote/src/cli.ts` or the real built `dist/bin.js` where practical.
- Add an e2e-style workflow proving distribution note commands operate on a temporary BlueNote root without `bluenote-term` installed.
- Add `tui` and `term` launcher tests using fake daemon metadata and fake `bluenote-term` executable/spawn hooks to prove the distribution launches the TUI command path.
- Update help tests so `bluenote --help` documents note commands and `tui`/`term` as client launchers.

### Terminal repo tests

- Add failing tests that `runTuiCommand([])` launches the TUI runner.
- Add failing tests that `runTuiCommand(["--help"])` shows only TUI launcher help and not note-management commands.
- Add failing tests that legacy non-TUI command args do not route note-management commands through `bluenote-term`.
- Update package/API tests to remove or deprecate `runCommand` if it is no longer part of the TUI-only public contract.

### Verification gates

- `/root/code/bluenote`: `npm run check`, plus smoke `node dist/bin.js --help`, `node dist/bin.js init` in a temp root, and launcher tests.
- `/root/code/bluenote-term`: `bun run check` or targeted `bun test`/`bun run typecheck` slices plus package runtime smoke where available.
- Package-boundary check: ensure `bluenote` imports only public `@lordierclaw/bluenote-core` APIs and does not import `bluenote-term/src/*`, `dist/*`, OpenTUI, or Bun-only modules.

## Documentation updates

- `bluenote/README.md`: describe `bluenote` as the normal CLI and TUI launcher; include note-management examples.
- `bluenote/AGENTS.md` and docs only if ownership wording needs tightening.
- `bluenote-term/README.md`: remove terminal-owned CLI command surface and describe the package as TUI-only.
- `bluenote-term/AGENTS.md` only if the ownership description is stale.

## Migration / compatibility

This is an intentional ownership change. Direct `bluenote-term new/list/show/...` usage should be considered legacy and should point users to `bluenote new/list/show/...`.

Because `bluenote` currently ships only distribution commands, the implementation should preserve current terminal CLI output and behavior as much as practical when porting it, but update command names in help/errors to `bluenote`/`bn` as appropriate.

## Risks and mitigations

- **Risk: duplicating business logic in `bluenote`.** Mitigation: only port presentation/parsing; keep all storage/search/AI behavior in public core APIs.
- **Risk: Node 16 breakage from terminal code.** Mitigation: do not import terminal package code into `bluenote`; use Node-compatible adapters and dynamic imports only where already required.
- **Risk: AI CLI has hidden terminal/Bun assumptions.** Mitigation: inspect AI command dependencies before porting; if missing public core APIs are found, pause and add a narrow core API task instead of copying internals.
- **Risk: installed package still exposes old help from an older `bluenote-term`.** Mitigation: distribution launch tests should exercise current package behavior; docs should tell users to upgrade `@lordierclaw/bluenote-term` if PATH discovery finds an old package.

## Approval gate

Implementation should not start until this design is approved. After approval, create a task-by-task implementation plan with TDD steps and execute via subagent-driven development unless the user chooses manual execution.

# Installable Distribution CLI and Client Discovery Design

## Status

Approved baseline for BN-INSTALL-ARCH-001.

## Problem

The previous distribution CLI work proved that sibling repositories can be composed through public package exports during local development. That is not enough for the real user problem: a user needs a clear way to install BlueNote, install whichever client they prefer, and launch everything through the `bluenote` distribution CLI without relying on a development checkout or bundled local `file:` dependencies.

## Goals

- Make `@lordierclaw/bluenote` the installable distribution CLI and daemon entrypoint.
- Let users install optional clients independently with npm global installs.
- Discover installed clients through standard PATH/package-manager behavior.
- Make `bluenote doctor` explain what is installed, missing, broken, and daemon/config/AI-ready.
- Keep client packages optional; installing the distribution CLI must not require installing WebUI, TUI, Bun, or OpenTUI.
- Preserve Linux and Windows compatibility by avoiding shell-specific linking assumptions.
- Verify with real manual local install testing in an isolated temporary environment, not only unit tests.

## Non-goals

- No explicit client-linking registry in the first implementation.
- No distribution-managed `client install` command in the first implementation.
- No cloud/server sync.
- No storage, search, note-format, or AI semantic changes.
- No WebUI or TUI rewrite.
- No direct imports of sibling `src/*` or `dist/*` internals.
- No committed manual verification logs, temp-prefix scripts, machine-specific paths, or local QA transcripts.

## Selected architecture: Option B only

Users install independent global npm packages:

```sh
npm install -g @lordierclaw/bluenote
npm install -g bluenote-webui
npm install -g bluenote-term
```

`@lordierclaw/bluenote` discovers optional clients through PATH/package resolution. The first implementation should not add an explicit `client link` fallback or plugin registry. Keeping only Option B makes the behavior simple, predictable, and testable.

## Package responsibilities

### `@lordierclaw/bluenote`

Owns:

- `bluenote` and `bn` bins.
- top-level command routing.
- daemon lifecycle command surface.
- user config discovery.
- client discovery through PATH/package metadata.
- `doctor` reporting.
- launching installed clients with daemon connection environment.

Release behavior:

- Must remain Node `>=16.14 <17 || >=18` compatible.
- Must not depend on `bluenote-webui` or `bluenote-term` as required runtime dependencies.
- May depend on `@lordierclaw/bluenote-core` for daemon-side core behavior.
- Must not import Bun/OpenTUI or WebUI-heavy modules in lightweight commands.

### `bluenote-webui`

Owns:

- public `bluenote-webui` executable.
- local browser UI client.
- daemon API client usage.

Normal user mode:

- Receives daemon connection info from environment variables or explicit CLI flags.
- Talks to the daemon over localhost HTTP.
- Does not directly own storage/search/AI behavior in normal launched mode.

### `bluenote-term`

Owns:

- public `bluenote-term` executable.
- Bun/OpenTUI terminal UI client.
- daemon API client usage.

Normal user mode:

- Receives daemon connection info from environment variables or explicit CLI flags.
- Talks to the daemon over localhost HTTP.
- Does not directly own storage/search/AI behavior in normal launched mode.

### `@lordierclaw/bluenote-core`

Owns:

- note model.
- storage layout.
- sidecar metadata.
- search semantics/indexes.
- AI config/queue/provider semantics.
- daemon-side business logic.

Must not depend on distribution or clients.

## Public executable names

The stable client executable names for PATH discovery are:

```text
bluenote-webui
bluenote-term
```

The distribution CLI should discover these commands with a cross-platform PATH lookup strategy instead of assuming sibling package installs.

## Daemon model

The daemon is the owner of core state/API. Clients should not access note storage directly in normal mode.

Initial transport:

- localhost HTTP.
- random/free port.
- endpoint and token recorded in user config/state.
- token is never printed by `doctor`.

Initial client launch behavior:

- `bluenote web` checks whether the daemon is running.
- `bluenote tui` checks whether the daemon is running.
- If the daemon is stopped or unreachable, the command fails clearly and tells the user to run:

```sh
bluenote daemon start
```

No client command auto-starts the daemon in the baseline.

## Daemon connection handoff

When launching clients, `bluenote` passes daemon connection data with environment variables by default:

```text
BLUENOTE_DAEMON_URL=http://127.0.0.1:<port>
BLUENOTE_DAEMON_TOKEN=<redacted token value>
```

Clients must also accept explicit flags for manual use and verification:

```sh
bluenote-webui --daemon-url <url> --daemon-token <token>
bluenote-term --daemon-url <url> --daemon-token <token>
```

The CLI should never print the token in ordinary output, errors, or doctor reports.

## Doctor design

`bluenote doctor` should be organized into sections. Exact wording can evolve, but the information model should cover:

```text
BlueNote doctor

Distribution
  command: ok
  version: ...
  node: ok | unsupported
  config: ...

Daemon
  status: running | stopped | stale | unreachable | not implemented
  endpoint: http://127.0.0.1:<port> | unavailable
  pid: ... | unavailable
  token: present | missing
  health: ok | failed | not checked

Clients
  bluenote-webui: found | missing | broken
    path: ...
    version: ... | unavailable
    daemon handshake: ok | failed | not checked
  bluenote-term: found | missing | broken
    path: ...
    version: ... | unavailable
    bun: available | missing | not required for doctor
    daemon handshake: ok | failed | not checked

AI
  provider: configured | not configured
  secrets: not printed
```

Doctor must be accurate rather than optimistic. Missing optional clients are not distribution failures, but should be visible and actionable.

## Testing and verification strategy

### Automated verification

Automated tests should cover:

- `--help`, `version`, and `doctor` run without importing or requiring WebUI/TUI packages.
- PATH discovery reports missing clients accurately.
- PATH discovery reports found clients accurately using test-controlled fake executables.
- Doctor never prints daemon tokens or AI secrets.
- `bluenote web` and `bluenote tui` fail with a clear daemon-start message when no daemon is running.
- Client command launch passes `BLUENOTE_DAEMON_URL` and `BLUENOTE_DAEMON_TOKEN` to child processes when a daemon record exists.
- Windows-style executable discovery is covered at the utility level where practical, including PATHEXT behavior.
- Node 16.14 smoke commands still work.

### Manual local verification

Final verification must include a real end-user-style local install run using temporary isolated locations. This evidence is local-only and must not be committed.

Manual verification must use:

- a temporary npm prefix,
- temporary BlueNote config/data/cache roots,
- a shell PATH scoped to the temporary prefix `bin`,
- packed/local artifacts installed into that prefix,
- cleanup proof after the run.

Minimum manual flow:

1. Create temporary npm prefix and temporary config/data/cache roots.
2. Install the distribution package into the temporary prefix as an end user would.
3. Run with PATH scoped to the temporary prefix `bin`.
4. Verify `bluenote --help`, `bluenote version`, and `bluenote doctor` before optional clients are installed.
5. Install `bluenote-webui` into the same temporary prefix.
6. Verify `bluenote doctor` discovers `bluenote-webui` through PATH/package metadata.
7. Install `bluenote-term` into the same temporary prefix.
8. Verify `bluenote doctor` discovers `bluenote-term`, including Bun/runtime readiness reporting where applicable.
9. Verify `bluenote web` and `bluenote tui` fail clearly when the daemon is not running and instruct the user to run `bluenote daemon start`.
10. For the daemon milestone, verify `daemon start/status/stop`, endpoint/token creation, health/capabilities, and client environment handoff.
11. Stop any daemon/manual-test process.
12. Remove the temporary npm prefix and temporary config/data/cache roots.
13. Prove no project-owned manual-test processes remain.

Manual verification artifacts that must stay local-only:

- temp-prefix logs,
- cleanup scripts/checklists,
- manual QA transcripts,
- local machine paths,
- temp config snapshots,
- environment-specific debugging notes.

Versioned docs may document the official install behavior and the requirement for manual verification, but must not store local manual verification outputs.

## Milestone sequence

### Milestone 1: install/discovery/doctor contract

- Convert the distribution release model so WebUI/TUI are optional global clients, not required distribution dependencies.
- Add cross-platform PATH client discovery for `bluenote-webui` and `bluenote-term`.
- Update `doctor` to report distribution, daemon, clients, config, and AI readiness accurately.
- Update client packages to expose stable public executable names if missing.
- Add automated tests for missing/found clients and daemon-not-running client command behavior.
- Add local-only manual verification workflow and perform it before signoff.

### Milestone 2: minimal real daemon

- Implement `bluenote daemon start/status/stop`.
- Store endpoint/token/PID metadata in user config/state.
- Add localhost HTTP health/version/capabilities endpoints.
- Keep daemon local-only and single-user.
- Add lifecycle cleanup and stale process handling.

### Milestone 3: client daemon mode

- Make WebUI accept daemon environment variables and flags.
- Make TUI accept daemon environment variables and flags.
- Route normal launched client mode through daemon HTTP API.
- Keep direct storage access out of normal client launch paths.

## Open risks

- npm global executable discovery differs between shells and operating systems; tests need fake PATH coverage and manual Linux verification.
- Windows manual verification may require a later dedicated environment if not available in this session.
- TUI still depends on Bun/OpenTUI; distribution doctor should report that accurately without failing lightweight checks.
- The exact boundary between daemon protocol types and core APIs may need refinement before Milestone 2.
- Existing local `file:` dependency development setup is still useful for contributors, but release docs must distinguish it from end-user global installs.

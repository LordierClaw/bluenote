# BlueNote Distribution CLI

`@lordierclaw/bluenote` is the official BlueNote distribution package and top-level command router. It keeps the binary thin: core note behavior stays in `@lordierclaw/bluenote-core`, the terminal UI stays in `bluenote-term`, and the local browser UI stays in `bluenote-webui`.

## Requirements

- Node.js `>=16.14 <17 || >=18` for distribution commands.
- npm 8-compatible local development.
- Optional UI clients are discovered as executables on `PATH`: `bluenote-webui` and `bluenote-term`.
- Bun is required by the terminal client package, but not by lightweight distribution commands.

## End-user install model

Install the official app entrypoint first, then install whichever UI clients you want. The core package is a runtime dependency of the distribution/clients; end users normally do **not** run `npm install -g @lordierclaw/bluenote-core` separately.

```sh
npm install -g @lordierclaw/bluenote
bluenote doctor

# Optional clients. Install one or both depending on how you want to use BlueNote.
npm install -g bluenote-webui
npm install -g bluenote-term

# Confirm the distribution can find the clients on PATH.
bluenote doctor
```

The distribution CLI does not bundle WebUI/TUI. `bluenote doctor` reports whether optional client executables are present on `PATH` and whether Bun is available for the terminal client.

### Install from sibling source checkouts

When installing from these repositories before all packages are published, link the distribution CLI first, then add optional clients. The package installs its pinned `@lordierclaw/bluenote-core` dependency during `npm ci`, so a separate global `bluenote-core` link is not needed for normal app setup.

```sh
# 1. Distribution CLI: the app entrypoint users run as bluenote/bn.
cd ../bluenote
npm ci --include=dev
npm run check
npm link
bluenote doctor

# 2. Optional browser client.
cd ../bluenote-webui
npm ci --include=dev
npm run check
npm link
bluenote doctor

# 3. Optional terminal client. Link from the public package workspace.
cd ../bluenote-term
bun install
bun run check
cd packages/term
bun link
cd ../..
bluenote doctor

# 4. Start the daemon before launching clients.
bluenote daemon start
bluenote doctor
bluenote web
# or: bluenote tui
```

Make sure linked npm and Bun commands are visible on `PATH` before running `bluenote doctor`:

```sh
# bash/zsh, current shell
export PATH="$(npm prefix -g)/bin:$HOME/.bun/bin:$PATH"
```

```fish
# fish, permanent user PATH
fish_add_path -U (npm prefix -g)/bin
fish_add_path -U ~/.bun/bin
```

```cmd
:: cmd.exe, current shell
for /f "delims=" %i in ('npm prefix -g') do set "NPM_PREFIX=%i"
if exist "%NPM_PREFIX%\bin" (set "PATH=%NPM_PREFIX%\bin;%USERPROFILE%\.bun\bin;%PATH%") else (set "PATH=%NPM_PREFIX%;%USERPROFILE%\.bun\bin;%PATH%")
```

```powershell
# PowerShell, current shell
$npmPrefix = npm prefix -g
$npmBin = if (Test-Path (Join-Path $npmPrefix "bin")) { Join-Path $npmPrefix "bin" } else { $npmPrefix }
$env:Path = "$npmBin;$HOME\.bun\bin;$env:Path"
```

If you are actively changing `bluenote-core`, run `npm ci --include=dev && npm run check` in `../bluenote-core` before checking the distribution or clients. End-user/source-link setup still runs through the distribution package and client executables.

For release-like dependency modes, prefer published npm versions or pinned immutable Git tags/commits. Do not use moving branch dependencies such as `#main` for release-like installs.

## Commands

```sh
bluenote --help
bluenote version
bluenote doctor
bluenote tui [...args]
bluenote web [...args]
bluenote daemon start
bluenote daemon status
bluenote daemon stop
```

`bn` is exposed as the same binary alias as `bluenote`.

Current command surface:

- `bluenote --help` prints top-level help without importing terminal or web clients.
- `bluenote version` prints the distribution package version and required runtime package versions from package metadata only. Optional client availability is reported by `bluenote doctor`.
- `bluenote doctor` checks platform, Node compatibility, daemon state, optional client executables, and Bun availability for the TUI. It reports token presence without printing token values.
- `bluenote daemon <start|status|stop>` manages a minimal local-only daemon with HTTP `/health` and `/capabilities` endpoints.
- `bluenote web` launches the `bluenote-webui` executable found on `PATH` only when daemon metadata exists, passing daemon connection details through environment variables without printing tokens.
- `bluenote tui` launches the `bluenote-term` executable found on `PATH` only when daemon metadata exists, passing daemon connection details through environment variables without printing tokens.

## Local sibling checkout

Expected local development layout:

```text
../bluenote-core
../bluenote-term
../bluenote-webui
../bluenote
```

Local file dependencies are used for multi-repo development only, not as the end-user install path:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "git+https://github.com/LordierClaw/bluenote-core.git#<pinned-commit-sha>"
  }
}
```

Optional clients are installed separately in end-user and manual-verification flows; they are not required dependencies of `@lordierclaw/bluenote`.

Install order for source checkouts is distribution first, then optional clients. Check `bluenote-core` first only when you are actively changing the core library. At runtime, users launch the app through `bluenote`/`bn`; the distribution starts clients through their public executables (`bluenote-webui`, `bluenote-term`) instead of importing client internals.

## Development checks

```sh
npm install
npm run typecheck
npm run test
npm run build
npm run check
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
```

Baseline CI runs on Node 16.14 and intentionally does not require Bun for basic `--help`, `version`, or `doctor` smoke commands.

## Ownership boundaries

- Core note model, storage layout, search semantics, and AI behavior: `bluenote-core`.
- Terminal layout, keybindings, OpenTUI behavior, and TUI command API: `bluenote-term`.
- Browser UI, localhost server/proxy, and web setup flow: `bluenote-webui`.
- Top-level routing, help, version, doctor, minimal local daemon lifecycle, PATH client discovery/launch, and distribution packaging: `bluenote`.

Cross-repo imports must use public package exports or public package bins only. Do not import sibling `src/*`, `dist/*`, tests, or hidden internals from this repo.

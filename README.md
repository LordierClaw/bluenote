# BlueNote Distribution CLI

`@lordierclaw/bluenote` is the official BlueNote app entrypoint and top-level command router. It exposes the `bluenote` and `bn` binaries, keeps distribution commands lightweight, and launches optional WebUI/TUI clients through their public executables.

## Role in BlueNote

This repo owns:

- top-level `bluenote`/`bn` command routing
- `--help`, `version`, and `doctor`
- minimal local daemon lifecycle and capability reporting
- optional client discovery on `PATH`
- distribution packaging and install guidance

It does not own core note behavior, browser UI implementation, or terminal UI implementation. Those live in `@lordierclaw/bluenote-core`, `@lordierclaw/bluenote-webui`, and `@lordierclaw/bluenote-term`.

## Install

Install the distribution CLI first, then whichever optional clients you want:

```sh
npm install -g @lordierclaw/bluenote
bluenote doctor

# Optional browser UI and terminal UI clients.
npm install -g @lordierclaw/bluenote-webui
npm install -g @lordierclaw/bluenote-term
bluenote doctor
```

The distribution package does not bundle UI clients. `bluenote doctor` reports whether `bluenote-webui` and `bluenote-term` are present on `PATH`, whether Bun is available for the terminal client, and whether the local daemon is running.

Uninstall globally installed app packages with the same scoped names:

```sh
npm uninstall -g @lordierclaw/bluenote
npm uninstall -g @lordierclaw/bluenote-webui
npm uninstall -g @lordierclaw/bluenote-term
```

Run clients through the distribution command after starting the daemon:

```sh
bluenote daemon start
bluenote web
# or
bluenote tui
```

`bn` is the same binary alias as `bluenote`.

## Local development

Expected sibling checkout layout:

```text
../bluenote-core
../bluenote-webui
../bluenote-term
../bluenote
```

Manual source-link setup before all packages are published:

```sh
# 1. Distribution CLI.
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
```

If linked commands are not visible, add npm's global command directory and Bun's command directory to `PATH`:

```sh
export PATH="$(npm prefix -g)/bin:$HOME/.bun/bin:$PATH"
```

```fish
fish_add_path -U (npm prefix -g)/bin
fish_add_path -U ~/.bun/bin
```

```cmd
for /f "delims=" %i in ('npm prefix -g') do set "NPM_PREFIX=%i"
if exist "%NPM_PREFIX%\bin" (set "PATH=%NPM_PREFIX%\bin;%USERPROFILE%\.bun\bin;%PATH%") else (set "PATH=%NPM_PREFIX%;%USERPROFILE%\.bun\bin;%PATH%")
```

```powershell
$npmPrefix = npm prefix -g
$npmBin = if (Test-Path (Join-Path $npmPrefix "bin")) { Join-Path $npmPrefix "bin" } else { $npmPrefix }
$env:Path = "$npmBin;$HOME\.bun\bin;$env:Path"
```

Fast local install/uninstall scripts are available for sibling checkout development:

```sh
./scripts/dev-install-local.sh --all --dry-run
./scripts/dev-install-local.sh --all
./scripts/dev-uninstall-local.sh --all --dry-run
./scripts/dev-uninstall-local.sh --all
```

```powershell
.\scripts\dev-install-local.ps1 -All -DryRun
.\scripts\dev-install-local.ps1 -All
.\scripts\dev-uninstall-local.ps1 -All -DryRun
.\scripts\dev-uninstall-local.ps1 -All
```

Default local install mode links the distribution CLI and WebUI. Add `--tui`/`-Tui` or use `--all`/`-All` to include the Bun-based terminal package from `../bluenote-term/packages/term`. Use `--skip-check`/`-SkipCheck` to skip repo checks and `--dry-run`/`-DryRun` to print commands without changing global links.

For release-like local verification without publishing, pack local artifacts and install them into an isolated temporary npm prefix with separate BlueNote config/data/cache paths:

```sh
./scripts/dev-verify-local.sh --web --dry-run
./scripts/dev-verify-local.sh --web
# Include both optional clients when local package verification is available:
./scripts/dev-verify-local.sh --all
```

```powershell
.\scripts\dev-verify-local.ps1 -Web -DryRun
.\scripts\dev-verify-local.ps1 -Web
# Include both optional clients when local package verification is available:
.\scripts\dev-verify-local.ps1 -All
```

Use `--keep-temp`/`-KeepTemp` to preserve the temporary prefix and isolated state directories for inspection after a verification run.

## Scripts

```sh
npm run typecheck
npm run test
npm run build
npm run check
npm run version:status -- --allow-git-deps
./scripts/dev-install-local.sh --all --dry-run
./scripts/dev-uninstall-local.sh --all --dry-run
./scripts/dev-verify-local.sh --web --dry-run
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
```

`npm run version:status` checks the four sibling package names and versions. By default it rejects release-mode Git dependencies; pass `--allow-git-deps` for the current local-development pinned-Git state.

## Packaging and versions

The package name is `@lordierclaw/bluenote`; published binaries are `bluenote` and `bn`.

The distribution depends on `@lordierclaw/bluenote-core` for headless behavior. Optional clients are installed separately and discovered as `bluenote-webui` and `bluenote-term` executables on `PATH`.

For release-like dependency modes, prefer published npm versions or immutable Git tags/commits. Do not use moving branch dependencies such as `#main` for release-like installs.

## Cross-platform notes

- Supported distribution runtime: Node.js `>=16.14 <17 || >=18`.
- Basic distribution commands do not require Bun.
- The terminal client uses Bun/OpenTUI and should be installed separately.
- The daemon is local-only and passes client connection details through environment variables without printing bearer tokens.
- Use `bluenote doctor` after install/link changes to verify PATH, daemon state, and optional clients.

## Related packages

- `@lordierclaw/bluenote-core`: headless note model, storage, search, AI config/queue/provider behavior, and public core APIs.
- `@lordierclaw/bluenote-webui`: optional local browser client and localhost server/proxy.
- `@lordierclaw/bluenote-term`: optional terminal/TUI client and terminal command API.

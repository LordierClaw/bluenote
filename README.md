# BlueNote Distribution CLI

`@lordierclaw/bluenote` is the official BlueNote app entrypoint and top-level command router. It exposes the `bluenote` and `bn` binaries, keeps distribution commands lightweight, and launches optional WebUI/TUI clients through their public executables.

## Role in BlueNote

This repo owns:

- top-level `bluenote`/`bn` command routing
- `--help`, `version`, and `doctor`
- minimal local daemon lifecycle and capability reporting
- optional client discovery in explicit `auto`, `path`, and `built` runtime modes
- distribution packaging and install guidance

It does not own core note behavior, browser UI implementation, or terminal UI implementation. Those live in `@lordierclaw/bluenote-core`, `@lordierclaw/bluenote-webui`, and `@lordierclaw/bluenote-term`.

## Install

For non-technical users, use the installer scripts. They are interactive by default and safely select only the distribution CLI (`@lordierclaw/bluenote`) unless you opt into the WebUI, built TUI, or all clients. The default registry is npmjs; GitHub Packages is available when you have token/auth configured.

Linux/macOS:

```sh
./scripts/install.sh
./scripts/install.sh --dry-run
./scripts/install.sh --yes
./scripts/install.sh --with-web
./scripts/install.sh --with-tui
./scripts/install.sh --all
./scripts/install.sh --registry github
./scripts/uninstall.sh --dry-run
./scripts/uninstall.sh
```

Windows PowerShell:

```powershell
.\scripts\install.ps1 -Interactive
.\scripts\install.ps1 -DryRun
.\scripts\install.ps1 -Yes
.\scripts\install.ps1 -WithWeb
.\scripts\install.ps1 -WithTui
.\scripts\install.ps1 -All
.\scripts\install.ps1 -Registry github
.\scripts\uninstall.ps1 -DryRun
.\scripts\uninstall.ps1
```

Installer options:

- Linux/macOS install: `--interactive`, `--yes`, `--with-web`, `--with-tui`, `--all`, `--tag <tag>`, `--registry npm|github`, `--client-mode path|built|auto`, `--dry-run`.
- Windows install: `-Interactive`, `-Yes`, `-WithWeb`, `-WithTui`, `-All`, `-Tag`, `-Registry npm|github`, `-ClientMode path|built|auto`, `-DryRun`.
- Linux/macOS uninstall: `--purge-config`, `--purge-cache`, `--purge-data`, `--dry-run`.
- Windows uninstall: `-PurgeConfig`, `-PurgeCache`, `-PurgeData`, `-DryRun`.

The installer runs preflight checks before mutating state, detects common conflicts, and in interactive mode offers safe upgrade, repair, skip, or abort choices when conflicts are found. Non-interactive `--yes` / `-Yes` fails safely on unknown conflicts rather than overwriting. Failed partial installs print recovery guidance and attempt best-effort rollback of artifacts created during the current run.

Uninstall stops the daemon first when possible and removes `@lordierclaw/bluenote`, `@lordierclaw/bluenote-webui`, and managed built terminal client artifacts/packages. Normal install and uninstall preserve user notes/config/data. `--purge-data` / `-PurgeData` is the only destructive user-data path and requires the exact typed confirmation phrase `delete my bluenote data`.

The default `auto` client mode lets `bluenote web` and `bluenote tui` prefer installer-managed built client artifacts from `BLUENOTE_BUILT_CLIENT_DIR` when present, then fall back to `PATH` discovery for `bluenote-webui` and `bluenote-term`. Use `--client-mode path|built|auto` on a launch command, or set `BLUENOTE_CLIENT_MODE=path|built|auto`, to force or inspect a runtime mode. The user TUI path uses a built terminal artifact/package and does not auto-install Bun or require Bun at runtime. `bluenote doctor` runs after installation and reports each client as `built`, `path`, `missing`, or `broken`.

Manual npm install is also supported for advanced users:

```sh
npm install -g @lordierclaw/bluenote
npm install -g @lordierclaw/bluenote-webui # optional
npm install -g @lordierclaw/bluenote-term  # optional built TUI package when available
bluenote doctor
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
npm run version:status
npm run version:status -- --allow-git-deps
./scripts/dev-install-local.sh --all --dry-run
./scripts/dev-uninstall-local.sh --all --dry-run
./scripts/dev-verify-local.sh --web --dry-run
node dist/bin.js --help
node dist/bin.js version
node dist/bin.js doctor
```

`npm run version:status` checks the four sibling package names and versions and rejects unsupported `@lordierclaw/bluenote-core` dependency specs. `latest` and exact published semver are both acceptable release-mode dependency shapes; development mode may use pinned Git deps when you intentionally pass `--allow-git-deps` for a local-only workspace.

The distribution repo also owns the release gate for `@lordierclaw/bluenote`: publishing a GitHub Release for the matching `v*` tag triggers the workflow, which runs the repo checks and a fresh Docker `node:22-bookworm` install/smoke pass before npm publish is allowed to continue.

## Packaging and versions

The package name is `@lordierclaw/bluenote`; published binaries are `bluenote` and `bn`.

The distribution depends on `@lordierclaw/bluenote-core` for headless behavior. Optional clients are installed separately and discovered as `bluenote-webui` and `bluenote-term` executables on `PATH`.

The distribution package consumes the latest published `@lordierclaw/bluenote-core` by default instead of requiring a same-version coordinated release. For local development workspaces that intentionally opt into Git-pinned dependencies, keep using `npm run version:status -- --allow-git-deps`.

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

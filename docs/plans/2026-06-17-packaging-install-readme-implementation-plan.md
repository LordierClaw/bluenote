# Packaging, Versioning, Install Scripts, and README Alignment Implementation Plan

> **For implementer:** Use TDD throughout where behavior is executable. Write failing tests first, watch them fail, implement minimally, then verify green. For README-only edits, use contract tests/search assertions where practical and package dry-run checks as verification.

**Goal:** Make BlueNote professionally packageable, version-countable, locally installable/verifiable, and user-installable/uninstallable across Linux and Windows while keeping user-facing documentation README-first.

**Architecture:** `bluenote` remains the distribution/install owner. All packages move to the `@lordierclaw/*` namespace while keeping simple public binary names (`bluenote`, `bn`, `bluenote-webui`, `bluenote-term`). Local developer scripts and user installer/uninstaller scripts live in `bluenote/scripts/`; all user-facing guidance is consolidated into the four repo READMEs with matching structure.

**Tech Stack:** npm package metadata, Node.js scripts for version/package checks, POSIX shell for Linux/macOS installers, PowerShell for Windows installers, existing repo check commands, and built terminal release artifacts for non-technical TUI installs.

**Approved package strategy:** Use scoped package names for all packages:

- `@lordierclaw/bluenote`
- `@lordierclaw/bluenote-core`
- `@lordierclaw/bluenote-webui`
- `@lordierclaw/bluenote-term`

**Stable binary names:**

- `bluenote`
- `bn`
- `bluenote-webui`
- `bluenote-term`

**Approved version strategy:** The first coordinated usable package version is `0.1.0`. This plan targets a usable release baseline rather than a prerelease package version.

**Approved user installer defaults:** Non-technical user installers are interactive by default. The default selected choice is distribution CLI only; users can choose WebUI, TUI, all clients, registry mode, and uninstall/purge behavior from prompts. Non-interactive flags must remain available for automation. TUI opt-in must install/use a built artifact that does not require Bun at runtime.

**Approved registry support:** User-facing install scripts should support both npmjs and GitHub Packages modes. GitHub Packages is not the default registry, but `--registry github` / `-Registry github` is in scope.

**Approved installer robustness strategy:** Install/uninstall scripts must handle common real-world edge cases: existing old BlueNote versions, mixed package/built installations, PATH command conflicts, stale daemon processes, partial previous installs, registry/auth/network failures, permission failures, missing runtimes, unsupported OS/architecture, interrupted installs, and safe retry/rollback. Installers should detect before mutating, explain conflicts, offer safe choices interactively, support non-interactive failure modes, and never delete user notes/config/data without explicit purge confirmation.

**Approved CLI runtime-mode strategy:** The distribution CLI must support two client runtime modes: local/package mode (PATH-discovered `bluenote-webui` and `bluenote-term` executables for development/npm packages) and built-binary mode (portable/bundled client executables installed by non-technical installers). Doctor and launch commands must report/use the active mode clearly.

**Approved PR strategy:** Implement as smaller PRs/branches by concern: package hygiene + README alignment, version status, CLI runtime modes, local developer scripts, user install/uninstall scripts, and release automation.

**README-first documentation rule:** Do not create new user-facing docs files for install/uninstall/local development/release workflow in this phase. Update only the four repo READMEs for public documentation. This implementation plan is an internal execution artifact under the existing `bluenote/docs/plans/` convention.

**Out of scope:** Actually publishing to npm/GitHub Packages, deleting old historical docs, changing daemon transport, auto-installing Bun, and deleting user note data by default. GitHub Packages support in scripts/docs is in scope. Docker is in scope only as a final fresh-environment Linux verification harness, not as the primary user install method and not as a substitute for Windows verification.

---

## Existing related plans and out-of-scope historical docs

This plan is distinct from older distribution plans:

- `docs/plans/2026-06-12-installable-distribution-design.md` — historical architecture baseline.
- `docs/plans/2026-06-12-installable-distribution-implementation-plan.md` — historical installable distribution work.
- `docs/plans/2026-06-12-daemon-api-migration-design.md` — daemon API migration, not package/install cleanup.
- `docs/plans/2026-06-12-daemon-api-migration-implementation-plan.md` — daemon migration implementation, not this phase.
- `docs/plans/2026-06-11-distribution-cli-skeleton-plan.md` — completed skeleton baseline.

Do not edit or rewrite these historical plans unless a task explicitly says so. README alignment is the current-facing documentation surface.

---

## Task 1: Distribution package metadata hygiene

**Repo:** `/root/code/bluenote`

**Files:**

- Modify: `package.json`
- Test/verify: `tests/run-tests.js` if existing package metadata tests need extension

**Behavior:**

- Set `@lordierclaw/bluenote` to the first usable release version `0.1.0`.
- Add a `files` whitelist so package artifacts contain only runtime package contents.
- Keep bin names `bluenote` and `bn` unchanged.
- Keep Node runtime compatibility `>=16.14 <17 || >=18`.

**Step 1: Write failing package metadata assertion**

Add or extend a distribution test that reads `package.json` and asserts:

- `version !== "0.0.0"`
- `files` includes `dist`, `README.md`, `LICENSE`, `package.json`
- `bin.bluenote === "./dist/bin.js"`
- `bin.bn === "./dist/bin.js"`

**Step 2: Run test — confirm it fails**

Command:

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because `version` is still `0.0.0` and `files` is missing.

**Step 3: Implement minimal package metadata changes**

Update `package.json` only.

**Step 4: Run green checks**

```sh
cd /root/code/bluenote
npm run test
npm pack --dry-run
```

Expected: tests pass; package tarball excludes source/tests/docs except allowed files.

**Step 5: Commit**

```sh
git -C /root/code/bluenote add package.json tests/run-tests.js
git -C /root/code/bluenote commit -m "chore: harden distribution package metadata"
```

---

## Task 2: Core package version and release-readiness check

**Repo:** `/root/code/bluenote-core`

**Files:**

- Modify: `package.json` only if version/publish metadata needs normalization
- Test/verify: existing package checks

**Behavior:**

- Keep package name `@lordierclaw/bluenote-core`.
- Normalize version to the agreed release count `0.1.0` or document why core already remains `0.1.0`.
- Preserve existing `files` whitelist.

**Step 1: Add/extend package metadata assertion if a suitable test exists**

If no simple test harness exists for package metadata, use `npm pack --dry-run --json` as the executable verification instead of adding a new docs-only test.

**Step 2: Run baseline verification**

```sh
cd /root/code/bluenote-core
npm run check
npm pack --dry-run --json
```

Expected: PASS today unless version normalization is required.

**Step 3: Apply minimal metadata update if needed**

Update only `package.json`.

**Step 4: Verify**

```sh
cd /root/code/bluenote-core
npm run check
npm pack --dry-run --json
```

**Step 5: Commit if changed**

```sh
git -C /root/code/bluenote-core add package.json
git -C /root/code/bluenote-core commit -m "chore: align core package version policy"
```

---

## Task 3: WebUI package rename and clean package build

**Repo:** `/root/code/bluenote-webui`

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` if npm updates the package name/lock metadata
- Test/verify: existing WebUI checks

**Behavior:**

- Rename package from `bluenote-webui` to `@lordierclaw/bluenote-webui`.
- Keep bin name `bluenote-webui` unchanged.
- Add/keep package `files` whitelist.
- Add `clean` script and make `build` clean `dist` first so stale Vite assets are not packed.
- Keep public exports working under the new package name.

**Step 1: Write failing package metadata/pack regression**

Add a small test if practical, or use a script assertion in existing tests that reads `package.json` and asserts:

- `name === "@lordierclaw/bluenote-webui"`
- `bin["bluenote-webui"] === "./bin/bluenote-webui.js"`
- `scripts.build` includes a clean step or `npm run clean`

**Step 2: Run test — confirm it fails**

```sh
cd /root/code/bluenote-webui
npm run test -- tests/<metadata-test-if-added>
```

If no test is added, run:

```sh
cd /root/code/bluenote-webui
node -e "const p=require('./package.json'); if (p.name !== '@lordierclaw/bluenote-webui') process.exit(1)"
```

Expected: FAIL before package rename.

**Step 3: Implement package metadata/build changes**

Update `package.json` and lockfile metadata through npm where needed.

**Step 4: Verify**

```sh
cd /root/code/bluenote-webui
npm run check
npm pack --dry-run --json
```

Inspect package output to ensure stale duplicate `dist/client/assets/index-*.js/css` files are gone after clean build.

**Step 5: Commit**

```sh
git -C /root/code/bluenote-webui add package.json package-lock.json tests
git -C /root/code/bluenote-webui commit -m "chore: scope webui package and clean build artifacts"
```

---

## Task 4: Term package rename and package artifact hygiene

**Repo:** `/root/code/bluenote-term`

**Files:**

- Modify: `packages/term/package.json`
- Modify: root `package.json` only if workspace metadata references package name
- Modify: `bun.lock` if package rename changes lock metadata

**Behavior:**

- Rename public package from `bluenote-term` to `@lordierclaw/bluenote-term`.
- Keep bin name `bluenote-term` unchanged.
- Add a `files` whitelist suitable for the package artifact.
- Add or preserve a built terminal release artifact path for non-technical installs so the user-facing TUI install does not require Bun at runtime.
- Keep Bun explicit as a development/build-time requirement, not as a non-technical user runtime requirement for the built TUI install path.

**Step 1: Write failing package metadata assertion**

Add a focused Bun test or simple package metadata assertion in existing tests if practical. Assert:

- `name === "@lordierclaw/bluenote-term"`
- `bin["bluenote-term"]` stays stable for developer/npm package use, or points to a built launcher if the package is changed to a no-Bun runtime package.
- `files` includes the chosen runtime package contents.
- release packaging continues to produce Linux/Windows built artifacts that do not require Bun at runtime.

**Step 2: Run test — confirm it fails**

```sh
cd /root/code/bluenote-term
bun test <metadata-test-if-added>
```

Or use a temporary node assertion for red proof before editing.

**Step 3: Implement metadata update**

Update package metadata only.

**Step 4: Verify**

```sh
cd /root/code/bluenote-term
bun run check
bun run build:release
cd packages/term
npm pack --dry-run --json
```

Expected: package includes only intended runtime files; `bluenote-term` bin remains stable; built terminal release packaging still produces Linux/Windows artifacts that run without Bun at runtime.

**Step 5: Commit**

```sh
git -C /root/code/bluenote-term add package.json packages/term/package.json bun.lock tests
git -C /root/code/bluenote-term commit -m "chore: scope terminal package metadata"
```

---

## Task 5: Version counting/status script in distribution repo

**Repo:** `/root/code/bluenote`

**Files:**

- Create: `scripts/version-status.mjs`
- Modify: `package.json`
- Test: `tests/run-tests.js`

**Behavior:**

`node scripts/version-status.mjs` should print a clear cross-repo version table from sibling checkouts:

```text
BlueNote package versions
@lordierclaw/bluenote          0.1.0
@lordierclaw/bluenote-core     0.1.0
@lordierclaw/bluenote-webui    0.1.0
@lordierclaw/bluenote-term     0.1.0
```

It should also fail non-zero when:

- a sibling package is missing
- a package name is not the approved scoped name
- a version is not valid semver/prerelease semver
- a release-mode dependency still points at a Git SHA where a scoped package version is expected, unless explicitly allowed by a `--allow-git-deps` flag

**Step 1: Write failing tests**

Add tests using temporary package JSON fixtures or child-process execution that verify:

- happy path prints all four packages
- invalid package name fails
- invalid version fails
- Git dependency fails unless `--allow-git-deps` is supplied

**Step 2: Run tests — confirm RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because `scripts/version-status.mjs` does not exist.

**Step 3: Implement script**

Keep it Node 16.14-compatible. Avoid external dependencies.

**Step 4: Add package script**

Add:

```json
"version:status": "node scripts/version-status.mjs"
```

**Step 5: Verify**

```sh
cd /root/code/bluenote
npm run test
npm run version:status -- --allow-git-deps
npm run check
```

**Step 6: Commit**

```sh
git -C /root/code/bluenote add package.json scripts/version-status.mjs tests/run-tests.js
git -C /root/code/bluenote commit -m "feat: add cross-repo version status check"
```

---

## Task 6: README structure alignment across all repos

**Repos:** all four

**Files:**

- Modify: `/root/code/bluenote/README.md`
- Modify: `/root/code/bluenote-core/README.md`
- Modify: `/root/code/bluenote-webui/README.md`
- Modify: `/root/code/bluenote-term/README.md`

**Behavior:**

All READMEs should use a similar style and section order:

1. Title and short description
2. Role in BlueNote
3. Install
4. Local development
5. Scripts
6. Packaging and versions
7. Cross-platform notes
8. Related packages

`bluenote/README.md` is the canonical full-app guide and should include install/uninstall/local verification script usage once scripts exist or as planned commands if in same PR sequence. Other READMEs should be concise and point to the distribution README for full app install/uninstall.

**Step 1: Write README contract assertions**

Add/extend a lightweight docs contract test in `bluenote` that reads all four sibling READMEs and asserts required headings exist. It should use relative sibling paths and skip with an explicit message only if sibling repos are unavailable.

Required headings per README:

- `## Role in BlueNote`
- `## Install`
- `## Local development`
- `## Scripts`
- `## Packaging and versions`
- `## Cross-platform notes`
- `## Related packages`

Also assert no install examples use old unscoped package names after the package rename, except when referring to binary names.

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because README headings/style are not aligned yet.

**Step 3: Rewrite READMEs narrowly**

Update the four README files only. Do not add separate install docs.

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
cd /root/code/bluenote-core && npm run check
cd /root/code/bluenote-webui && npm run check
cd /root/code/bluenote-term && bun run check
```

**Step 5: Commit per repo**

```sh
git -C /root/code/bluenote add README.md tests/run-tests.js
git -C /root/code/bluenote commit -m "docs: align distribution readme structure"

git -C /root/code/bluenote-core add README.md
git -C /root/code/bluenote-core commit -m "docs: align core readme structure"

git -C /root/code/bluenote-webui add README.md
git -C /root/code/bluenote-webui commit -m "docs: align webui readme structure"

git -C /root/code/bluenote-term add README.md
git -C /root/code/bluenote-term commit -m "docs: align terminal readme structure"
```

---

## Task 7: Local development install/uninstall scripts

**Repo:** `/root/code/bluenote`

**Files:**

- Create: `scripts/dev-install-local.sh`
- Create: `scripts/dev-install-local.ps1`
- Create: `scripts/dev-uninstall-local.sh`
- Create: `scripts/dev-uninstall-local.ps1`
- Modify: `tests/run-tests.js`
- Modify: `README.md`

**Behavior:**

Fast local link mode for sibling checkouts.

Linux/macOS:

```sh
./scripts/dev-install-local.sh --all
./scripts/dev-uninstall-local.sh --all
```

Windows PowerShell:

```powershell
.\scripts\dev-install-local.ps1 -All
.\scripts\dev-uninstall-local.ps1 -All
```

Options:

- `--web` / `-Web`
- `--tui` / `-Tui`
- `--all` / `-All`
- `--skip-check` / `-SkipCheck`
- `--dry-run` / `-DryRun`

Default: distribution + WebUI for local developer linking. TUI only with `--tui`/`--all` because developer linking uses the Bun-based terminal workspace.

**Step 1: Write failing tests**

Add script contract tests that verify:

- all four files exist
- shell scripts contain `set -euo pipefail`
- PowerShell scripts use `param(...)` and support `-DryRun`
- dry-run output includes the commands for distribution, WebUI, and optional TUI
- uninstall scripts stop daemon before unlink/uninstall attempts

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because scripts are missing.

**Step 3: Implement scripts**

Implement dry-run first, then real execution. Scripts must:

- resolve sibling repo paths relative to `bluenote`
- check required commands (`npm`, `node`; `bun` for TUI)
- run repo checks unless skipped
- link distribution with npm
- link WebUI with npm
- link Term with Bun from `bluenote-term/packages/term`
- run `bluenote doctor` if available

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
./scripts/dev-install-local.sh --all --dry-run
./scripts/dev-uninstall-local.sh --all --dry-run
```

PowerShell parse/static validation if `pwsh` is available:

```sh
pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content ./scripts/dev-install-local.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/dev-uninstall-local.ps1 -Raw)) | Out-Null"
```

Then real Linux verification if approved for this task:

```sh
./scripts/dev-install-local.sh --all
bluenote doctor
./scripts/dev-uninstall-local.sh --all
```

**Step 5: Commit**

```sh
git -C /root/code/bluenote add README.md scripts/dev-install-local.sh scripts/dev-install-local.ps1 scripts/dev-uninstall-local.sh scripts/dev-uninstall-local.ps1 tests/run-tests.js
git -C /root/code/bluenote commit -m "feat: add local development install scripts"
```

---

## Task 8: Local packed-artifact verification scripts

**Repo:** `/root/code/bluenote`

**Files:**

- Create: `scripts/dev-verify-local.sh`
- Create: `scripts/dev-verify-local.ps1`
- Modify: `tests/run-tests.js`
- Modify: `README.md`

**Behavior:**

Release-like local verification without publishing. Installs packed tarballs into a temporary prefix and uses isolated BlueNote state paths.

Linux/macOS:

```sh
./scripts/dev-verify-local.sh --all
```

Windows:

```powershell
.\scripts\dev-verify-local.ps1 -All
```

Options:

- `--web` / `-Web`
- `--tui` / `-Tui`
- `--all` / `-All`
- `--keep-temp` / `-KeepTemp`
- `--dry-run` / `-DryRun`

**Step 1: Write failing tests**

Test that scripts:

- exist
- support dry-run
- create/use temp prefix variables
- run `npm pack` before install
- run `bluenote --help`, `bluenote version`, `bluenote doctor`
- run daemon start/status/stop in verification flow
- clean up temp paths unless keep-temp is set

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because scripts are missing.

**Step 3: Implement scripts**

Use temp npm prefix and temp BlueNote state/config environment variables. Do not touch real global npm or real user note data.

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
./scripts/dev-verify-local.sh --web --dry-run
```

Then real Linux verification if approved:

```sh
./scripts/dev-verify-local.sh --web
```

Run `--all` only if Bun is available for developer/local package verification, or if the verification path is using built terminal release artifacts instead of Bun-linked sources.

**Step 5: Commit**

```sh
git -C /root/code/bluenote add README.md scripts/dev-verify-local.sh scripts/dev-verify-local.ps1 tests/run-tests.js
git -C /root/code/bluenote commit -m "feat: add local package verification scripts"
```

---


## Task 9: Distribution CLI client runtime modes

**Repo:** `/root/code/bluenote`

**Files:**

- Modify: `src/commands/tui.ts`
- Modify: `src/commands/web.ts` if WebUI gains a built-binary mode later
- Modify: `src/commands/doctor.ts`
- Modify: `src/utils/command-discovery.ts` or create a small runtime-mode resolver if needed
- Modify: `tests/run-tests.js`
- Modify: `README.md`

**Behavior:**

The distribution CLI must support two client runtime modes:

1. **Local/package mode** — current behavior. Discover public client executables on `PATH` (`bluenote-webui`, `bluenote-term`) and launch them with daemon environment variables. This is used for development links and npm package installs.
2. **Built-binary mode** — non-technical installer behavior. Discover installer-managed built client artifacts from a stable BlueNote install directory before falling back to PATH. TUI built artifacts must not require Bun at runtime.

Runtime-mode selection should be explicit and inspectable:

- CLI launch commands should prefer installer-managed built artifacts when configured/present, then fall back to PATH unless a flag/env forces one mode.
- Suggested flags/envs: `--client-mode auto|path|built` and/or `BLUENOTE_CLIENT_MODE=auto|path|built`.
- `bluenote doctor` should report each client as `built`, `path`, `missing`, or `broken`, including executable path and version/handshake where available.
- Doctor should no longer imply Bun is required for all TUI usage; it should distinguish source/development TUI from built TUI.

**Step 1: Write failing tests**

Add tests that prove:

- default/auto mode still launches PATH-discovered clients when no built artifact is configured
- built mode launches the configured built TUI artifact before PATH
- path mode ignores built artifacts and uses PATH discovery
- doctor reports client mode (`built` vs `path`)
- doctor does not report Bun as required when a built TUI artifact is available
- missing built artifact in built mode returns an actionable error

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because runtime-mode resolution does not exist yet.

**Step 3: Implement runtime-mode resolver**

Keep it Node 16.14-compatible and cross-platform. Prefer environment/config paths that work on Linux and Windows. Do not hardcode Unix-only paths.

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
npm run check
node dist/bin.js doctor
```

**Step 5: Commit**

```sh
git -C /root/code/bluenote add README.md src tests
git -C /root/code/bluenote commit -m "feat: support built and path client runtime modes"
```

---


## Task 10: Installer preflight, conflict handling, and rollback design

**Repo:** `/root/code/bluenote`

**Files:**

- Modify: `tests/run-tests.js`
- Modify: `README.md`
- May create shared script helpers under `scripts/lib/` if the implementation chooses to share logic between shell and PowerShell scripts

**Behavior:**

Before implementing the user-facing install/uninstall scripts, define and test the installer edge-case contract. The Linux and Windows installers must handle these common cases explicitly:

- existing `bluenote`, `bn`, `bluenote-webui`, or `bluenote-term` commands on PATH
- old package names or unscoped packages from earlier development builds
- older scoped packages with lower versions
- newer installed versions than the requested version/tag
- mixed installs, for example CLI from npm but TUI from a built artifact
- stale daemon process or daemon metadata before upgrade/uninstall
- partial previous install where only some packages/artifacts exist
- existing built artifact install directory with unknown files
- npm global prefix not writable
- npm registry unavailable or authentication failure, including GitHub Packages token/setup problems
- unsupported OS/architecture for built TUI artifacts
- missing required runtime (`node`, `npm`)
- interrupted install/uninstall
- Windows PowerShell execution policy issues where applicable

Required handling rules:

- Run preflight checks before mutating state.
- In interactive mode, present existing install/conflict findings and ask whether to upgrade, repair, uninstall/reinstall, skip optional clients, or abort.
- In `--yes` non-interactive mode, choose only safe defaults: upgrade/repair same package identity, skip optional clients on unsupported artifacts, and fail instead of overwriting unknown/conflicting files.
- Record enough planned actions in dry-run output for users to understand what will change.
- On failure after partial mutation, print a clear recovery command and attempt best-effort rollback for files/artifacts the script created in the current run.
- Never overwrite or delete user notes/config/data during install or normal uninstall.
- `--purge-data` remains the only destructive user-data path and requires exact typed confirmation.

**Step 1: Write failing installer contract tests**

Add tests that inspect script text or shared helper fixtures and prove the planned implementation covers:

- old version detection
- PATH conflict detection
- partial install detection
- unsupported built artifact platform handling
- GitHub Packages auth/registry guidance
- dry-run conflict summary
- non-interactive conflict failure
- rollback/recovery messaging
- no data deletion except confirmed purge path

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL until the installer scripts/helpers exist.

**Step 3: Implement shared contract helpers or script-local preflight blocks**

Keep logic duplicated only where necessary for shell vs PowerShell portability. If shared behavior becomes complex, use simple generated manifests or JSON action plans rather than relying on shell parsing differences.

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
./scripts/install.sh --dry-run
./scripts/install.sh --yes --dry-run
./scripts/uninstall.sh --dry-run
```

If PowerShell is available, parse-check the `.ps1` scripts too.

**Step 5: Commit**

```sh
git -C /root/code/bluenote add README.md scripts tests/run-tests.js
git -C /root/code/bluenote commit -m "feat: add installer preflight and conflict handling"
```

---

## Task 11: User install/uninstall scripts

**Repo:** `/root/code/bluenote`

**Files:**

- Create: `scripts/install.sh`
- Create: `scripts/install.ps1`
- Create: `scripts/uninstall.sh`
- Create: `scripts/uninstall.ps1`
- Modify: `tests/run-tests.js`
- Modify: `README.md`

**Behavior:**

Interactive non-technical user install/uninstall path for Linux and Windows.

Default interactive install:

- prompt for install mode and selected clients
- default selected choice is only `@lordierclaw/bluenote`
- offer WebUI, built TUI, or all clients as interactive choices
- offer npmjs or GitHub Packages registry choice, defaulting to npmjs
- run `bluenote doctor` after installation

Non-interactive install:

- `--yes` accepts defaults (CLI only)
- `--with-web`, `--with-tui`, and `--all` select optional clients
- `--registry npm|github` selects registry without prompting

Default uninstall:

- stop daemon if possible
- uninstall `@lordierclaw/bluenote`, `@lordierclaw/bluenote-webui`, and optionally `@lordierclaw/bluenote-term`
- preserve notes/config/data by default

Options:

- install: `--interactive`, `--yes`, `--with-web`, `--with-tui`, `--all`, `--tag <tag>`, `--registry npm|github`, `--client-mode path|built|auto`, `--dry-run`
- PowerShell equivalents: `-Interactive`, `-Yes`, `-WithWeb`, `-WithTui`, `-All`, `-Tag`, `-Registry`, `-ClientMode`, `-DryRun`
- uninstall: `--purge-config`, `--purge-cache`, `--purge-data`, `--dry-run`
- PowerShell equivalents: `-PurgeConfig`, `-PurgeCache`, `-PurgeData`, `-DryRun`

`--purge-data` / `-PurgeData` must require exact confirmation phrase:

```text
delete my bluenote data
```

**Step 1: Write failing tests**

Add contract tests verifying:

- scripts exist
- dry-run mode is supported
- default interactive choices include only the distribution CLI selected
- `--yes --dry-run` includes only the distribution CLI
- interactive prompts offer WebUI, built TUI, all clients, npmjs, and GitHub Packages choices
- `--with-web` includes WebUI
- `--with-tui` installs the built terminal artifact/package and does not require Bun at runtime for non-technical users
- GitHub registry mode configures `@lordierclaw:registry` only when selected
- installer configures or records built client artifact paths/mode so `bluenote tui` can use built-binary mode
- installer detects old versions, PATH conflicts, partial installs, permission failures, unsupported built-artifact platforms, and registry/auth failures before mutating
- interactive mode offers safe upgrade/repair/skip/abort choices when conflicts are found
- non-interactive mode fails safely on unknown conflicts instead of overwriting
- failed partial installs print recovery guidance and attempt best-effort rollback for current-run artifacts
- uninstall stops daemon first
- purge data requires exact confirmation phrase
- README documents Linux and Windows install/uninstall commands

**Step 2: Run RED**

```sh
cd /root/code/bluenote
npm run test
```

Expected: FAIL because scripts are missing.

**Step 3: Implement scripts**

Keep implementation simple and auditable. Prompts must be clear, have safe defaults, and support non-interactive automation. Do not auto-install Bun. For non-technical user installs, TUI installation must use the built terminal artifact/package that does not require Bun at runtime; if that artifact is unavailable, print a clear error and do not fall back to a Bun-source install. The installer must configure/record enough client-mode information for the distribution CLI to launch built artifacts later.

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run test
./scripts/install.sh --dry-run
./scripts/install.sh --yes --dry-run
./scripts/install.sh --with-web --dry-run
./scripts/install.sh --with-tui --dry-run
./scripts/install.sh --registry github --dry-run
./scripts/uninstall.sh --dry-run
```

PowerShell parse/static validation if available:

```sh
pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content ./scripts/install.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/uninstall.ps1 -Raw)) | Out-Null"
```

**Step 5: Commit**

```sh
git -C /root/code/bluenote add README.md scripts/install.sh scripts/install.ps1 scripts/uninstall.sh scripts/uninstall.ps1 tests/run-tests.js
git -C /root/code/bluenote commit -m "feat: add user install and uninstall scripts"
```

---

## Task 12: Dependency repin plan and release-mode validation

**Repos:** all four

**Files:**

- Modify package manifests only when package publication/version mode is ready
- Modify lockfiles as required by package manager
- Modify README package/version sections as needed

**Behavior:**

Once packages are published or local tarball release mode is being verified, replace Git SHA dependencies with versioned scoped package dependencies:

```json
"@lordierclaw/bluenote-core": "^0.1.0"
```

For pre-publication implementation, keep Git SHA dependencies but require:

```sh
npm run version:status -- --allow-git-deps
```

Release gate must require no Git deps:

```sh
npm run version:status
```

**Step 1: Add failing validation test**

Extend version-status tests to prove release mode fails on Git dependencies.

**Step 2: Run RED/GREEN depending on current dependency mode**

During pre-publication, `npm run version:status` should fail and `npm run version:status -- --allow-git-deps` should pass.

**Step 3: Document in README**

`bluenote/README.md` should explain:

- development mode may use pinned Git deps
- release mode must use published version deps
- `npm run version:status` is the release check

**Step 4: Verify**

```sh
cd /root/code/bluenote
npm run version:status -- --allow-git-deps
npm run test
```

**Step 5: Commit if changed**

```sh
git -C /root/code/bluenote add README.md scripts/version-status.mjs tests/run-tests.js
git -C /root/code/bluenote commit -m "docs: define release dependency validation"
```

---

## Task 13: Cross-repo package dry-run and final review

**Repos:** all four

**Behavior:**

Run final package and repo checks. Classify any failures as either regressions or pre-existing unrelated debt.

**Commands:**

```sh
cd /root/code/bluenote-core
npm run check
npm pack --dry-run --json

cd /root/code/bluenote-webui
npm run check
npm pack --dry-run --json

cd /root/code/bluenote-term
bun run check
bun run build:release
cd packages/term
npm pack --dry-run --json

cd /root/code/bluenote
npm run check
npm run version:status -- --allow-git-deps
npm pack --dry-run --json
./scripts/dev-install-local.sh --web --dry-run
./scripts/dev-verify-local.sh --web --dry-run
./scripts/install.sh --dry-run
./scripts/uninstall.sh --dry-run
```

If `pwsh` is available:

```sh
cd /root/code/bluenote
pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content ./scripts/install.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/uninstall.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/dev-install-local.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/dev-uninstall-local.ps1 -Raw)) | Out-Null; [scriptblock]::Create((Get-Content ./scripts/dev-verify-local.ps1 -Raw)) | Out-Null"
```

Run at least one real Linux temp-prefix install verification before sign-off:

```sh
cd /root/code/bluenote
./scripts/dev-verify-local.sh --web
```

Run a Docker-based fresh-environment Linux manual install verification before sign-off. This should use a clean image with no BlueNote state and prove the documented install path works from scratch:

```sh
cd /root/code/bluenote
docker run --rm -it \
  -v /root/code:/workspace \
  -w /workspace/bluenote \
  node:20-bookworm \
  bash -lc './scripts/install.sh --yes --dry-run && ./scripts/dev-verify-local.sh --web'
```

If Docker is unavailable on the host, record that as a verification blocker or explicitly ask the user whether to accept local-only verification. Do not silently skip it. Docker verification is Linux freshness evidence only; it does not replace Windows PowerShell parse checks or future real Windows manual/CI verification.

Then dispatch final spec and code-quality reviews.

---

## Final acceptance criteria

- All four package names follow approved scoped strategy.
- Public binary names remain stable.
- `bluenote` and sibling packages use the approved `0.1.0` version baseline unless a repo has a documented compatibility reason not to.
- `bluenote` has a real non-`0.0.0` version.
- Version status script can count/report all four package versions.
- Release-mode validation catches Git SHA deps unless explicitly allowed for development.
- README files share a recognizable structure and style.
- No new user-facing install/uninstall/local-dev docs files are created.
- Linux and Windows script variants exist for local install, local uninstall, local verify, user install, and user uninstall.
- Non-technical user installer is interactive by default with CLI-only as the default selected choice.
- Non-interactive `--yes` installer mode installs only the distribution CLI.
- WebUI and TUI are opt-in for non-technical user installers.
- TUI opt-in uses a built terminal artifact/package and does not require Bun at runtime.
- Distribution CLI supports both PATH/local package mode and built-binary client mode for doctor and launch commands.
- Installer preflight detects existing old versions, mixed installs, PATH conflicts, partial installs, unsupported platforms, permission failures, and registry/auth/network failures.
- Interactive installer offers safe upgrade/repair/skip/abort choices for conflicts.
- Non-interactive installer fails safely on unknown conflicts and does not overwrite unrelated files.
- Installer failures include recovery guidance and best-effort rollback for current-run artifacts.
- Default uninstall never deletes user notes/config/data.
- Purge-data flow requires explicit typed confirmation.
- Package dry-run outputs are clean and intentional.
- GitHub Packages registry mode is documented and covered by installer dry-run tests.
- Linux real temp-prefix package verification passes.
- Docker-based fresh-environment Linux manual install verification passes, or Docker unavailability is recorded as a blocker/user-approved exception.
- Windows PowerShell scripts at least parse successfully; full Windows manual/CI verification is documented if not runnable from the current host.

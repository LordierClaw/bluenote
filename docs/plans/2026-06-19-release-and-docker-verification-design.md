# BlueNote 0.4.3 release patch and GitHub release design

Date: 2026-06-19
Status: Approved design
Primary repo: `/root/code/bluenote`
Related repos:
- `/root/code/bluenote-core`
- `/root/code/bluenote-webui`
- `/root/code/bluenote-term`

## Goal

Ship the next aligned BlueNote patch release across all publishable packages, verify the release candidate in a fresh Docker Node 22 environment using packed local tarballs and ordinary user commands, publish only after that gate passes, and create GitHub releases in every publishable repo through repo-owned automation. This revision supersedes the earlier `0.4.2` target because `0.4.2` is already published and released; the remaining workflow fixes must ship under a new coordinated patch tag.

## User-approved decisions

- Target release version: `0.4.3`
- Docker verification happens before publish.
- Verification uses packed local tarballs for all clients.
- If Docker install and normal command verification pass, proceed to publish in this session.
- Create GitHub releases in every publishable repo.
- Add release automation in this round rather than deferring it.
- Keep user-facing docs README-first.
- Keep only the canonical current release design + implementation plan for this work; do not create extra release-planning docs.

## Non-goals

- Major product redesign beyond what is required for a clean `0.4.3` release.
- Broad historical-doc cleanup outside current-facing release/readme surfaces.
- Full manual Windows runtime proof in this session.
- New public design/phase doc sprawl.

## Current state summary

Live state rechecked during this revision:
- npm registry already has `0.4.2` for `@lordierclaw/bluenote`, `@lordierclaw/bluenote-core`, `@lordierclaw/bluenote-webui`, and `@lordierclaw/bluenote-term`
- `v0.4.2` GitHub releases already exist in all four publishable repos
- `bluenote` has a verified fix for the false `bluenote-webui: broken` doctor classification when the optional daemon handshake check fails
- workflow surfaces already exist in all repos:
  - `bluenote/.github/workflows/check.yml`
  - `bluenote-core/.github/workflows/ci.yml`
  - `bluenote-webui/.github/workflows/check.yml`
  - `bluenote-term/.github/workflows/ci.yml`
  - `bluenote-term/.github/workflows/release.yml`

That means this is now a true next patch release after `0.4.2`, not a re-publish of `0.4.2`, and release automation should start from the existing workflow layout rather than a greenfield assumption.

## Release strategy

Use one coordinated patch-release flow:
1. land and verify the `bluenote` doctor/WebUI fix plus release-workflow hardening as part of the `0.4.3` release candidate
2. align versions across all four publishable packages
3. ensure release manifests use exact semver core dependencies where required
4. run repo-local checks and pack dry-runs in every touched repo
5. generate local tarballs from final manifests
6. verify install/use inside a fresh Docker Node 22 environment with ordinary commands
7. publish in dependency order only if Docker verification passes
8. create GitHub releases in each publishable repo via repo-owned workflows and tags

## Repo ownership and expected changes

### `bluenote-core`
Owns:
- core npm artifact
- release base for WebUI, TUI, and distribution
- repo-local CI/release workflow for its own package

Expected changes:
- bump to `0.4.3`
- pack/check verification
- README release wording only if needed
- add or align a repo-owned release workflow if missing or inconsistent

### `bluenote-webui`
Owns:
- optional WebUI npm artifact
- published `bluenote-webui` executable
- repo-local CI/release workflow for its own package and GitHub release

Expected changes:
- bump to `0.4.3`
- exact semver dependency on `@lordierclaw/bluenote-core@0.4.3`
- pack/check verification
- README release/install wording only if needed
- fix workflow drift if current workflow still targets stale branch/setup assumptions
- add repo-owned GitHub release automation if missing

### `bluenote-term`
Owns:
- optional terminal package artifact
- published `bluenote-term` executable
- existing release workflow that must be inspected and aligned to current package/release needs

Expected changes:
- bump to `0.4.3`
- exact semver dependency on `@lordierclaw/bluenote-core@0.4.3`
- publish-shape verification
- README release/install wording only if needed
- align existing `release.yml` with the real current release contract

### `bluenote`
Owns:
- distribution CLI release
- doctor fix shipping in this patch
- release gating, Docker verification, and README-first user guidance
- repo-owned GitHub release automation for the distribution repo
- canonical release design + implementation plan for this round

Expected changes:
- keep/verify the doctor handshake classification fix
- bump to `0.4.3`
- exact semver dependency on `@lordierclaw/bluenote-core@0.4.3`
- tighten release validation and smoke verification where needed
- README release/install wording alignment
- workflow updates for release automation and Docker release verification
- prune only superseded release-planning noise if any current-facing duplicates remain after plan consolidation

## Verification contract

A `0.4.3` candidate is acceptable only if all of the following pass.

### 1. Repo-local gates
- `bluenote-core`: `npm run check` and `npm pack --dry-run --json`
- `bluenote-webui`: `npm run check` and `npm pack --dry-run --json`
- `bluenote-term`: repo-appropriate `check` plus publish-shape verification for `packages/term`
- `bluenote`: `npm run check`, `npm run version:status`, and `npm pack --dry-run --json`

### 2. Docker Node 22 release-candidate gate
Inside a fresh container, install local tarballs in dependency order and prove at minimum:
- `bluenote --help`
- `bluenote version`
- `bluenote doctor`
- `bluenote daemon start`
- `bluenote doctor`
- `bluenote daemon stop`
- optional client discovery succeeds for WebUI and TUI
- the doctor fix reports handshake failure as a diagnostic, not a false broken install, when applicable

### 3. Release integrity
- all package manifests are `0.4.3`
- no released manifest keeps a Git-pinned core dependency
- no secrets are printed in doctor/log/release output
- workflow automation matches the real release contract of each repo

### 4. Publish + GitHub release integrity
- npm publish succeeds in dependency order
- tags/releases are created in every publishable repo
- at least one post-publish sanity check succeeds against the registry-published artifacts

## Publish order

1. `@lordierclaw/bluenote-core`
2. `@lordierclaw/bluenote-webui`
3. `@lordierclaw/bluenote-term`
4. `@lordierclaw/bluenote`

Then create/verify GitHub releases in the same repo order if the workflow design requires sequential tags, otherwise verify every repo-owned release workflow completed successfully.

## Workflow/automation direction

- Prefer repo-owned release workflows over a single central publisher that mutates sibling repos.
- Reuse and repair existing workflows where possible instead of replacing everything.
- Keep release automation explicit about package/version/tag expectations.
- Ensure release automation does not bypass the Docker verification gate.
- Distribution release notes should remain README-first and user-oriented; package repos may keep slimmer technical notes.

## Documentation direction

- Update READMEs when release/install behavior, package names, versioning guidance, or GitHub-release usage changes.
- Do not create additional public release plan docs.
- Keep the 2026-06-19 design + implementation plan as the canonical internal release artifacts for this round.
- Preserve historical architecture plans unless they conflict with current-facing docs; prune only superseded release-planning duplicates if they are current-facing noise.

## Risks and attention areas

1. `bluenote-term` already has a `release.yml`; it may reflect an older asset contract and must be reconciled rather than assumed correct.
2. `bluenote-webui` workflow drift is likely because its check workflow still references a non-main core ref.
3. Docker verification can expose install/runtime gaps not visible in sibling-checkout development.
4. The `0.4.3` assumption must be corrected everywhere if the user later picks a different version.

## Success criteria

This release work is successful only if:
- `0.4.3` is applied consistently across all publishable packages
- the doctor/WebUI false-broken report fix ships in the distribution release
- all repo-local and Docker gates pass
- npm publish completes in dependency order
- GitHub releases are produced in every publishable repo through verified automation
- current-facing docs are aligned without adding new planning/doc spam

## Next phase

Update the canonical implementation plan and then execute it task-by-task with verification.
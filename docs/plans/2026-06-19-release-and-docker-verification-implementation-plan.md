# BlueNote 0.4.3 release patch Implementation Plan

> **For implementer:** Use TDD throughout where behavior is executable. Write failing tests first, watch them fail, implement minimally, then verify green. For workflow/doc-only tasks, use the smallest executable/contract gate available and verify against the real repo state.

**Goal:** Ship a coordinated BlueNote `0.4.3` patch release that includes the doctor/WebUI false-broken fix plus the post-`0.4.2` release-workflow hardening, passes fresh Docker Node 22 tarball verification, publishes all four npm packages in dependency order, and creates GitHub releases in every publishable repo without adding plan-doc spam.

**Architecture:** Keep `bluenote` as the release-gate owner, but let each repo own its own package metadata, CI, and GitHub release workflow. Reuse existing workflow files where practical, align package versions/dependencies first, prove installability from local tarballs in Docker, then publish and verify GitHub releases.

**Tech Stack:** npm, Bun, TypeScript, GitHub Actions YAML, Docker Node 22, existing BlueNote check/build scripts, README-first docs.

---

## Preconditions

- Approved design: `docs/plans/2026-06-19-release-and-docker-verification-design.md`
- Repos in scope:
  - `/root/code/bluenote-core`
  - `/root/code/bluenote-webui`
  - `/root/code/bluenote-term`
  - `/root/code/bluenote`
- Assumed release version for this plan: `0.4.3`
- Do not publish until Docker verification is green.
- Do not create additional release plan docs; update the canonical pair only.

---

### Task 1: Reconcile release state, record `0.4.3`, and inspect workflow baselines

**Files:**
- Modify: `/root/code/.agent/CURRENT_TASK.md`
- Modify: `/root/code/.agent/STATUS.md`
- Inspect only: all four `package.json` files and all existing workflow YAML files

**Step 1: Gather live release state**
Commands:
- `npm view @lordierclaw/bluenote version`
- `npm view @lordierclaw/bluenote-core version`
- `npm view @lordierclaw/bluenote-webui version`
- `npm view @lordierclaw/bluenote-term version`
- `git -C <repo> status --short`
- inspect existing workflow files in each repo
Expected: confirm `0.4.2` is already published, `0.4.3` is the next patch target, and record which release/CI workflows already exist.

**Step 2: Update task tracking**
Record the active target version and revised scope in `.agent/CURRENT_TASK.md` and `.agent/STATUS.md`.

**Step 3: Verify no unexpected repo dirtiness**
Expected: only expected in-progress release work is present before broader edits continue.

**Step 4: Commit**
No commit. This task is complete when the target version and workflow baseline are recorded.

---

### Task 2: Lock the distribution release contract in tests and docs

**Files:**
- Modify: `/root/code/bluenote/tests/run-tests.js`
- Modify if needed: `/root/code/bluenote/src/commands/doctor.ts`
- Modify if needed: `/root/code/bluenote/scripts/version-status.mjs`

**Step 1: Write/extend failing tests**
Cover both release-critical behaviors:
- doctor must not mark WebUI broken when `--version` succeeds but `--check-daemon` fails
- release validation must reject non-exact core dependency contracts in release mode

**Step 2: Run test — confirm red/real baseline**
Command:
- `npm -C /root/code/bluenote test`
Expected: any newly added coverage fails before implementation if the contract is not yet enforced.

**Step 3: Write minimal implementation**
Keep the doctor status based on the stable version check while leaving handshake as a separate diagnostic; tighten release-mode dependency validation only as needed.

**Step 4: Run test — confirm green**
Command:
- `npm -C /root/code/bluenote test`
Expected: PASS.

**Step 5: Commit**
`git -C /root/code/bluenote add src/commands/doctor.ts scripts/version-status.mjs tests/run-tests.js && git -C /root/code/bluenote commit -m "fix: tighten 0.4.3 release contract"`

---

### Task 3: Prepare `bluenote-core@0.4.3`

**Files:**
- Modify: `/root/code/bluenote-core/package.json`
- Modify if required: `/root/code/bluenote-core/package-lock.json`
- Modify if needed: `/root/code/bluenote-core/README.md`
- Modify if needed: `/root/code/bluenote-core/.github/workflows/ci.yml`
- Create/Modify if needed: repo-owned release workflow under `/root/code/bluenote-core/.github/workflows/`

**Step 1: Use package/version gate as red phase**
Commands:
- `npm -C /root/code/bluenote-core run check`
- `npm -C /root/code/bluenote-core pack --dry-run --json`
Expected: healthy package, still at the pre-release version before edits.

**Step 2: Write minimal implementation**
- bump version to `0.4.3`
- refresh lockfile only if required
- align README release wording only if needed
- add or align repo-owned release workflow for npm publish + GitHub release if missing/incomplete

**Step 3: Run gate — confirm green**
Commands:
- `npm -C /root/code/bluenote-core run check`
- `npm -C /root/code/bluenote-core pack --dry-run --json`
Expected: PASS with `0.4.3` reflected in pack metadata.

**Step 4: Commit**
`git -C /root/code/bluenote-core add package.json package-lock.json README.md .github/workflows && git -C /root/code/bluenote-core commit -m "chore: prepare bluenote-core 0.4.3"`

---

### Task 4: Prepare `bluenote-webui@0.4.3` and repair workflow drift

**Files:**
- Modify: `/root/code/bluenote-webui/package.json`
- Modify if required: `/root/code/bluenote-webui/package-lock.json`
- Modify if needed: `/root/code/bluenote-webui/README.md`
- Modify: `/root/code/bluenote-webui/.github/workflows/check.yml`
- Create if needed: `/root/code/bluenote-webui/.github/workflows/release.yml`

**Step 1: Use package/release contract as red phase**
Commands:
- `npm -C /root/code/bluenote-webui run check`
- `npm -C /root/code/bluenote-webui pack --dry-run --json`
Expected: healthy package but still carrying old version/dependency/workflow assumptions.

**Step 2: Write minimal implementation**
- bump version to `0.4.3`
- set `@lordierclaw/bluenote-core` dependency to exact `0.4.3`
- refresh lockfile only if required
- align README release/install wording if needed
- remove stale workflow branch/ref assumptions
- add repo-owned release workflow for npm publish + GitHub release if missing

**Step 3: Run gate — confirm green**
Commands:
- `npm -C /root/code/bluenote-webui run check`
- `npm -C /root/code/bluenote-webui pack --dry-run --json`
Expected: PASS with correct semver dependency and workflow sanity.

**Step 4: Commit**
`git -C /root/code/bluenote-webui add package.json package-lock.json README.md .github/workflows && git -C /root/code/bluenote-webui commit -m "chore: prepare bluenote-webui 0.4.3"`

---

### Task 5: Prepare `bluenote-term@0.4.3` and align existing release workflow

**Files:**
- Modify: `/root/code/bluenote-term/packages/term/package.json`
- Modify if needed: `/root/code/bluenote-term/README.md`
- Modify if needed: `/root/code/bluenote-term/packages/term/README.md`
- Modify if needed: `/root/code/bluenote-term/.github/workflows/release.yml`
- Modify if needed: `/root/code/bluenote-term/.github/workflows/ci.yml`

**Step 1: Use publish-shape gate as red phase**
Commands:
- `bun -C /root/code/bluenote-term run check`
- `cd /root/code/bluenote-term/packages/term && npm pack --dry-run --json`
Expected: healthy package, but old version/dependency/release-workflow assumptions still present before edits.

**Step 2: Write minimal implementation**
- bump term package version to `0.4.3`
- set `@lordierclaw/bluenote-core` dependency to exact `0.4.3`
- make only minimal README/package changes needed for a real release path
- reconcile existing `release.yml` with the actual current package and asset contract

**Step 3: Run gate — confirm green**
Commands:
- `bun -C /root/code/bluenote-term run check`
- `cd /root/code/bluenote-term/packages/term && npm pack --dry-run --json`
Expected: PASS with correct semver dependency and publishable artifact shape.

**Step 4: Commit**
`git -C /root/code/bluenote-term add packages/term/package.json README.md packages/term/README.md .github/workflows && git -C /root/code/bluenote-term commit -m "chore: prepare bluenote-term 0.4.3"`

---

### Task 6: Prepare `bluenote@0.4.3`, README alignment, and release automation

**Files:**
- Modify: `/root/code/bluenote/package.json`
- Modify if required: `/root/code/bluenote/package-lock.json`
- Modify: `/root/code/bluenote/README.md`
- Modify if needed: `/root/code/bluenote/.github/workflows/check.yml`
- Create/Modify if needed: release workflow(s) under `/root/code/bluenote/.github/workflows/`

**Step 1: Use release-mode validation as red phase**
Commands:
- `npm -C /root/code/bluenote test`
- `npm -C /root/code/bluenote run version:status`
Expected: pre-change baseline still references the old version/dependency/doc/release setup.

**Step 2: Write minimal implementation**
- bump distribution version to `0.4.3`
- set `@lordierclaw/bluenote-core` dependency to exact `0.4.3`
- refresh lockfile only if required
- align README install/release wording
- add/align distribution release workflow so GitHub release automation exists and does not bypass Docker verification

**Step 3: Run gate — confirm green**
Commands:
- `npm -C /root/code/bluenote test`
- `npm -C /root/code/bluenote run version:status`
- `npm -C /root/code/bluenote pack --dry-run --json`
Expected: PASS.

**Step 4: Commit**
`git -C /root/code/bluenote add package.json package-lock.json README.md .github/workflows src/commands/doctor.ts scripts/version-status.mjs tests/run-tests.js && git -C /root/code/bluenote commit -m "chore: prepare bluenote 0.4.3"`

---

### Task 7: Run the full cross-repo release-candidate gate

**Files:**
- No source changes expected unless verification exposes a real regression

**Step 1: Run all repo-local gates**
Commands:
- `npm -C /root/code/bluenote-core run check && npm -C /root/code/bluenote-core pack --dry-run --json`
- `npm -C /root/code/bluenote-webui run check && npm -C /root/code/bluenote-webui pack --dry-run --json`
- `bun -C /root/code/bluenote-term run check && cd /root/code/bluenote-term/packages/term && npm pack --dry-run --json`
- `npm -C /root/code/bluenote run check && npm -C /root/code/bluenote run version:status && npm -C /root/code/bluenote pack --dry-run --json`
Expected: all green.

**Step 2: Fix any regression at root cause**
If a gate fails, return to the owning repo, add focused coverage if needed, fix, and rerun the full gate.

**Step 3: Commit**
Only if fixes were required.

---

### Task 8: Generate final tarballs and prove the release candidate in fresh Docker Node 22

**Files:**
- Create temp artifacts only; no committed source changes expected unless verification exposes a bug

**Step 1: Produce tarballs**
Commands:
- `npm -C /root/code/bluenote-core pack`
- `npm -C /root/code/bluenote-webui pack`
- `cd /root/code/bluenote-term/packages/term && npm pack`
- `npm -C /root/code/bluenote pack`

**Step 2: Verify inside a fresh Node 22 container**
Command pattern:
- `docker run --rm -v /root/code:/workspace -w /workspace node:22-bookworm bash -lc '<install tarballs globally in dependency order and run normal commands>'`

**Step 3: Run ordinary user commands inside Docker**
At minimum:
- `bluenote --help`
- `bluenote version`
- `bluenote doctor`
- `bluenote daemon start`
- `bluenote doctor`
- `bluenote daemon stop`
Expected: all succeed; doctor discovers WebUI and TUI; no false broken WebUI report for handshake-only issues.

**Step 4: Commit**
No commit unless source fixes were needed and reverified.

---

### Task 9: Publish npm packages in dependency order

**Files:**
- No source changes expected

**Step 1: Publish core**
- `npm -C /root/code/bluenote-core publish`

**Step 2: Publish WebUI**
- `npm -C /root/code/bluenote-webui publish`

**Step 3: Publish term**
- `cd /root/code/bluenote-term/packages/term && npm publish`

**Step 4: Publish distribution**
- `npm -C /root/code/bluenote publish`

**Step 5: Record results**
Capture exact published names/versions and any registry propagation delay.

**Step 6: Commit**
No commit.

---

### Task 10: Create and verify GitHub releases in every publishable repo

**Files:**
- No source changes expected unless workflow fixes are required after a failed release run

**Step 1: Trigger repo-owned release automation**
Use the approved tag/workflow contract for:
- `/root/code/bluenote-core`
- `/root/code/bluenote-webui`
- `/root/code/bluenote-term`
- `/root/code/bluenote`

**Step 2: Verify each GitHub release**
Capture for every repo:
- workflow run URL or job proof
- created tag
- created GitHub release URL
- attached assets or note shape where applicable

**Step 3: If any workflow fails, fix at root cause**
Patch only the owning repo’s workflow/docs/scripts, rerun the required gate, and retry the release.

**Step 4: Commit**
Only if workflow fixes were needed.

---

### Task 11: Final docs/plan cleanup and post-publish sanity verification

**Files:**
- Modify if needed: current-facing README files in touched repos
- Remove only if justified: superseded release-planning docs in `/root/code/bluenote/docs/plans/` that are duplicate noise for this release work

**Step 1: Verify current-facing docs agree**
Check README/install/release wording against the actual released contract.

**Step 2: Prune only duplicate release-planning noise**
Do not delete historical architecture plans unless they are current-facing duplicates. Prefer keeping the canonical 2026-06-19 pair only for this release thread.

**Step 3: Run post-publish sanity checks**
Prefer a fresh environment using registry-published packages:
- `bluenote version`
- `bluenote doctor`
- verify optional client discovery or clearly classify propagation lag

**Step 4: Report exact release results**
Include npm versions, GitHub release URLs, verification commands, and any follow-up notes.

---

## Final verification checklist

Before declaring success:
- [ ] `0.4.3` applied consistently across all four packages
- [ ] doctor/WebUI false-broken fix verified in the distribution release candidate
- [ ] no release manifest still references Git-pinned core dependencies
- [ ] all repo-local checks passed
- [ ] Docker Node 22 tarball install/use passed
- [ ] npm publish succeeded in dependency order
- [ ] GitHub releases succeeded in every publishable repo
- [ ] README/current-facing docs are aligned
- [ ] no extra release plan docs were created

## Execution mode handoff

Plan saved to `docs/plans/2026-06-19-release-and-docker-verification-implementation-plan.md`.

Two execution options:

1. **Subagent-Driven** — I dispatch a fresh sub-agent per task, review between tasks
2. **Manual** — You run the tasks yourself

Current recorded preference from earlier release work was subagent-driven. If that still stands, execution should resume from Task 1 of this revised plan.
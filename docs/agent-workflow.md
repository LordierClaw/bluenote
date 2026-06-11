# Agent Workflow

## Start of every task

1. Read the latest user instruction.
2. If working from the parent workspace, read `.agent/CURRENT_TASK.md` and parent `AGENTS.md`.
3. Read `bluenote/AGENTS.md` and relevant `bluenote/docs/*`.
4. Read the target repo `AGENTS.md`, then `DEVELOPMENT.md` if present.
5. Identify the owning repo, allowed edit paths, forbidden edit paths, runtime compatibility, and checks.

If no active task is defined, inspect first and propose a task plan. Do not code without an active task.

## Source-of-truth priority

1. Latest user instruction
2. `.agent/CURRENT_TASK.md`
3. Parent `AGENTS.md`
4. `bluenote/AGENTS.md` and `bluenote/docs/*`
5. Target repo `AGENTS.md`
6. Target repo `DEVELOPMENT.md`
7. Target repo migration/phase docs
8. README
9. Existing code/tests

Older phase docs are historical unless the active task references them. If docs conflict, stop and record the conflict in `.agent/STATUS.md`.

## Failure/interrupt protocol

Stop and hand off when requirements change, docs conflict, checks fail unexpectedly, uncommitted user changes appear, or a needed edit crosses repo ownership boundaries.

Record:

- affected repo,
- command or doc conflict,
- files touched,
- safest next step.

## Subagent handoff

Every subagent prompt must name the target repo, allowed paths, forbidden paths, docs to read, checks to run, and expected handoff format.

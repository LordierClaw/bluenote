# 0001 - Multi-Repo Agent Workflow

Date: 2026-06-11

## Decision

Use `bluenote` as the versioned source for cross-repo agent workflow documentation. Use parent `.agent/*` files only as local workspace memory when the parent folder is not a git repo.

## Context

BlueNote currently spans four sibling repositories:

- `bluenote-core`
- `bluenote-term`
- `bluenote-webui`
- `bluenote`

Agents may start in the parent folder or inside a sub-repo. Historical phase docs may conflict with current direction, so agents need an explicit source-of-truth hierarchy and repo ownership map.

## Consequences

- Future agents can determine which repo owns a feature before editing.
- Runtime compatibility and dependency direction are documented in one versioned place.
- Parent `.agent/*` handoff files can be used locally without assuming they are committed.
- Product behavior is unchanged by this decision.

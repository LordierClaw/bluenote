# Runtime Compatibility

| Repo | Required compatibility | Package manager |
|---|---|---|
| `bluenote-core` | Node `>=16.14 <17 || >=18` | npm |
| `bluenote-term` | Bun/OpenTUI allowed; newer Node allowed when required | Bun |
| `bluenote-webui` | Node `>=16.14 <17 || >=18` | npm |
| `bluenote` | Node `>=16.14 <17 || >=18`; command router remains Node 16.14-compatible | npm |

## Distribution repo rules

- Keep top-level command routing compatible with Node 16.14.
- `bluenote --help`, `bluenote version`, and `bluenote doctor` must not import terminal/web client implementation modules.
- `bluenote tui` discovers the public `bluenote-term` executable on `PATH` and launches it only after daemon metadata is available. If Bun/client runtime requirements are unavailable, doctor and launch errors must be clear and actionable.
- `bluenote web` discovers the public `bluenote-webui` executable on `PATH` and launches it only after daemon metadata is available.
- `bluenote daemon start|status|stop` manages the minimal local-only HTTP daemon lifecycle and must not print tokens.
- Baseline CI should run on Node 16.14 and should not require Bun for basic distribution smoke commands.

## Compatibility changes

Do not relax these requirements without an approved cross-repo plan and docs updates in the affected repo(s).

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
- `bluenote tui` resolves the public `bluenote-term` package bin and runs it through Bun. If Bun or the public package is unavailable, it reports a clear actionable error instead of pretending the TUI can run under plain Node 16.14.
- `bluenote web` lazy-loads the public `bluenote-webui` command API only when the web command is invoked.
- `bluenote daemon start|status|stop` is scaffold-only until a future cross-repo daemon/runtime/sync design is approved.
- Baseline CI should run on Node 16.14 and should not require Bun for basic distribution smoke commands.

## Compatibility changes

Do not relax these requirements without an approved cross-repo plan and docs updates in the affected repo(s).

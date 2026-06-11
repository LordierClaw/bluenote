# Runtime Compatibility

| Repo | Required compatibility | Package manager |
|---|---|---|
| `bluenote-core` | Node `>=16.14 <17 || >=18` | npm |
| `bluenote-term` | Bun/OpenTUI allowed; newer Node allowed when required | Bun |
| `bluenote-webui` | Node `>=16.14 <17 || >=18` | npm |
| `bluenote` | Node 16.14-compatible | npm unless changed by an approved plan |

## Distribution repo rules

- Keep top-level command routing compatible with Node 16.14.
- Lazy-load terminal and web clients so `bluenote --help`, `bluenote version`, and `bluenote doctor` do not eagerly load heavy or incompatible client code.
- If a command requires Bun or a newer runtime, detect that at command execution time and report a clear actionable error.

## Compatibility changes

Do not relax these requirements without an approved cross-repo plan and docs updates in the affected repo(s).

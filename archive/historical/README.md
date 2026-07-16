# Historical Archive

This folder keeps prior project material for reference. It is not active runtime
instruction.

## Buckets

- `claude-era/`: files, agents, hooks, dashboards, audits, and procedures from
  the previous Claude-led workspace.
- `business-research/`: dated market/channel research that may still be useful
  but should be refreshed before use.
- `local-tooling/`: machine-local tool state that should not drive the current
  Codex runtime.
- `local-artifacts/`: cache/build artifacts kept only because they existed at
  handover, including pre-foundation generated deliverables. Reproducible cache
  files and obsolete SQLite snapshots were removed after restore proof.
- `runtime-backups/`: old backup files kept for comparison only.
- `business-records/`: superseded operational/company notes retained as history;
  they are not current instructions or legal records.

The archived empty MCP configuration and old venture templates are retained
under `claude-era/`. Active runtime state belongs in the ignored `data/` tree,
private operator material belongs in the ignored `private/` tree, and generated
operator outputs belong in `data/artifacts/`.

Current source of truth:

- `AGENTS.md`
- `docs/Jarvis-Codex Master Plan.md`
- `docs/Jarvis-Codex Build Log.md`
- `config/guardrails.md`

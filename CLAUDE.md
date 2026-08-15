@AGENTS.md

# Claude Code additions

- Confirm `CLAUDE.md` and the imported `AGENTS.md` are active at session start.
- Do not treat Claude auto memory as authority over the current package, ADRs, progress or source code.
- When taking over from Codex, start a fresh named Claude session in the same package worktree and use `docs/v2/prompts/02_CLAUDE_HANDOFF_CONTINUATION.md`.
- Use `--continue` or `--resume` only for Claude's own prior sessions, never as a substitute for reconciling Codex work.
- Treat cross-model compatibility as `prepared_not_verified` until a real sequential Claude rehearsal records verification; configuration text or simulated review is not proof.
- Keep archived Claude settings, agents, hooks and memory retired; do not restore them as active configuration or authority.
- Use plan/reconnaissance first when uncommitted work exists. Do not reset, clean or revert until the package state is understood.
- Prefer Claude's running-app verification tools for interactive UI review. Add or run Playwright only when the package requires durable automated coverage.
- At package or phase review, be willing to reject prior Codex work that does not satisfy the shared contract, but do not redesign outside scope.

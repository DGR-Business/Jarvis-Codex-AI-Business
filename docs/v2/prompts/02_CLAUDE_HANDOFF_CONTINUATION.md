# Claude Code Handoff Continuation Prompt

Open a **fresh Claude Code session in the exact same package worktree**. Do not use a different checkout.

```text
Codex was working on Pantheon v2.1.1 work package [ID] and stopped before the
package was completed.

Read CLAUDE.md and its imported AGENTS.md, the Master Plan, Engineering
Protocol, Session Protocol, current Phase Execution Pack, Work Package,
relevant ADRs and Provider Decision Records, PROGRESS.json, BLOCKERS.md and
ACTIVE_HANDOFF.md.

Begin in reconciliation mode. Inspect git status, git diff, recent commits,
relevant source/tests and the latest verification evidence. Determine what is
actually complete against the package acceptance criteria. Preserve valid
Codex work. Do not reset, clean, revert or redesign until you understand the
current state.

Continue the same Work Package only. Maintain ACTIVE_HANDOFF.md, run the
specified targeted verification, and complete the package contract rather than
trying to infer Codex's private intention. For material UI changes, inspect the
running application interactively; use Playwright only when the package
requires or justifies it.

Do not begin the next package. Do not push unless permitted. End with the exact
session instruction required by AGENTS.md.
```

# Codex Work Package Start Prompt

Use this in a **fresh Codex session** after the package is approved.

```text
/goal Complete Pantheon v2.1.1 work package [ID] exactly as specified in
docs/v2/work-packages/[ID].md.

Before editing, read AGENTS.md, docs/v2/PANTHEON_V2_MASTER_PLAN.md,
docs/v2/ENGINEERING_PROTOCOL.md, docs/v2/SESSION_PROTOCOL.md, the current Phase
Execution Pack, the Work Package, relevant ADRs and Provider Decision Records,
docs/v2/PROGRESS.json, docs/v2/BLOCKERS.md and docs/v2/ACTIVE_HANDOFF.md.

Inspect git status, git diff and recent commits. Restate the objective, current
baseline, remaining acceptance criteria and first action before editing.

Work only on this package. Maintain ACTIVE_HANDOFF.md after meaningful
checkpoints. Use targeted verification. For material UI changes, inspect the
running application interactively; use Playwright only where the Work Package
requires or justifies durable regression.

Do not begin another package. Do not push unless permitted. At completion,
archive the completion report, update progress and end with the exact session
instruction required by AGENTS.md.
```

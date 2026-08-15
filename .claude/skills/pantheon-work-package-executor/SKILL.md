---
name: pantheon-work-package-executor
description: Implement, continue, verify, review, or complete one approved Pantheon v2.1.1 work package without scope drift.
---

# Pantheon Work Package Executor

1. Apply the authority chain in `AGENTS.md`: an approved Pack may explicitly specialize Master execution; its approved Work Package is most specific but cannot silently amend the Pack, relevant ADRs or non-specialized Master constraints.
2. Read that governing chain and the current handoff.
3. Inspect Git state before editing.
4. Restate objective, remaining criteria and first action.
5. Work only on the approved package.
6. Update `docs/v2/ACTIVE_HANDOFF.md` after meaningful checkpoints.
7. Use only approved Package- and Pack-specified verification during implementation and completion.
8. For material UI changes, inspect the running app interactively. Use Playwright only when the package requires or justifies durable regression.
9. Classify unrelated failures instead of chasing them.
10. Archive a completion report and update progress before claiming completion.
11. Use a package outcome from `AGENTS.md` only for a package session; planning, amendment, standalone reconciliation and phase-gate sessions use their distinct exact endings.

---
name: pantheon-work-package-executor
description: Implement, continue, verify, review, or complete one approved Pantheon v2.1.1 work package without scope drift.
---

# Pantheon Work Package Executor

1. Read the governing package chain and current handoff.
2. Inspect Git state before editing.
3. Restate objective, remaining criteria and first action.
4. Work only on the approved package.
5. Update `docs/v2/ACTIVE_HANDOFF.md` after meaningful checkpoints.
6. Use targeted tests during implementation.
7. For material UI changes, inspect the running app interactively. Use Playwright only when the package requires or justifies durable regression.
8. Classify unrelated failures instead of chasing them.
9. Archive a completion report and update progress before claiming completion.
10. End with exactly one session outcome required by `AGENTS.md`.

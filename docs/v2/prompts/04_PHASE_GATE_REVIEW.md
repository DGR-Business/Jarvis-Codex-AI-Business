# Phase-Gate Review Prompt

Use in a fresh session, preferably with the model that did not implement most of the phase.

```text
Perform an independent Pantheon v2.1.1 phase-gate review for Phase [ID]. Do not
add features or fix defects during the review.

Read the Master Plan, Phase Execution Pack, all Work Packages and completion
reports, relevant ADRs and Provider Decision Records, PROGRESS.json, BLOCKERS.md,
current source, tests and owner-facing UI.

Verify the phase objective against real implementation and evidence. Inspect
the running UI interactively where applicable. Confirm provider decisions were
based on current evidence rather than familiarity. Confirm a fresh Codex or
Claude session can reconstruct the state.

Classify every finding as gate-blocking, follow-up package, accepted limitation
or unrelated issue. Recommend PASS, CONDITIONAL PASS or FAIL. Stop after the
review report and end with PHASE GATE REVIEW COMPLETE: OWNER DECISION REQUIRED.
```

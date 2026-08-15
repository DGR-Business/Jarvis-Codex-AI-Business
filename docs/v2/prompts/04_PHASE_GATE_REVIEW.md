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

Follow the approved Pack's verification contract. For P0, browser/T3/Playwright
is N/A, any unexpected UI delta is a scope failure, optional hooks alone cannot
fail the gate, and Claude continuity remains prepared_not_verified unless a real
sequential rehearsal proves otherwise. Do not create a P1 Pack during the P0
gate; P1 planning starts in a fresh session only after verified P0 integration.

Classify every finding as gate-blocking, follow-up package, accepted limitation
or unrelated issue. For P0, recommend the binary result PASS or FAIL; for any
other phase, use only its approved Pack's decision vocabulary. Stop after the
review report and end with PHASE GATE REVIEW COMPLETE: OWNER DECISION REQUIRED.
```

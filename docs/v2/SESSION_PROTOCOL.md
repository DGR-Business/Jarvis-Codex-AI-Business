# Pantheon v2.1.1 Session and Cross-Agent Handoff Protocol

## 1. Default session boundaries

Use one fresh session for each of the following:

1. phase planning;
2. each approved work package;
3. a cross-model handoff;
4. independent package review when required;
5. phase-gate review;
6. a material Master Plan or Phase Pack amendment.

Continue the existing session when the objective remains the same package and the agent is resolving an in-scope implementation or test failure.

## 2. Start-of-session reconstruction

Before editing, the agent reads:

1. root instructions;
2. Master Plan;
3. current Phase Execution Pack;
4. current Work Package;
5. relevant ADRs;
6. `PROGRESS.json`;
7. `BLOCKERS.md`;
8. `ACTIVE_HANDOFF.md`;
9. Git status, diff and recent commits;
10. relevant production and test files.

The agent then states the package objective, current state, remaining criteria and first action.

## 3. Live checkpointing

While work is incomplete, keep `ACTIVE_HANDOFF.md` current.

Update it after:

- each acceptance criterion completed;
- each coherent verified checkpoint;
- a changed diagnosis;
- a new blocker;
- a long-running operation;
- an expected model handoff.

This is deliberately more frequent than final logging so an abrupt usage limit is survivable.

## 4. End-of-session outcomes

Every session ends with exactly one:

### A. Package complete

`PACKAGE COMPLETE: START A NEW SESSION FOR [NEXT-ID]`

Required before saying it:

- acceptance criteria passed;
- required tests/browser checks passed;
- completion report archived;
- progress updated;
- active handoff closed;
- Git status summarized.

### B. Same package continues

`PACKAGE IN PROGRESS: CONTINUE THIS SESSION`

Use only when the same session remains active and no model transfer is needed.

### C. Cross-model handoff

`HANDOFF READY: OPEN THE SAME WORKTREE IN [CODEX/CLAUDE]`

Required before saying it where possible:

- active handoff updated;
- current failure or next action stated;
- Git status and diff summarized;
- safe checkpoint commit made if justified;
- no destructive cleanup.

### D. Owner blocker

`BLOCKED: OWNER ACTION REQUIRED`

State the exact action, why it cannot be delegated and what work can continue independently.

## 5. Codex to Claude Code

1. Stop all Codex editing in the package worktree.
2. Preserve uncommitted changes.
3. Update `ACTIVE_HANDOFF.md` if possible.
4. Open a fresh Claude Code session in the same worktree.
5. Use the handoff-continuation prompt.
6. Claude reconciles package scope, Git state and evidence before editing.
7. Claude continues the same package only.

## 6. Claude Code to Codex

Use the same process. Start a fresh Codex session rather than reopening an old Codex conversation as authority.

## 7. Abrupt usage exhaustion

When the outgoing agent cannot write a final handoff:

- do not discard uncommitted changes;
- the receiving agent reconstructs state from package, Git diff, tests, progress and the latest handoff checkpoint;
- classify uncertainty as `F: handoff uncertainty`;
- run targeted characterization before changing ambiguous work;
- record the reconstructed state before continuing.

## 8. Concurrency prohibition

Codex and Claude Code must never write to the same worktree simultaneously. Read-only research may run in parallel only when it cannot mutate shared state.

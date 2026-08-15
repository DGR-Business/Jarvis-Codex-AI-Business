# Work Package [ID]: [Title]

**Phase:** [phase]  
**Status:** backlog / ready / in_progress / blocked / review / complete  
**Branch/worktree:** [name]  
**Master Plan version:** 2.1.1
**Execution Pack version:** [version]  
**Session type:** planning / implementation / handoff continuation / review  
**Preferred agent:** Codex / Claude Code / either  
**Cross-agent handoff permitted:** yes/no

## Objective

[One verifiable objective.]

## Business reason

[Why this matters to Pantheon.]

## Prerequisites

- ...

## Required reading

- `AGENTS.md`
- `CLAUDE.md` when using Claude Code
- `docs/v2/PANTHEON_V2_MASTER_PLAN.md`
- current Phase Execution Pack
- relevant ADRs
- `docs/v2/PROGRESS.json`
- `docs/v2/BLOCKERS.md`
- `docs/v2/ACTIVE_HANDOFF.md`
- relevant production and test files

## In scope

- ...

## Out of scope

- ...

## Likely affected domains/files

- ...

## Implementation constraints

- Do not change unrelated behaviour.
- Do not begin another package.
- Use facades and typed contracts.
- Do not add production dependencies, providers or MCP servers without explicit authority.
- Maintain `ACTIVE_HANDOFF.md` while incomplete.

## Acceptance criteria

- [ ] ...

## Verification commands

```bash
# T0
...

# T1/T2
...
```

## Interactive browser and E2E requirement

- interactive running-app review required: yes/no
- views/journeys to inspect:
- console/network inspection:
- Playwright required: yes/no
- justification if yes:
- exact E2E commands:

## Required evidence

- test output:
- browser screenshots/recording:
- traces where required:
- contract/provider examples:
- progress record:
- ADR or Provider Decision Record:

## Checkpoint and Git policy

- coherent checkpoint commit allowed: yes/no
- completion commit allowed: yes/no
- push allowed: yes/no
- PR allowed: yes/no

## Failure classification

- A introduced regression:
- B touched-domain pre-existing issue:
- C unrelated issue:
- D environment/provider issue:
- E plan deficiency:
- F handoff uncertainty:

## Rollback

[Exact rollback path.]

## Stop conditions

Stop and update handoff/blockers when:

- scope expansion is required;
- owner credentials, terms or action are required;
- the baseline is invalid;
- a provider contract differs materially from the approved assumption;
- safe completion cannot fit the current package.

## Completion report

- summary:
- files changed:
- criteria:
- tests/browser evidence:
- decisions:
- blockers:
- commits:
- next ready package:
- Git status:
- final session instruction:

Package implementation/handoff sessions use exactly one package outcome from
`AGENTS.md`. Planning, amendment, standalone reconciliation and phase-gate
sessions use the distinct exact ending in `docs/v2/SESSION_PROTOCOL.md`.

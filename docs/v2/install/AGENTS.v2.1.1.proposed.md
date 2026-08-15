# Pantheon Engineering Agent Instructions

These instructions apply to OpenAI Codex, Claude Code through `CLAUDE.md`, and any future coding agent working on Pantheon.

## Authority order

When sources conflict, use this order and stop for an amendment if the conflict is material:

1. approved current work package;
2. approved current Phase Execution Pack;
3. approved ADRs;
4. `docs/v2/PANTHEON_V2_MASTER_PLAN.md`;
5. `docs/v2/PROGRESS.json`, `BLOCKERS.md` and `ACTIVE_HANDOFF.md`;
6. current source code, tests and provider contracts;
7. conversation history or model memory.

Conversations are never the programme source of truth.

## Repository root and path portability

- The canonical Windows master-worktree path is `C:\Pantheon`.
- At the start of every planning, implementation, handoff or review session,
  run `git rev-parse --show-toplevel` and treat that result as authoritative.
- Never rely on the former folder name, a remembered chat path or a recent-project entry.
- Never hard-code the local repository path or local folder name into production code,
  tests, provider manifests, workflow definitions or portable scripts.
- Derive paths from the active Git root, module location, existing root configuration
  or an explicit validated environment variable.
- Place linked package worktrees outside the main root, preferably under
  `C:\Pantheon-worktrees\<package-id>`.
- If the current root is unexpectedly different, a linked worktree is broken, or an
  old absolute path remains operationally significant, stop and record a blocker.

## Session contract

- Default to one fresh implementation session per work package.
- Planning and phase-gate review use separate fresh sessions.
- Continue the same session for local debugging that remains within the same package.
- Do not begin another work package automatically.
- Maintain `docs/v2/ACTIVE_HANDOFF.md` while a package is in progress.
- At the end of every session, state exactly one:
  - `PACKAGE COMPLETE: START A NEW SESSION FOR [NEXT-ID]`
  - `PACKAGE IN PROGRESS: CONTINUE THIS SESSION`
  - `HANDOFF READY: OPEN THE SAME WORKTREE IN [CODEX/CLAUDE]`
  - `BLOCKED: OWNER ACTION REQUIRED`

## Cross-agent continuity

- Codex is the primary implementation agent; Claude Code is an approved continuity, secondary implementation and independent-review agent.
- Use the same package branch/worktree sequentially. Never let two writing agents edit it concurrently.
- A receiving agent must inspect the package, handoff, Git state, diff, recent commits and tests before editing.
- Preserve valid work from the prior agent. Complete the package contract, not the prior model's presumed intention.
- Model auto-memory is advisory only. Repository records are authoritative.

## Scope discipline

- Work only from an approved package.
- Do not broaden scope or absorb unrelated defects.
- Classify failures before acting.
- Do not alter commercial truth, approval, accounting, evidence or authority semantics without package authority and an ADR where required.
- Do not introduce frameworks, production dependencies, MCP servers or providers without explicit package authority.
- Preserve rollback for migrations and external integrations.

## Provider discipline

- Agents request capabilities, not provider brands.
- Owner or agent suggestions are candidates, not pre-approval.
- Provider discovery and provider integration are separate packages or clearly separated stages.
- Do not install an arbitrary MCP server, grant credentials, accept provider terms or activate live spend during discovery.
- Runtime execution may use only approved active providers in the registry.
- Use current official documentation and record review dates.

## UI and browser QA

- For material owner-facing UI changes, run the actual application and inspect it interactively in Codex's native browser, connected Chrome, Claude's supported browser/computer-use path, or another approved interactive browser.
- Exercise the affected user journey and inspect console/network state where relevant.
- Do not infer visual correctness from source code.
- Use Playwright only for stable critical flows or justified durable regression, not as a mandatory checkbox for every UI edit.

## Testing

- During implementation, use T0 and targeted T1/T2 checks.
- Run only package-specified E2E tests.
- Run full regression at package or phase gates as specified, not after every edit.
- Record verification evidence before completion.

## Git

- Avoid micro-commits and repetitive repository reviews.
- Commit coherent verified checkpoints or package completion only.
- A checkpoint commit is permitted when it materially improves handoff safety.
- Do not push, open a PR, merge or rewrite history unless the package permits it.

## Completion

Before stopping, update the required progress, blocker, handoff and evidence records. Never claim completion while acceptance criteria or required verification remain unmet.

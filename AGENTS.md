# Pantheon v2.1.1 Engineering Agent Instructions

These instructions apply to OpenAI Codex, Claude Code through `CLAUDE.md`, and any future coding agent working on Pantheon.

## Governing authority

Read the programme contract as a specialization chain, not as permission for a
lower-level document to rewrite a higher-level one:

1. the approved current Work Package is the most-specific implementation
   contract within its owner-approved Phase Execution Pack;
2. that Phase Execution Pack may explicitly specialize Master Plan execution
   for its phase;
3. relevant approved ADRs record authorized decisions;
4. `docs/v2/PANTHEON_V2_MASTER_PLAN.md` supplies the stable programme contract;
5. `docs/v2/PROGRESS.json`, `BLOCKERS.md` and `ACTIVE_HANDOFF.md`;
6. current source code, tests and provider contracts;
7. conversation history or model memory.

A Work Package cannot silently amend or contradict its Pack, relevant ADRs or
non-specialized Master constraints. Stop for an owner-reviewed amendment when
a material conflict remains. State files report execution state; they do not
create implementation authority. Conversations are never the programme source
of truth.

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
- At the end of a package implementation, continuation, review, handoff or
  blocker session, state exactly one:
  - `PACKAGE COMPLETE: START A NEW SESSION FOR [NEXT-ID]`
  - `PACKAGE IN PROGRESS: CONTINUE THIS SESSION`
  - `HANDOFF READY: OPEN THE SAME WORKTREE IN [CODEX/CLAUDE]`
  - `BLOCKED: OWNER ACTION REQUIRED`
- Distinct non-implementation sessions use their own exact endings:
  - phase planning: `PHASE PLAN READY: OWNER REVIEW REQUIRED`
  - plan amendment: `PLAN AMENDMENT READY: OWNER REVIEW REQUIRED`
  - standalone package reconciliation:
    `PACKAGE RECONCILIATION COMPLETE: IMPLEMENTATION AUTHORITY REQUIRED`
  - independent phase gate:
    `PHASE GATE REVIEW COMPLETE: OWNER DECISION REQUIRED`

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

## Safety boundaries

- Never print or commit secrets. Inspect environment controls by name or with
  synthetic sentinels, not by exposing values.
- Do not run destructive Git commands, rewrite history, discard another
  agent's work or mutate remotes unless the approved package explicitly permits
  the exact operation.
- Do not inspect, modify, delete or recover owner data, production databases,
  artifacts or recovery sets unless the package explicitly authorizes it and
  supplies a safe rollback.
- Run tests and verification only as the approved Package and Pack specify,
  through their required isolated wrappers. Never enable a hosted/lifecycle
  test locally to obtain a passing result.
- Keep technical completion and test evidence separate from buyer, revenue or
  commercial proof. Never present fixtures, dry runs or passing tests as market
  validation or business success.
- Do not bypass authentication, CAPTCHAs, paywalls, robots controls, rate limits,
  private endpoints or other technical access controls.
- Publishing, customer contact, account/KYC/OAuth/MFA work, legal acceptance,
  money movement and undelegated spend remain protected actions requiring the
  recorded authority.

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

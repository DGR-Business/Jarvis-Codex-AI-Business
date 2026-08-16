# Phase P0 Execution Pack: v2.1.1 Engineering Baseline

- **Phase:** P0 — v2.1.1 engineering operating system
- **Master Plan version:** 2.1.1
- **Pack version:** 0.2-draft
- **Prepared from commit:** `718e50670812ad5da7210bd9f183521328cccf93`
- **Prepared on:** 2026-08-15 (Australia/Brisbane)
- **Status:** Approved — owner decision recorded 2026-08-15
- **Implementation authority:** The five embedded package specifications are
  approved; P0-W01 is ready but has not started

This file is the approved Phase Execution Pack. Its embedded specifications are
materialised under `docs/v2/work-packages/`; implementation begins only in the
fresh session for the ready package. Approval and later package state are
recorded through normal Git commits, `PROGRESS.json`, `BLOCKERS.md`,
`ACTIVE_HANDOFF.md`, and package completion records. Git's content-addressed
history is the primary integrity mechanism; Phase 0 will not add a parallel
trust-anchor, receipt, attestation, or SHA-manifest system.

The current root `AGENTS.md` is the intentionally transitioned Pantheon v2.1.1
instruction file and governs this revision. `AGENTS.legacy-pre-v2.md` is
historical reference only. Compatible substantive safeguards may be retained
from it, but its former authority model and assurance-heavy development method
must not be restored.

## 1. Owner summary

Phase 0 makes Pantheon ready for disciplined fresh-session engineering without
changing Pantheon business behaviour. It safely separates the existing dirty
work, establishes a clean v2 lane, reconciles the repository-owned development
contract, adds only small continuity tools that demonstrably help, hardens the
ordinary test environment, rehearses fresh-session continuity, and concludes
with an independent gate and owner-approved integration into local `main`.

The phase is intentionally five bounded Work Packages. Each has one focused
Goal Mode implementation objective. W04's fresh Codex/Claude probes are bounded
verification/handoff steps, not additional implementation scope. W05 alone has
an unavoidable owner-decision pause: an independent gate session, then a short
fresh integration session after explicit approval.

Phase 0 is support work. It creates no buyer evidence, revenue, provider
qualification, commercial validation, production deployment, or owner-facing
feature. It ends with the repository ready for a fresh, just-in-time Phase 1
planning session; it does not create the Phase 1 Execution Pack.

## 2. Phase objective and success condition

Create a clean, portable, test-safe and repository-reconstructable Pantheon
v2.1.1 engineering baseline that Codex can use immediately, that Claude Code
can use when provisioned, and that can be integrated into `main` after
independent review without losing or misrepresenting the existing WIP.

Phase 0 succeeds when:

- the pre-existing dirty work has an explicit, recoverable disposition;
- the verified Phase 0 branch contains only authorized engineering-support
  changes and normal evidence records;
- authority, version, session, instruction and tracked-skill contracts agree;
- ordinary tests cannot inherit owner credentials or write to owner paths;
- a fresh session can reconstruct the exact current state and next action from
  the repository;
- cross-model continuity is labelled `verified` only after a real Claude Code
  rehearsal, otherwise it is labelled `prepared_not_verified`;
- an independent gate passes; and
- after explicit owner approval, `C:\Pantheon` is clean, checked out on local
  `main`, and points at the verified integrated Phase 0 tip.

## 3. Approval and governing clarifications

### 3.1 What pack approval authorizes

The owner approval recorded in section 20 approves the following Phase 0
approach:

Approval also approves the five embedded package specifications. It makes W01
`ready` once the selected WIP disposition is recorded; later packages become
`ready` only when their listed dependencies complete. A separate package
approval is required only if a specification is materially amended.

1. Preserve every reviewed repository work-product WIP path by default on a
   named Git branch and coherent checkpoint labelled unverified. Never sweep
   ignored credentials, owner data or generated runtime/recovery state into Git
   merely to make a snapshot exhaustive. Any discard must be separately
   explicit and exact-path scoped.
2. Use one external Phase 0 worktree and branch sequentially for W01-W04,
   preferably `C:\Pantheon-worktrees\P0-engineering-os` on
   `codex/p0-engineering-os`, with one writing agent at a time.
3. Use normal Git commits and the existing v2 state files as the complete
   continuity layer. Do not build another integrity, orchestration or version
   control subsystem.
4. Make hooks optional and evidence-based. A justified no-hook result is
   acceptable and does not require a Master Plan amendment.
5. Treat interactive browser, T3 and Playwright verification as not applicable
   to P0 because P0 permits no material owner-facing UI change.
6. Create the P1 Execution Pack just in time from the actual post-P0 repository
   in a new planning session, not during P0.
7. Treat Claude Code unavailability as nonblocking to unrelated P0 work. Record
   compatibility as `prepared_not_verified` until a real sequential rehearsal;
   never claim verified cross-model continuity without it.
8. Make local `main` the normal verified integration destination after the
   independent gate and a separate explicit owner approval. Push, PR, remote
   mutation and branch deletion remain unauthorized.

### 3.2 Explicit Master Plan specializations

The current Master Plan literally lists simple hooks, T3/T4 at a phase gate,
an owner-approved P1 pack, and Codex/Claude reconstruction as Phase 0
deliverables or exit conditions. This approved pack deliberately specializes those
statements for the current evidence:

- hooks are investigated and installed only if a current, repository-scoped,
  low-risk mechanism clearly reduces future error;
- P0 runs the full ordinary regression at its gate but no browser/T3 smoke,
  because it changes no UI; and
- P1 planning occurs after P0 from the integrated repository.
- unavailable Claude Code is recorded as `prepared_not_verified`; unrelated P0
  work and a truthful Phase 0 gate need not wait, but cross-model continuity
  cannot be called verified before the real rehearsal.

These are explicit P0-specific specializations under the current root authority
order, not a silent Master rewrite. The recorded approval authorizes W02 to
record a concise ADR and align the active Engineering/Session protocols and prompts.
It does not edit or re-version the 2.1.1 Master Plan during P0. A later planned
Master revision may absorb the general lessons. W01 may proceed first because
its custody, path and baseline work does not depend on these specializations.

### 3.3 Authority interpretation pending W02

An owner-approved Phase Pack may explicitly specialize Master Plan execution for
its phase. An approved Work Package is the most specific implementation
contract within that Pack and may not silently contradict the Pack, relevant
ADRs or non-specialized Master constraints. A material conflict stops for an
owner-reviewed amendment. W02 will express this consistently in all active
documents.

## 4. Current repository baseline

The facts below are planning-audit findings, not a green baseline. W01 must
recheck them before acting because the worktree remains live and dirty.

### 4.1 Git and existing WIP

- `git rev-parse --show-toplevel` returns `C:/Pantheon`.
- `C:\Pantheon` is the sole registered worktree and is currently on
  `pantheon-v2.1.1-programme` with no configured upstream.
- `HEAD`, local `main`, and the locally cached `origin/main` point to
  `718e50670812ad5da7210bd9f183521328cccf93`. Remote freshness was not proved
  in this planning session.
- The remote identity remains
  `DGR-Business/Jarvis-Codex-AI-Business`; a remote repository name may differ
  from the canonical local folder name.
- Git reports `extensions.worktreeConfig=true` but no active
  `.git/config.worktree` exists. Ordinary discovery currently works; W01 must
  revalidate this before creating the linked lane and must not speculatively
  repair it.
- The working tree has no staged changes. The status snapshot has 22 tracked
  paths marked modified and 49 non-ignored untracked files when expanded.
  Twenty-one tracked files have content diffs totalling about 2,107 insertions
  and 704 deletions; one additional config path is status-marked but currently
  has no content delta and must be rechecked safely by W01.
- The dirty state mixes substantive governing edits in the current Master Plan
  and Build Log, commercial-support work, runtime/UI/tests, the transitioned
  root instructions, and the untracked v2 kit. The current Build Log records
  pending verification. The tree is neither disposable nor verified green.

W01 must account for this state before any switch, cleanup or baseline claim.
No reset, clean, stash-only custody, broad checkout, history rewrite or silent
catch-all integration into `main` is permitted.

### 4.2 Path portability

- The former local root `C:\Jarvis-Codex-AI-Business` is absent.
- `src/config.js` derives normal data, database and artifact defaults from the
  current module/repository root when overrides are unset.
- `.env.example` still assigns `PANTHEON_DATA_DIR`,
  `PANTHEON_ARTIFACT_ROOT`, and `PANTHEON_PROOF_LEDGER_PATH` to the former
  absolute root. Copying it can create missing or shadow state.
- No other active production source, config or script dependency on that root
  was found. Historical prose, migration examples and the valid remote identity
  are not operational path dependencies and should not be mechanically
  rewritten.
- A name-only environment check found no former-root override, but external
  editor state, shortcuts, scheduled tasks and tool configuration were not
  exhaustively accessible. W01 records such external surfaces as limitations;
  it does not delete external state.

### 4.3 Instructions, contracts and skills

- Root `AGENTS.md` is intentionally the current v2.1.1 instruction file but is
  still part of the uncommitted state. `AGENTS.legacy-pre-v2.md` explicitly says
  it is historical only.
- `CLAUDE.md` correctly imports `AGENTS.md` and adds concise Claude-specific
  rules, but it and the v2 kit are untracked.
- `AGENTS.md` presents approved Package > Pack > ADR > Master as the conflict
  order, while the Engineering Protocol and Master Plan describe Master > Pack
  > Package as the planning hierarchy. The intended specialization/no-silent-
  amendment semantics need one consistent formulation.
- The v2.1.1 Master Plan header still says `Proposed execution baseline`, while
  the owner and current root instructions identify that plan as governing this
  revision. W02 must record its adopted authority without silently changing the
  stable Master file or pretending the status mismatch does not exist.
- The Master Plan and `PROGRESS.json` use 2.1.1, while
  `progress.schema.json` and active templates still require or display 2.1.
  The npm package version `1.0.0` is a separate runtime package version and is
  not to be changed merely for programme-number symmetry.
- Package-session terminal phrases conflict with the distinct planning and
  phase-gate prompts. The protocols must distinguish session types.
- `PROGRESS.json`, `BLOCKERS.md` and `ACTIVE_HANDOFF.md` still describe the
  installation/planning state and contain stale assumptions about the root
  instruction transition and current blockers.
- Seven `.agents/skills/` and `.claude/skills/` pairs are byte-identical, but
  `.gitignore` ignores all of `.agents/`; neither the Codex set nor the untracked
  Claude set is portable through Git. Existing tracked Codex-only skills also
  need review for stale authority or blanket-verification clauses.
- Active `.codex/config.toml` has no hooks. No active repository
  `.claude/settings.json` or `.claude/settings.local.json` exists. Archived
  Claude-era hooks/settings are retired and must not be revived.
- `.codex/config.toml` also declares multi-agent limits including
  `max_depth = 1`, but its effective behaviour has not been proved in a fresh
  session. Configuration text alone is not evidence of enforcement.

### 4.4 Tests and environment isolation

- The current filesystem has 91 root test suites: 90 ordinary suites and the
  quarantined `test/windows-launcher.test.js`, plus 10 support fixtures.
- The durable 848/848 green record applied to an earlier 86-file committed
  baseline. It does not prove the current dirty overlay.
- `npm.cmd test` already creates disposable database/artifact/approval/backup/
  temp paths, locks live mode, restores its PDF temp area, shards ordinary local
  tests, enforces deadlines and excludes lifecycle proof from ordinary runs.
- The wrapper inherits all parent environment entries except a finite denylist.
  It does not redirect both proof-ledger aliases and does not exclude every
  repository-recognized provider, operator, runtime, tool or path control.
- A name-only check found `JARVIS_PRIVACY_HASH_KEY` in the owner shell; its value
  was not read or printed. Current code can read that legacy variable, so this
  is a demonstrated isolation concern rather than a theoretical checklist.
- The current dirty tree's test status is unknown until W01 runs the agreed
  clean-lane baseline in a temporary sanitized environment. W04 owns the
  permanent evidence-based hardening.

The quarantined Windows lifecycle proof remains hosted-CI-only. It must never
be enabled locally by setting CI flags.

### 4.5 Module and domain map

The current dirty-overlay `src/` tree has 124 JavaScript files and about 121,592
lines; 42 modules exceed 800 lines and 13 exceed 2,000. The largest production
files include:

| Module | Lines |
|---|---:|
| `src/db.js` | 11,860 |
| `src/runtime/preventure-research-store.js` | 7,637 |
| `src/runtime/preventure-research-runner.js` | 5,227 |
| `src/runtime/pantheon-production.js` | 5,015 |
| `src/server.js` | 4,851 |
| `src/runtime/preventure-research-execution-bridge.js` | 4,037 |
| `src/runtime/cockpit-state.js` | 3,467 |
| `public/app.js` | 3,446 |
| `src/runtime/agent-runtime.js` | 3,368 |

The main domains are persistence/schema, application composition, pre-venture
research, agent execution, venture/portfolio/production, authority/finance,
monitoring/recovery, owner control plane and provider adapters. Direct database
and SQL coupling remains widespread. This informs future P1/P3 planning; it
does not authorize a P0 refactor or a P1 source-audit schema/verifier.
W01 recomputes or clearly labels the clean-lane baseline rather than carrying
these dirty-overlay counts forward as if they described a different tree.

### 4.6 Provider-neutral findings

Pantheon already contains OpenAI-specific adapters, other named integration
candidates, dry-run paths, credential-presence checks, cost/health reporting and
authority controls. These are baseline facts, not current qualification or
approval. No provider was requalified during planning.
Every provider named in current code or planning remains an unapproved candidate
unless the active registry and a separately authorized decision say otherwise.

P0 may inspect repository structure and record redacted capability readiness.
It may not inspect credential values, query owner data, install a provider or
MCP server, accept terms, make a sandbox/live call, create an account, publish,
contact a buyer, spend money or make a Provider Decision Record. Provider
discovery and integration remain future, separately approved work.

## 5. Scope and phase-wide protections

### In scope

- safe disposition and preservation of the pre-existing working state;
- a clean sequential Phase 0 branch/worktree and normal Git rollback points;
- the known `.env.example` path correction and a concise secret-safe path scan;
- v2 authority, instruction, version/schema, session and skill parity repair;
- small dependency-free status/package/handoff assistance only where it reduces
  demonstrated fresh-session error;
- evidence-based hardening of the existing ordinary test wrapper;
- fresh-session reconstruction and a real cross-model handoff rehearsal when
  Claude Code is provisioned;
- time-boxed investigation of current repository-scoped hook support;
- ordinary package completion records and an independent Phase 0 gate; and
- owner-approved fast-forward integration into local `main`.

### Out of scope

- implementing, completing, releasing or semantically changing the existing
  commercial-support/product WIP as part of P0;
- new changes to `src/`, `public/`, runtime schemas/databases, owner data,
  provider adapters, business config, commercial truth, approvals, accounting,
  runtime/commercial authority semantics, recovery behaviour or owner-facing UI;
- P1 source-audit tooling, a P1 Execution Pack or any P1 implementation;
- trust anchors, approval receipts, hash chains, SHA manifests, unique-add-
  commit assertions, self-attestation, custody ledgers or a second progress
  database;
- new frameworks, production dependencies, MCP servers, provider integrations,
  credentials, subscriptions, terms, live/sandbox calls or spend;
- interactive browser, T3, Playwright, UI screenshots or runtime smoke for P0;
- global/user Codex or Claude configuration and revival of archived settings;
- remote fetch/push, PR, merge on a hosting service, release, branch deletion,
  history rewrite or destructive Git cleanup without separate authority; and
- deletion or modification of owner databases, artifacts, recovery sets,
  external tools, shortcuts or scheduled tasks.

### Substantive safety rules retained

- Never commit or print secret values. Environment audits are name-only or use
  synthetic sentinels.
- Never conflate technical completion with buyer, revenue or commercial proof.
- No live provider/customer/publishing/account/legal/spend action is authorized.
- Do not bypass authentication, CAPTCHAs, paywalls, robots controls, rate limits
  or private endpoints.
- No destructive Git command, owner-data access, production mutation, recovery
  operation or unrelated repair is authorized by this pack.
- Use `npm.cmd test` so the repository wrapper remains active; never run the
  quarantined lifecycle test locally.
- Preserve historical/archived material as reference; do not restore it as
  active authority or configuration.

## 6. Approved architecture decisions

The owner approved these decisions on 2026-08-15. W02 records one concise
ADR and aligns supporting active contracts without editing/re-versioning the
Master or creating an assurance framework around them.

| Decision | Approved outcome | Reason |
|---|---|---|
| P0-D01 | An approved Pack may explicitly specialize Master execution for its phase; a Package is the most-specific contract within that Pack and material conflict requires amendment. | Reconcile the authority-order conflict without letting a package silently rewrite programme intent. |
| P0-D02 | One sequential external P0 branch/worktree, one writer at a time. | Separate dirty WIP from Phase 0 while avoiding worktree administration per small package. |
| P0-D03 | Git commits plus `PROGRESS.json`, `BLOCKERS.md`, `ACTIVE_HANDOFF.md` and `COMPLETION.md` are the continuity layer. | Use existing version control and keep fresh-session state simple. |
| P0-D04 | Hooks are optional, repository-scoped and justified by current support/evidence. | Avoid turning enforcement into another subsystem. |
| P0-D05 | P0 browser/T3/Playwright is N/A; future material UI packages retain browser-first, Playwright-selective policy. | P0 permits no UI change. |
| P0-D06 | P1 planning is just in time after verified P0 integration. | Base the next pack on the actual repository rather than a premature audit schema. |

## 7. Work packages and session map

Packages run sequentially; no package starts automatically when the prior one
finishes.

| ID | Objective | Dependency | Session | Preferred agent | Handoff | Status |
|---|---|---|---|---|---|---|
| P0-W01 | Preserve/dispose WIP, establish clean v2 lane, fix known path issue and verify baseline | Approved pack and owner WIP disposition | Fresh implementation | Codex | Yes | Ready |
| P0-W02 | Reconcile authority, instructions, version/schema/session protocol and tracked skills | W01 | Fresh implementation | Codex | Yes | Approved; dependency pending |
| P0-W03 | Add only lightweight repository-owned continuity tooling | W02 | Fresh implementation | Codex | Yes | Approved; dependency pending |
| P0-W04 | Harden test environment and rehearse fresh/cross-model continuity; investigate optional hooks | W03 | Fresh implementation/handoff | Codex, then Claude when available | Yes | Approved; dependency pending |
| P0-W05 | Perform independent gate and, after owner approval, integrate into local `main` | W01-W04 | Fresh review, then short fresh authorized integration session | Fresh independent reviewer; Claude preferred if available, otherwise fresh Codex | Yes | Approved; dependency pending |

All five embedded specifications are approved. P0-W01 is `ready` because the
approved WIP disposition is recorded in section 20; dependency completion
controls later readiness in `PROGRESS.json`.

## 8. Common package contract

### Required reading and reconstruction

Every package session begins by reading root instructions, the Master Plan,
this pack, the current Work Package record, relevant ADRs, `PROGRESS.json`,
`BLOCKERS.md`, `ACTIVE_HANDOFF.md`, Git status/diff/recent commits, and the
files/tests it will touch. Claude Code also reads `CLAUDE.md`.

The agent states the package objective, current state, remaining criteria and
first action before editing. A receiving agent reconciles the same worktree and
preserves valid prior work. Codex and Claude Code never write concurrently.

### State, evidence and Git

- Maintain `ACTIVE_HANDOFF.md` only while a package is active.
- On completion, update `PROGRESS.json` and `BLOCKERS.md`, close the handoff,
  and create `docs/v2/evidence/packages/[ID]/COMPLETION.md`.
- Record commands, results, changed files, limitations and ordinary commit SHAs
  in the completion record. Record only SHAs already known at write time; the
  completion commit's own SHA remains available through normal Git history.
  Do not create duplicate evidence manifests.
- Commit coherent verified checkpoints or package completion, not every edit.
- No push or PR is permitted. W05 alone may fast-forward local `main` after the
  owner approves the passing gate.
- The single P0 worktree remains available through the gate. Removing it or
  deleting branches is later cleanup requiring separate authority.

### Verification policy

- Use T0 and targeted T1/T2 checks during packages.
- Run the full ordinary suite once in W01 for the clean baseline and once at the
  W05 gate; W04 also runs it after changing the test wrapper.
- Classify failures A-F under the Master Plan and do not chase unrelated defects.
- Never enable or run `test/windows-launcher.test.js` locally.
- Interactive browser/T3/Playwright: **not applicable for every P0 package**.
  Any unexpected material UI change is a scope failure, not a reason to add a
  P0 browser smoke.

### Common stop conditions

Stop, update handoff/blockers, and request owner direction when:

- the Git root, branch, baseline, worktree or WIP ownership is unexpected;
- a secret value, owner path/data, recovery set or live credential may be read,
  printed, committed or modified;
- destructive Git, remote mutation, a new dependency/tool/provider, external
  terms, spend or commercial action would be required;
- `src/`, `public/`, runtime schema/database, business behaviour or owner-facing
  UI would need a new P0 change;
- a material governing conflict needs more than the approved W02 clarification;
- a package cannot fit its bounded objective; or
- another writing agent has changed the same worktree.

## 9. P0-W01 — Preserve WIP and establish the clean Phase 0 baseline

**Objective:** Preserve or dispose the current dirty state exactly as the owner
authorizes, establish a clean Phase 0 lane from the revalidated local `main`,
correct the known former-root example, and record a truthful baseline result.

**Business reason:** Phase 0 must not lose unfinished work, mix it into an
engineering-kit baseline, or build on a falsely green repository.

**Prerequisites:** Owner approval of this pack (including embedded W01) and
approval of the WIP disposition. The proposed safe default is preserve every
reviewed source, document, config, test and intended skill work-product path on
a named branch and coherent unverified checkpoint. Do not add ignored
credentials, owner data or generated runtime/recovery state. Any discard must
name exact paths. Finishing or releasing commercial WIP is separate work.

**Likely affected:** Git branch/worktree state, `.env.example`, approved v2
scaffold files, and P0 baseline/completion records. No new production-code edit.

### Acceptance criteria

1. [ ] Revalidate root, branch, HEAD, remote, worktrees, staged/unstaged/
   untracked/ignored state and account for every material pre-existing WIP
   group without inferring commercial intent or reading ignored credential/
   owner-data contents. The repository-owned ignored `.agents/skills/` set is
   identified separately from generated/private/runtime categories.
2. [ ] Execute only the owner-approved disposition: preserve the exact state on
   a named Git branch/coherent checkpoint labelled unverified for every approved
   material repository work-product path—including the repository-owned
   `.agents/skills/` set—or discard only exact owner-authorized paths after
   preservation. Ignored credentials, owner data and generated runtime/recovery
   files remain outside Git. No reset, clean, stash-only custody, history
   rewrite or ambiguous broad checkout occurs.
3. [ ] Record the revalidated local `main` SHA as baseline `B` and establish
   `codex/p0-engineering-os` as its descendant in an external clean worktree.
   Bring across only the reviewed v2.1.1 engineering scaffold needed to govern
   P0—including the current root instructions, `CLAUDE.md` and this pack.
   Product/commercial WIP remains recoverable outside the lane; W02 owns the
   scaffold's contract reconciliation. Unexpected movement of `main` stops W01.
4. [ ] Replace the three former-root assignments in `.env.example` with
   guidance that uses existing root-derived defaults unless an operator supplies
   an explicit validated external path; do not hard-code `C:\Pantheon` instead.
5. [ ] A secret-safe active-file scan finds no operational former-root
   dependency. Historical prose/remote identity is classified, and inaccessible
   external-tool surfaces are recorded as limitations rather than false passes.
6. [ ] Exact-lockfile dependencies are hydrated without changing package files;
   `git diff --check`, lint and one full ordinary test run then complete in a
   temporary credential-free, path-isolated child environment. It redirects
   both proof-ledger aliases, retains only validated required OS/Node/npm/
   renderer/Python tool paths and keeps lifecycle disabled. Any failure is
   classified without calling a provider or touching owner state.
7. [ ] The completion record references this pack's audit and records only the
   clean-lane revalidation/deltas: test inventory/result, dirty-WIP disposition,
   module/domain changes and redacted provider-neutral changes or limitations.
   It builds no verifier and makes no call.
   The substantive dirty Master Plan/Build Log updates receive an explicit
   owner disposition or reference; the clean lane must not silently present
   their older committed versions as current verified truth.
8. [ ] The P0 lane ends clean and commit-addressable, with no new `src/`,
   `public/`, runtime data/schema, UI, commercial or business-behaviour delta.

### Concise verification commands

```powershell
git rev-parse --show-toplevel
git status --porcelain=v2 --branch --untracked-files=all
git worktree list --porcelain
git config --get extensions.worktreeConfig
Test-Path .git\config.worktree
git check-ignore --no-index -v .agents/skills/pantheon-work-package-executor/SKILL.md
git diff --check
rg -l -F 'Jarvis-Codex-AI-Business' --hidden -g '!.git/**' -g '!archive/**' .
# If the clean lane lacks the exact locked dependencies: npm.cmd ci --ignore-scripts
node --version
npm.cmd --version
npm.cmd run lint
# Run npm.cmd test only through the recorded W01 one-use sanitized child environment.
```

Run the npm commands from the clean P0 lane in a new temporary process that
passes only required OS/Node/npm variables and no Pantheon/Jarvis/provider
credential or owner-path variables. It must set disposable current/legacy
proof-ledger paths and pass a synthetic-sentinel preflight without exposing
values. W01 records the concise exact invocation after validating required
renderer/Python/tool paths; it must not paste a large generic shell harness into
the package or create the permanent W04 solution early. When needed,
`npm.cmd ci` is locked hydration only: no package/lockfile edit or install script
is authorized.

**Browser/E2E:** N/A. Do not run the application or Playwright.

**Evidence and checkpoint:** One ordinary WIP-preservation checkpoint if needed,
one coherent W01 completion commit in the P0 lane, and
`docs/v2/evidence/packages/P0-W01/COMPLETION.md`. No custody manifest or hashes
beyond normal commit SHAs.

**Rollback:** Keep the preserved WIP ref and P0 branch. Before integration,
revert a coherent W01 commit or abandon the P0 branch after owner review; never
rewrite or delete the preservation history automatically.

**Additional stop conditions:** An intended WIP disposition is unclear; a
secret may be present in the proposed checkpoint; the clean baseline cannot be
identified; or safe baseline testing cannot be isolated.

## 10. P0-W02 — Reconcile programme authority and the cross-agent contract

**Objective:** Make the Master/Pack/Package authority, current instructions,
programme version, session outcomes, progress state and shared skill tracking
consistent and cloneable.

**Business reason:** Fresh agents need one small, truthful contract rather than
conflicting active documents or historical methodology.

**Dependency:** Completed W01 clean lane.

**Likely affected:** `AGENTS.md`, `CLAUDE.md`, `AGENTS.legacy-pre-v2.md`, active
`docs/v2/` protocols/templates/prompts/state, one concise ADR,
`.gitignore`, `.agents/skills/`, `.claude/skills/`, and the stale tracked
`.codex/skills/pantheon-commercial-steward/SKILL.md` clauses. No hooks or
continuity scripts in this package.

### Acceptance criteria

1. [ ] Active authority text consistently states that an owner-approved Phase
   Pack may explicitly specialize Master execution for its phase; the approved
   Work Package is the most-specific contract within that Pack and cannot
   silently amend it, relevant ADRs or non-specialized Master constraints.
2. [ ] The owner-directed P0 specializations—optional hooks, no P0 browser/T3,
   just-in-time post-P0 P1 planning, and honest Claude deferral—are recorded in
   one concise ADR and aligned supporting protocols/prompts. The stable 2.1.1
   Master is not silently edited or re-versioned during P0.
3. [ ] Root `AGENTS.md` remains the concise v2.1.1 authority and
   `AGENTS.legacy-pre-v2.md` remains clearly historical. Only compatible safety
   rules concerning secrets, destructive Git, owner data/recovery, isolated
   tests, providers and protected commercial actions survive; the legacy
   assurance method and obsolete authority paths do not. The historical file is
   tracked as reference, not imported as active instruction.
4. [ ] `CLAUDE.md` imports `AGENTS.md` and contains only concise Claude-specific
   continuity/review rules. Archived Claude settings, agents, hooks and memory
   remain retired; the active root file is tracked.
5. [ ] Active engineering contracts consistently use programme version 2.1.1,
   including progress schema/ledger and templates. The independent npm package
   version remains separate and changes only for a runtime release reason.
6. [ ] The four package/handoff/blocker terminal instructions apply to package
   sessions; planning, amendment, standalone reconciliation and phase-gate
   sessions retain their distinct exact endings and non-implementation
   semantics. The P0 gate prompt uses binary `PASS`/`FAIL`, not the generic
   `CONDITIONAL PASS`, so a fresh reviewer receives one contract.
7. [ ] The seven existing `.agents/skills/` and `.claude/skills/` pairs are
   narrowly unignored, tracked and materially identical. Any intentional
   agent-specific skill is explicit and cannot weaken shared safeguards; stale
   authority/full-verification clauses in the tracked commercial-steward skill
   are reconciled while its commercial-truth safeguards remain.
8. [ ] `PROGRESS.json`, `BLOCKERS.md` and `ACTIVE_HANDOFF.md` truthfully identify
   the approved/draft pack state, current package/agent/worktree and real
   blockers without claiming P0 completion, hook enforcement or Claude
   verification.

### Concise verification commands

```powershell
git diff --check
rg --pcre2 -n '2\.1(?!\.1)' docs/v2 AGENTS.md CLAUDE.md
git check-ignore --no-index -v .agents/skills/pantheon-work-package-executor/SKILL.md
if ($LASTEXITCODE -eq 0) { throw 'Shared Codex skill is still ignored' }
git ls-files .agents/skills .claude/skills
git diff --no-index --exit-code -- .agents/skills .claude/skills
if ($LASTEXITCODE -ne 0) { throw 'Shared skill sets differ' }
node -e "const f=require('fs');const p=JSON.parse(f.readFileSync('docs/v2/PROGRESS.json'));const s=JSON.parse(f.readFileSync('docs/v2/progress.schema.json'));if(p.masterPlanVersion!=='2.1.1'||s.properties.masterPlanVersion.const!=='2.1.1')process.exit(1)"
```

Every remaining `2.1` match must be intentional history or corrected; the
negative result from `git check-ignore` confirms the shared Codex skill is no
longer ignored.

**Browser/E2E:** N/A.

**Evidence and checkpoint:** Targeted static/JSON results and
`docs/v2/evidence/packages/P0-W02/COMPLETION.md`; one coherent completion commit.
No instruction hash manifest.

**Rollback:** Revert the coherent W02 commit. Do not restore legacy authority or
archived Claude configuration as a shortcut.

**Additional stop conditions:** The required reconciliation changes programme
intent beyond the owner-approved Pack specializations, a shared skill needs a new
provider/dependency, or agent-specific behaviour would weaken common safety.

## 11. P0-W03 — Add lightweight continuity tooling

**Objective:** Provide the smallest repository-owned status/package/handoff
assistance that materially reduces fresh-session reconstruction errors.

**Business reason:** Agents should find the current state quickly without
turning Phase 0 into an orchestration product.

**Dependency:** Completed W02 contracts and truthful state files.

**Likely affected:** One small dependency-free `scripts/v2/status.js`, one
focused test file, concise usage documentation and package evidence. Handoff
updates remain direct, reviewable edits to `ACTIVE_HANDOFF.md`.

### Acceptance criteria

1. [ ] The implementation note grounds the single helper in the demonstrated
   problem: contradictory/stale v2 state files and no concise read-only status
   command. It reuses Git/npm/Node rather than reopening a broader tool design.
2. [ ] One read-only status/check command, rooted from the active Git repository,
   reports root, branch/HEAD, dirty state, current phase/package, active agent/
   worktree, blockers, handoff state and exact next action without printing
   environment values or secrets.
3. [ ] Its validation is limited to v2.1.1 and consistency among the current
   package, dependencies, `PROGRESS.json`, `BLOCKERS.md`, `ACTIVE_HANDOFF.md`
   and completion state. It creates no stage machine, source-audit schema,
   custody/trust record, alternate ledger or commit policy.
4. [ ] `ACTIVE_HANDOFF.md` remains the handoff record and is edited directly;
   the status command may read it but cannot write it, commit, switch branches
   or orchestrate sessions.
5. [ ] Focused fixtures cover a valid state, contradictory package/handoff,
   wrong version, non-repository invocation, dirty state and redaction/no-
   unexpected-write behaviour.
6. [ ] Concise documentation shows start, reconciliation, handoff and closeout
   usage; a clean invocation provides enough information for the fresh-session
   rehearsal in W04.
7. [ ] The package adds exactly one status script and one focused test file—no
   handoff writer, daemon, database, framework, provider/network call,
   production dependency or P1 verifier.

### Concise verification commands

```powershell
node scripts/v2/status.js --check
npm.cmd test -- test/v2-status.test.js
npm.cmd run lint
git diff --check
```

The Work Package may choose a clearer focused test filename before editing, but
the deliverable remains one status script and one focused test file.

**Browser/E2E:** N/A.

**Evidence and checkpoint:** Focused test output, one sample redacted status
output, a short needs/omissions note, and
`docs/v2/evidence/packages/P0-W03/COMPLETION.md`; one completion commit.

**Rollback:** Revert the W03 commit; the human-readable state files remain
usable without the helper.

**Additional stop conditions:** The tool needs persistent state, a dependency,
Git mutation, a provider/network call, broad schema generation or more than a
session-sized implementation.

## 12. P0-W04 — Harden tests and rehearse fresh-session continuity

**Objective:** Close demonstrated ordinary-test environment escapes, prove
fresh-session reconstruction, perform one real sequential Codex/Claude handoff
when Claude is provisioned, and install a hook only if current evidence supports
a useful low-risk repository-scoped guard.

**Business reason:** Tests and handoffs must not touch owner state or depend on
conversation memory, but enforcement must remain smaller than the product work
it supports.

**Dependency:** Completed W03. Claude provisioning is not a prerequisite for
W01-W03 and no unrelated Phase 0 work waits for it.

**Likely affected:** `scripts/run-tests.js`, focused test fixtures/tests,
continuity records, and repository-only Codex/Claude configuration if a hook is
justified. No global/user configuration.

### Acceptance criteria

1. [ ] A name-only/synthetic-sentinel audit characterizes the demonstrated
   privacy-key/proof-path escapes and materially adjacent repository-recognized
   credential, live/control, Node/tool and write-path inputs. No owner value is
   read or printed, and the audit does not become a general environment schema.
2. [ ] The existing wrapper uses an explicit minimal child-environment allowlist
   or equivalently evidenced safe construction; all database, artifact,
   approval, backup, proof-ledger and temp paths—including current and legacy
   aliases—point into a disposable root. Required OS/Node/npm/renderer inputs
   are retained deliberately. Repository `tmp/pdfs` is the sole explicit
   snapshot/restore exception and must be unchanged after success or failure.
3. [ ] Focused regressions prove synthetic secrets/control variables and unsafe
   Node/path overrides do not cross into ordinary children, all environment-
   configurable writes remain disposable, and local ordinary runs cannot enter
   live or lifecycle modes.
   Existing sharding, deadlines, targeted-path grammar, PDF restoration,
   cleanup and hosted lifecycle behaviour remain intact.
4. [ ] Targeted isolation tests, lint and one full ordinary suite pass without
   owner-data access, external provider/network action, production/UI change or
   local lifecycle execution. Required loopback/local-child test traffic remains
   permitted and isolated.
5. [ ] A genuinely fresh Codex session reconstructs the exact root, branch,
   current package, Git state, completed/remaining criteria, blockers and next
   action from repository state alone, then records a concise result in the
   normal W04 completion/handoff record.
6. [ ] Claude compatibility is prepared regardless of availability. If Claude
   Code is provisioned during P0, a fresh Claude session performs the same
   reconstruction and one real sequential same-worktree handoff before cross-
   model continuity is labelled `verified`. If unavailable, record
   `prepared_not_verified`; do not block W01-W03 and do not claim rehearsal or
   verified cross-model continuity.
7. [ ] Current official Codex and Claude repository-hook support is reviewed
   with source and review date. The default is a documented no-hook result;
   install at most a simple, low-risk repository guard only if evidence shows it
   prevents a demonstrated error. No-hook or asymmetric support passes without
   amendment.
8. [ ] No browser/T3/Playwright, global/user config, tool installation,
   credential grant, provider call, spend or production change occurs.

### Concise verification commands

```powershell
npm.cmd test -- test/test-environment-isolation.test.js
npm.cmd run lint
npm.cmd test
node scripts/v2/status.js --check
git diff --check
```

The package may choose a clearer focused test filename before editing. It must
not run `npm.cmd run test:lifecycle:ci` locally. Current official hook syntax is
verified at execution time rather than frozen into this planning document.

**Browser/E2E:** N/A.

**Evidence and checkpoint:** Synthetic-sentinel results, targeted/full ordinary
test results, fresh Codex result, Claude handoff result or honest
`prepared_not_verified` status, hook investigation/decision, and
`docs/v2/evidence/packages/P0-W04/COMPLETION.md`; normal Git commits only.

**Rollback:** Revert the W04 code/config commit. The previous test wrapper is the
code rollback point, but rollback must not be described as restoring adequate
isolation; record the reopened risk. Disable/remove any repository hook through
its documented local rollback without touching global/user config.

**Additional stop conditions:** A renderer/tool requires owner credentials,
the allowlist would break hosted lifecycle semantics beyond bounded repair, a
hook requires global install/credentials/unsupported syntax, or concurrent
Codex/Claude editing is detected.

## 13. P0-W05 — Independent Phase 0 gate and owner-approved integration

**Objective:** Independently verify the Phase 0 result, obtain an explicit owner
decision, and fast-forward the verified local Phase 0 work into `main` so
`C:\Pantheon` is the official current verified checkout.

**Business reason:** The engineering baseline should become canonical through a
normal, understandable Git lifecycle rather than leaving `main` behind or
creating a permanent continuation scheme.

**Dependencies:** W01-W04 have completion records and a clean candidate tip.

**Session boundary:** A fresh independent reviewer performs the gate and makes
no fixes. The review ends with
`PHASE GATE REVIEW COMPLETE: OWNER DECISION REQUIRED`. Only after an explicit
owner approval may a short fresh W05 integration session fast-forward local
`main` and write the closeout records.

**Likely affected:** Gate/owner-decision/completion records, `PROGRESS.json`,
`BLOCKERS.md`, `ACTIVE_HANDOFF.md`, and local Git refs/checkout. No product code
or P1 plan.

### Acceptance criteria

1. [ ] A fresh independent reviewer reconstructs P0 and identifies the W01
   baseline `B` and candidate implementation tip `S`. It reviews `B..S`, normal
   Git history, W01-W04 completion records, blockers/handoff, worktrees and clean
   candidate status without relying on chat or fixing findings.
2. [ ] Diff checks, instruction/skill parity, the W03 status check, focused W03/
   W04 tests, lint and the full ordinary suite pass in the hardened environment.
   Browser/T3/Playwright is explicitly N/A and lifecycle remains CI-only.
3. [ ] The complete diff contains only permitted P0 docs/instructions, developer
   tooling, tests/fixtures, `.env.example`, narrow ignore/config and normal
   evidence changes. The former-root active scan is repeated. No secret, owner
   data, production/UI/business behaviour or runtime/database schema, provider/
   commercial action, spend,
   unrelated repair or P1 work is present.
4. [ ] The reviewer verifies the fresh-Codex result and reports Claude continuity
   exactly as evidenced. `verified` requires W04's real rehearsal;
   `prepared_not_verified` is acceptable only as an honest non-claim and does
   not become a simulated receipt.
5. [ ] The reviewer writes
   `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md` with `B`, `S`, commands,
   results, findings and binary `PASS`/`FAIL`, then makes one gate-report/review-
   state-only commit `R` whose parent is `S` and stops. It contains no hash
   manifest or self-attestation.
6. [ ] A `PASS` has no gate-blocking technical/safety finding. A `FAIL` routes
   correction to the responsible package or an amendment; the reviewer does
   not repair it. Missing optional hooks alone can never fail the gate.
7. [ ] Only after `PASS`, the owner explicitly approves both tested tip `S` and
   report commit `R` and authorizes a docs-only closeout. A fresh integration
   session proves the external P0 lane is clean at `R`, the WIP preservation ref
   exists, and the primary `C:\Pantheon` worktree is clean with local `main`
   exactly `B` and no candidate-path collision. It then proves `B` is an
   ancestor of `R` and fast-forwards `main` to exact `R`. Dirty/diverged state,
   WIP loss risk, silence or failure stops; no push, rebase, reset, force or
   branch deletion occurs.
8. [ ] On `main`, the integration session records the owner decision in P0-W05
   completion, updates progress/blocker/handoff closeout, then makes one docs-only
   commit `C`. The completion record may list `B`, `S` and `R`; it does not try
   to contain its own `C` SHA—normal Git HEAD supplies it. `R..C` passes diff/
   path/status checks, `C:\Pantheon` is clean on local `main`, P0 has no active
   package/agent/handoff, and the next action is fresh P1 planning. The session
   ends `PACKAGE COMPLETE: START A NEW SESSION FOR P1-PLAN`.

### Concise gate commands

```powershell
git status --short --branch
git worktree list --porcelain
git rev-parse HEAD
git rev-parse main
git log --oneline --decorate <B>..<S>
git diff --check <B>..<S>
git diff --name-status <B>..<S>
rg -l -F 'Jarvis-Codex-AI-Business' --hidden -g '!.git/**' -g '!archive/**' .
node scripts/v2/status.js --check
npm.cmd test -- test/v2-status.test.js test/test-environment-isolation.test.js
npm.cmd run lint
npm.cmd test
```

Use the actual `B` from W01 and record candidate `S` before writing gate
evidence. If W03/W04 chose different approved focused test names, use those
names. After the checks, commit only the gate report/review-waiting state as
`R`; verify `S..R` contains only those paths. No inline PowerShell harness or
browser artifact set is required.

After owner approval of `S` and `R`, the fresh integration session uses concise
normal Git from the canonical primary worktree:

```powershell
Set-Location -LiteralPath C:\Pantheon
git rev-parse --show-toplevel
git worktree list --porcelain
git show-ref --verify <WIP-preservation-ref>
git status --porcelain=v1 --untracked-files=all
git rev-parse main
git merge-base --is-ancestor <B> <R>
git switch main
git merge --ff-only <R>
git rev-parse HEAD
```

Before switching, status must be empty and `main` must equal `B`; immediately
after the fast-forward, HEAD must equal `R`. After committing the tightly scoped
closeout as `C`, run:

```powershell
git diff --check <R>..HEAD
git diff --name-only <R>..HEAD
node scripts/v2/status.js --check
git status --short --branch
```

Review the changed-path list against criterion 8. Do not repeat the full suite
mechanically when `S..C` contains only the reviewed gate/closeout documents.

**Browser/E2E:** N/A.

**Evidence and checkpoint:** One concise gate report commit `R` and one concise
docs-only closeout commit `C` containing
`docs/v2/evidence/packages/P0-W05/COMPLETION.md` with the owner decision plus
progress/blocker/handoff closeout. Normal Git identifies all SHAs; there is no
gate manifest or separate approval receipt.

**Rollback:** Before integration, leave `main` unchanged and route fixes back to
the owning package. After integration, preserve history and use a reviewed
normal revert commit if rollback is required; never reset or rewrite `main`.
The WIP preservation branch remains available.

**Additional stop conditions:** The reviewer is not independent, candidate or
`main` is dirty/diverged, the expected baseline/tip cannot be proved with Git,
owner approval is absent/ambiguous, or integration would lose preserved WIP.

## 14. Acceptance matrix

| Phase requirement | Package | Verification | Evidence |
|---|---|---|---|
| Existing WIP is safe and baseline is truthful | W01 | Git state/diff/worktree checks; isolated lint/full ordinary test | W01 completion and normal SHAs |
| Former-root operational example is removed | W01 | Active-path `rg` review and `.env.example` diff | W01 completion |
| Authority/version/session/skills agree | W02 | Static review, JSON parse, ignore/tracking/parity checks | ADR if required; W02 completion |
| Fresh sessions see concise truthful state | W03-W04 | Status fixtures and real fresh Codex reconstruction | W03/W04 completion/handoff |
| Ordinary tests cannot inherit owner state | W04 | Synthetic sentinel tests and full ordinary regression | W04 completion |
| Cross-model continuity is honest | W04-W05 | Real Claude rehearsal when available, otherwise explicit `prepared_not_verified` | W04 completion and gate report |
| Verified work becomes canonical local main | W05 | Independent diff/test gate, owner decision and fast-forward/status checks | Gate, owner decision and W05 completion |

## 15. Risk register

| Risk | Impact | Mitigation | Owner/agent |
|---|---|---|---|
| Dirty commercial/governing work is lost or mixed into P0 | Critical | Preserve-by-default named WIP branch/checkpoint; exact owner disposition; no destructive Git | Owner decides; W01 executes |
| Active authority remains contradictory | High | Owner-approved Pack specializations, one concise ADR and supporting protocol/prompt alignment | Owner approves; W02 records |
| Former-root example creates shadow state | High | Correct `.env.example`; secret-safe active scan; record external limitations | W01 |
| Tests inherit credentials or owner paths | Critical | Temporary W01 sanitization; permanent W04 allowlist/redirection and sentinels | W04 |
| Continuity tools become another subsystem | High | Exactly one read-only status script and one focused test; no persistent state | W03 |
| Claude Code is unavailable | Medium | Complete unrelated work; prepare compatibility; label `prepared_not_verified`; rehearse before any verified claim | Owner provisions when practical; W04 |
| Hook support is absent/asymmetric | Low | Document current evidence and omit the hook; no fake symmetry or blocker | W04 |
| Candidate branch or main diverges before integration | High | Binary gate; expected SHA; clean status; fast-forward only; stop for owner decision | W05 |
| Secret/live/provider/commercial action is triggered | Critical | Name-only/synthetic audits; no credentials/calls/spend; common stop conditions | Every package |

## 16. Phase-wide rollback and failure handling

1. Stop the single writer and preserve current Git status/diff/handoff.
2. Before W05 integration, keep local `main` unchanged and revert coherent P0
   commits in reverse order only after reviewing their scope. Abandoning the P0
   branch is acceptable only after confirming the WIP preservation ref remains.
3. After integration, use normal reviewed revert commits. Do not reset, force,
   rewrite history or delete branches/worktrees automatically.
4. Never roll back by restoring former-root assignments, legacy authority,
   archived hooks, unsafe test inheritance or owner data.
5. Classify failures A-F. Record unrelated failures without expanding P0; send
   plan deficiencies to an owner-reviewed amendment.

P0 includes no runtime/database migration, provider integration or UI change,
so no production data rollback or browser recovery procedure is required.

## 17. Independent phase gate and exit

W05's reviewer answers the Master Plan phase-gate questions in proportion to
P0. UI-real-state and new-external-action questions are N/A because the allowed
diff contains no UI/runtime/provider action; any such change instead fails
scope.

The gate is binary:

- **PASS:** all technical and safety exit criteria are met, the diff is in
  scope, full ordinary tests pass, rollback remains available, and continuity
  claims match evidence.
- **FAIL:** any unsafe/failed test condition, operational former-root dependency,
  secret/owner-state exposure, production/UI/runtime-schema/business delta,
  unresolved WIP custody, misleading continuity claim, or dirty/diverged
  integration state remains.

Claude unavailability is not converted into fake evidence. If W02 validly
reconciles the contract and W04 records `prepared_not_verified`, the gate may
pass without claiming cross-model continuity verified. Once Claude is
provisioned, a real rehearsal is required before that label changes.

The phase exits only after the owner approves a passing reviewed tip and W05
completes local integration:

- [ ] W01-W05 completion records and normal Git SHAs exist;
- [ ] `PROGRESS.json`, `BLOCKERS.md` and `ACTIVE_HANDOFF.md` are truthful;
- [ ] the test environment is hardened and the ordinary regression is green;
- [ ] no business behaviour, UI, provider, commercial truth or owner data changed;
- [ ] the known former-root operational example is resolved;
- [ ] optional hook and Claude status are reported honestly;
- [ ] `C:\Pantheon` is clean on local `main` at the verified Phase 0 tip; and
- [ ] the next action is a fresh planning-only session for the P1 Execution Pack.

## 18. Session outcomes

Package implementation/handoff sessions end with exactly one current root
instruction:

- `PACKAGE COMPLETE: START A NEW SESSION FOR [NEXT-ID]`
- `PACKAGE IN PROGRESS: CONTINUE THIS SESSION`
- `HANDOFF READY: OPEN THE SAME WORKTREE IN [CODEX/CLAUDE]`
- `BLOCKED: OWNER ACTION REQUIRED`

Other read-only session types use distinct, non-implementation endings:

- phase planning: `PHASE PLAN READY: OWNER REVIEW REQUIRED`;
- plan amendment: `PLAN AMENDMENT READY: OWNER REVIEW REQUIRED`;
- standalone package reconciliation:
  `PACKAGE RECONCILIATION COMPLETE: IMPLEMENTATION AUTHORITY REQUIRED`; and
- independent phase gate:
  `PHASE GATE REVIEW COMPLETE: OWNER DECISION REQUIRED`.

W02 aligns the active prompts and protocols to these semantics. This planning
session uses the phase-planning ending.

## 19. Owner action before W01

Only two owner decisions are genuinely required before W01:

1. approve this revised Phase 0 Execution Pack and its embedded package
   specifications; and
2. authorize the disposition of the current dirty WIP.

The safest disposition is preservation of every reviewed repository work-
product path on a named WIP branch and coherent checkpoint, labelled unverified,
with semantic completion/integration deferred. Ignored credentials, owner data,
generated dependencies and runtime/recovery state remain outside Git. The owner
may approve that default together with this pack. Any discard must be explicitly
file/path scoped. Claude provisioning, hook selection, remote Git and Phase 0
integration approval are not W01 prerequisites. Both required pre-W01 decisions
are recorded in section 20.

## 20. Owner approval and amendments

### Owner approval recorded 2026-08-15

The owner approved this Phase P0 Execution Pack version `0.2-draft`,
decisions P0-D01 through P0-D06, the explicit P0 specializations in section 3,
and the five embedded Work Package specifications P0-W01 through P0-W05.

The approved existing-WIP disposition is preservation by default:

- preserve every reviewed legitimate repository work-product path on a named
  WIP branch and coherent checkpoint;
- label that checkpoint unverified;
- do not discard any existing legitimate source, documentation, configuration,
  test, skill or intended work product;
- do not add credentials, secrets, owner/private data, generated dependencies,
  databases, artifacts or runtime/recovery state to Git; and
- do not semantically finish or release that existing WIP as part of Phase 0.

This approval makes P0-W01 `ready`. It does not start P0-W01, create or switch a
branch/worktree, preserve the WIP checkpoint, run package verification, or
authorize any semantic completion/release of the existing WIP in this planning
session. Later local-main integration still requires the separate W05 owner
approval defined by this pack.

This is a normal repository approval record, not a receipt or hash-binding
system. A future material change requires a documented reason, impact, relevant
ADR/Master update where needed, owner approval and a normal Git commit.

### P0-W04A corrective amendment approved 2026-08-16

After the first independent P0-W05 review recorded binary `FAIL` in commit
`75914d954cbf78b7bf4695eed2f135ea1bb627ac`, the owner approved one bounded
corrective package, `P0-W04A — Renderer Environment and Gate Corrections`. Its
exact authority and acceptance contract are
`docs/v2/work-packages/P0-W04A.md`.

This amendment inserts P0-W04A after completed P0-W04 and before any P0-W05
rerun. P0-W05 now depends on completed P0-W04A as well as W01-W04. It does not
invalidate, rewrite or erase the first failed gate report. After P0-W04A passes,
the completely fresh independent rerun must use the new candidate tip and write
`docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW-02.md`; the original
`PHASE-GATE-REVIEW.md` remains immutable historical evidence.

The original five embedded specifications remain the approved historical pack
text. This later owner-approved specialization governs the correction and rerun
where they conflict. It does not itself authorize P0-W05 integration and adds
no provider/commercial, remote Git, product/business-behavior or P1 authority.

The ignored renderer environment is checkout-local and does not transfer by
fast-forward. If the rerun passes and the owner separately authorizes W05
integration, the integration session may, after fast-forwarding `C:\Pantheon`
to the approved report commit, run the committed bootstrap there for the same
W04A-validated exact pins and resolver-required transitives, then require the
committed renderer validation to pass before closeout. This is local
reprovisioning only: no global/user Python or configuration, unrelated package,
product behavior, provider/commercial action or full-suite substitution is
authorized.

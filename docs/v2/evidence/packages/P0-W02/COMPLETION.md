# P0-W02 Completion Report

**Package:** P0-W02 — Reconcile programme authority and the cross-agent contract
**Status:** complete
**Completed by:** Codex
**Completed:** 2026-08-15T21:26:49+10:00 (Australia/Brisbane)
**Branch/worktree:** `codex/p0-engineering-os` /
`C:\Pantheon-worktrees\P0-engineering-os`
**Completion predecessor:** `c6fe4380f9480d885446599bcbb4f0ccffa028a2`
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`
**Preserved unverified WIP:**
`612a35c8b1d881f638570373d06f99d26bfb280e`

The coherent P0-W02 completion commit is the commit containing this report. Its
own SHA is intentionally not self-recorded; normal Git history supplies it as
required by the approved Pack.

## Governing authority

- Owner-approved Phase 0 Execution Pack, version identifier `0.2-draft`,
  especially sections 3, 6, 8, 10, 18 and 20. The `draft` suffix is part of the
  approved identifier; the Pack's recorded status is Approved.
- Approved verbatim execution copy:
  `docs/v2/work-packages/P0-W02.md`.
- Approved decision record created by this package:
  `docs/v2/decisions/ADR-0001-P0-EXECUTION-CONTRACT.md`.

## Objective and business result

Fresh Codex and Claude sessions now receive one cloneable v2.1.1 engineering
contract: an owner-approved Pack may explicitly specialize stable-Master
execution for its phase, and its approved Work Package is the most-specific
implementation contract without power to silently amend the Pack, relevant
ADRs or non-specialized Master constraints.

The owner-approved P0 specializations, session endings, binary P0 gate,
programme version/schema and shared skills now agree. Historical installer and
legacy instruction artifacts are unmistakably non-authoritative. This is an
engineering-support result only: no buyer evidence, revenue, product behaviour,
provider qualification, commercial action or P0 completion is claimed.

## Acceptance criteria

1. [x] Root instructions, protocols, prompts and the mirrored work-package skill
   use the Pack-specialization/most-specific-Package authority semantics and
   require an owner-reviewed amendment for material conflict.
2. [x] ADR-0001 records the approved single-writer/normal-Git P0 operating
   decisions plus optional hooks, no P0 browser/T3/Playwright, just-in-time
   post-P0 P1 planning and honest Claude deferral. The stable v2.1.1 Master was
   not edited or re-versioned.
3. [x] Root `AGENTS.md` remains concise v2.1.1 authority and retains compatible
   safeguards for secrets, destructive Git, owner data/recovery, isolated
   verification, access controls, providers, commercial truth and protected
   actions. `AGENTS.legacy-pre-v2.md` remains tracked, unchanged and explicitly
   historical; its legacy authority/assurance method was not imported.
4. [x] Root `CLAUDE.md` still imports `AGENTS.md` and contains only concise
   Claude-specific continuity/review rules. Archived Claude settings, agents,
   hooks and memory remain retired and unchanged.
5. [x] Active programme contracts use 2.1.1, including the progress ledger,
   schema, manifest and templates. Independent npm runtime version `1.0.0`,
   package files, dependency tree and renderer requirements remain unchanged.
6. [x] The four package outcomes apply to package implementation, continuation,
   review, handoff and blocker sessions. Planning, amendment, standalone
   reconciliation and phase-gate sessions retain distinct exact endings. The P0
   gate prompt is binary `PASS` / `FAIL` and defers other phases to their Packs.
7. [x] The seven `.agents/skills/` and `.claude/skills/` pairs are tracked,
   cloneable and materially identical. Other immediate `.agents/*` state stays
   ignored. The intentional Codex-only commercial-steward skill is explicitly
   subordinate to common safeguards and no longer carries stale legacy-
   authority or blanket full-verification clauses.
8. [x] Progress, blockers and the closed handoff identify the approved
   `0.2-draft` Pack, completed W02, ready-but-not-started W03, real P0-B01 and
   renderer limitations without claiming P0 completion, hooks, green ordinary
   regression or verified Claude continuity.

## Files changed

- Root/current contract: `.gitignore`, `AGENTS.md`, `CLAUDE.md`.
- Shared/agent-specific skills:
  `.agents/skills/pantheon-work-package-executor/SKILL.md`,
  `.claude/skills/pantheon-work-package-executor/SKILL.md`, and
  `.codex/skills/pantheon-commercial-steward/SKILL.md`.
- Active protocols/state: `docs/v2/ENGINEERING_PROTOCOL.md`,
  `docs/v2/SESSION_PROTOCOL.md`, `docs/v2/PROGRESS.json`,
  `docs/v2/BLOCKERS.md`, `docs/v2/ACTIVE_HANDOFF.md`,
  `docs/v2/phase-manifest.yaml`, and `docs/v2/progress.schema.json`.
- Decision: `docs/v2/decisions/ADR-0001-P0-EXECUTION-CONTRACT.md`.
- Prompts: `docs/v2/prompts/01_CODEX_WORK_PACKAGE_START.md` through
  `05_PLAN_AMENDMENT.md` except the already-correct planning prompt `00`.
- Templates: `docs/v2/templates/PHASE_EXECUTION_PACK_TEMPLATE.md` and
  `docs/v2/templates/WORK_PACKAGE_TEMPLATE.md`.
- Historical installer markers:
  `docs/v2/install/AGENTS.v2.1.1.proposed.md` and
  `docs/v2/install/INSTALL_REPORT.md`.
- Completion evidence: this report.

No path under `src/`, `public/`, `test/`, `scripts/`, `config/`, runtime data,
package/dependency files, renderer requirements, provider adapters, UI,
commercial functionality, the stable Master, the approved Pack or approved
Work Package specifications changed.

## Verification and evidence

| Check | Result | Evidence |
|---|---|---|
| `git diff --check` | PASS | exit 0; no whitespace finding |
| required programme-version scan | PASS after review | ten intentional residual matches classified below |
| required shared-skill ignore check | PASS | negative result, exit 1; skill is not ignored |
| `git ls-files .agents/skills .claude/skills` | PASS | 14 tracked files, seven mirrored pairs |
| required shared-skill directory diff | PASS | exit 0; materially identical |
| required ledger/schema Node assertion | PASS | exit 0; both values are `2.1.1` |
| final JSON parse/state assertions | PASS | W02 complete, W03 ready, no active package/agent/worktree |
| changed-path boundary review | PASS | governance/developer-support/evidence paths only |
| stable Master diff | PASS | no working-tree or staged delta |
| browser/E2E/application/lifecycle | N/A | prohibited/not run for P0-W02 |
| full ordinary/isolation suite | not run by design | reserved for P0-W04; no green claim |

The required `rg --pcre2 -n '2\.1(?!\.1)'` scan returns ten intentional
matches:

- three immutable approved-specification matches: the W02 instruction literal
  and two Phase Pack audit/verification literals;
- three stable-Master matches: two decimal-style section headings plus the
  retained earlier reference-baseline sentence, which P0-W02 is forbidden to
  edit; and
- four historical W01-evidence matches: two records of the former two-component
  schema-version limitation and two dotted renderer/tool-version false
  positives.

All active schema/template version defects are corrected. The scan does not
authorize changing approved specifications, historical evidence or the stable
Master to manufacture an empty result.

## Interactive browser / E2E

- Running application: not run; N/A and prohibited for P0-W02.
- Browser, console, network, screenshot, T3 and Playwright evidence: not run.
- Provider, lifecycle, live/runtime and owner-data operations: none.

## Decisions

- Recorded all owner-approved P0-D01 through P0-D06 operating decisions and the
  Claude deferral in one concise ADR rather than editing the stable Master.
- Kept Pack identifier/status truth in the Pack and concise repository records;
  did not duplicate it by expanding the progress schema.
- Removed the blanket `.agents/` ignore only for the repository-owned
  `.agents/skills/` subtree; other immediate agent-local state remains ignored.
- Preserved the seven shared pairs and changed only the executor pair needed for
  authority/session alignment.
- Marked the installer proposal/report historical rather than treating a stale
  proposed copy as current authority.
- Did not create a hook, continuity script, verifier, instruction hash manifest,
  receipt, PDR or alternate state system.

## Known limitations and blockers

- `P0-B01` remains an active B-class ordinary-test-isolation limitation owned
  by P0-W04. W01 evidence remains 702/703 across four entered shards; shard five
  was not run. It did not block W02 and no wrapper/test/production workaround
  was attempted.
- The ambient bundled renderer retains Pillow 12.3.0 while the repository pins
  12.2.0. W01's disposable exact venv did not mutate the ambient tool; W02 made
  no renderer, requirement or package change.
- Claude continuity remains `prepared_not_verified` pending a real sequential
  W04 rehearsal. Hooks remain unimplemented pending W04's evidence review.
- Remote freshness remains unproved because no fetch was authorized.

No owner action is required before P0-W03.

## Rollback

Before integration, revert the coherent P0-W02 completion commit after review.
Do not restore legacy authority, archived Claude configuration, blanket skill
ignoring, stale version contracts or unsupported hook/Claude claims. Preserve
the W01 custody refs and P0-B01 record.

## Next ready package

P0-W03 is `ready` and not started. Its fresh session may implement only the
approved lightweight continuity tooling. It must preserve P0-B01 and the
renderer limitation for P0-W04 and must not begin P0-W04.

## Final Git status

- The only P0-W02 completion candidate changes are the files listed above.
- All changes are included in one coherent completion commit whose SHA is
  intentionally supplied by normal Git history rather than this report.
- The Phase 0 lane is clean and commit-addressable after that commit; `B` and
  the P0-W01 predecessor remain ancestors.
- Push/PR/remote mutation: none.

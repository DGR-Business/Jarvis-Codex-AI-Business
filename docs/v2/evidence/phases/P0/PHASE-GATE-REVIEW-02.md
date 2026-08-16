# P0-W05 — Independent Phase 0 gate review 02

**Review type:** fresh independent Phase 0 gate rerun, review only\
**Reviewed by:** Codex, with three independent read-only subreviews\
**Reviewed:** 2026-08-16T15:39:48+10:00 (Australia/Brisbane)\
**Repository root:** `C:/Pantheon-worktrees/P0-engineering-os`\
**Branch:** `codex/p0-engineering-os`\
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`\
**First candidate S1:** `9ab7748f1a3443535e1f066b1b3d48efc668aedb`\
**Original failed review R1:** `75914d954cbf78b7bf4695eed2f135ea1bb627ac`\
**P0-W04A amendment A:** `628382985a896a0130742a6732dfb2ec58fe5662`\
**P0-W04A implementation I:** `b15f0042f513b4539feb3e6cbb93b26e8a1f91fe`\
**Reviewed candidate S2:** `e37c958a232e139f6216caae66b5b7932b6a6e0b`\
**Binary result:** **FAIL**

The second gate fails on one high-severity P0-W04A renderer-contract finding.
The retained environment is healthy today, but the committed bootstrap and
validator do not reproduce or enforce the exact reviewed transitive-only
inventory required by this gate. A fresh resolution may select different
transitive versions, and validation accepts arbitrary additional installed
distributions. Green tests against the current installation do not close that
contract gap.

No finding was repaired. No implementation or state file was changed. No
browser, T3, Playwright, Windows-launcher, lifecycle-CI, provider, live-model,
commercial, owner-data, remote-Git, integration, local-main or P1 action was
performed.

## Binary conclusion

`B..S2` is linear, clean, reviewable, in the approved Phase 0/P0-W04A path
boundary, mechanically formatting-clean and fully green under the required
tests. Instruction parity, hosted-CI compatibility, test isolation, recovery,
production rendering, rollback custody and repository state all pass.

The gate nevertheless cannot confirm the explicit requirement that another
checkout obtain the same exact renderer environment containing only the
documented resolver-required transitives. `P0-B04` therefore cannot be treated
as fully closed under this review contract, and P0-W05 integration is not
authorized.

## Acceptance review

| Required review | Result | Evidence |
|---|---|---|
| Complete `B..S2` scope is owner-approved P0/P0-W04A work | **PASS** | 90 paths: governance, v2 documents, environment/CI tooling, narrow renderer integration and focused tests only. |
| 35 first-gate formatting findings are corrected without semantic change | **PASS** | Exactly 30 two-space hard breaks became explicit CommonMark backslashes and five surplus EOF LFs were removed; all target comparisons are exact. |
| Original failed report is preserved; new path is `PHASE-GATE-REVIEW-02.md` | **PASS** | Original blob remains `6928a40ea2c1f0af493e728e6a71084d13291089`, unchanged from R1. |
| Renderer is deterministic, checkout-local, ignored, independently bootstrap-able and validates only the reviewed package inventory | **FAIL** | Current installation passes, but fresh resolution leaves two transitives unconstrained and validation/reuse accepts extras and transitive drift. See `P0-GATE-02-F01`. |
| Ordinary tests, Doctor and renderers use the repository-supported interpreter | **PASS** | Shared resolver/validator, canonical interpreter boundary, isolated Python subprocesses and focused/full tests pass. |
| Hosted CI and documented checkout lifecycle remain intact | **PASS** | Exact GitHub-hosted setup-python exception is narrow and tested; local lifecycle remains quarantined and was not run. |
| P0-B01, P0-B03 and P0-B04 closures are exactly evidence-supported; historical P0-B02 is unchanged | **FAIL** | B01 is revalidated and B03 is closed; historical B02 is unchanged. B04 is only partially supported because exact inventory reproduction/validation is incomplete. |
| Instruction and Codex/Claude shared-skill parity | **PASS** | Seven tracked pairs compare exactly; `CLAUDE.md` imports `AGENTS.md`; Codex-only commercial steward is explicitly subordinate. |
| Status, progress, blocker and handoff state identify P0-W05 as ready | **PASS as pre-review consistency** | Status check passes and the three state records agree. This new independent finding supersedes readiness for integration. |
| No secret, owner data, provider/commercial action, UI, schema/database, unrelated upgrade or P1 work entered `B..S2` | **PASS** | Path, added-line, lockfile, category and former-root scans pass; one credentialed URI is an explicit synthetic redaction fixture. |
| Rollback remains available through normal Git history | **PASS** | No merges or rewrites; local `main` remains B; preserved WIP and original review remain intact. |
| Claude continuity is reported only as evidenced | **PASS** | `prepared_not_verified`; no actual sequential Claude rehearsal exists. |

## P0-GATE-02-F01 — Exact renderer inventory is not reproducible or enforced

**Classification:** high severity, gate-blocking P0-W04A contract and
implementation finding

### Required contract

The review objective requires a deterministic, independently bootstrap-able
renderer that exactly validates the four direct pins and only the documented
resolver-required transitive packages. P0-W04A also says:

- another checkout obtains the same exact environment through the deterministic
  bootstrap;
- bootstrap installs only the four exact roots plus resolver-required
  transitives;
- final verification begins from a fresh bootstrap; and
- integration provisions the same selected pins and transitives already
  reviewed.

The P0-W04A completion inventory records:

| Distribution | Version | Recorded basis |
|---|---:|---|
| openpyxl | 3.1.5 | exact direct pin |
| Pillow | 12.3.0 | exact direct pin |
| pypdfium2 | 5.13.0 | exact direct pin |
| reportlab | 5.0.0 | exact direct pin |
| charset-normalizer | 3.5.1 | resolver-required transitive |
| et_xmlfile | 2.0.0 | resolver-required transitive |
| pip | 25.0.1 | virtual-environment bootstrap tooling |

### Observed implementation defect

1. `requirements-runtime.txt` pins only the four direct roots.
2. Installed package metadata says `openpyxl==3.1.5` requires unversioned
   `et-xmlfile`, and `reportlab==5.0.0` requires unversioned
   `charset-normalizer` plus `pillow>=9.0.0`.
3. `src/runtime/renderer-environment.js:491-507` performs an ordinary pip
   resolution from those root requirements. No tracked constraint fixes the two
   recorded transitive versions.
4. The validator inventories all installed distributions at lines 286-287, but
   lines 324-343 validate only the four direct root names and versions.
5. `pip check` proves dependency compatibility, not absence of unrelated
   distributions or equality with the reviewed transitive inventory.
6. Bootstrap reuse at lines 459-463 accepts that incomplete readiness result.
7. `test/renderer-environment.test.js:238-244` asserts direct equality and only
   that inventory includes pip. It does not reject extra distributions or
   mismatched transitive versions.

### Independent read-only proof

A synthetic spawn was injected only into `validateRendererEnvironment`; it made
no repository or environment change. The probe supplied exact direct roots, a
successful synthetic `pip check`, two changed transitive versions and one
unrelated distribution. Validation returned:

```json
{
  "ready": true,
  "acceptedExtra": true,
  "acceptedTransitiveVersions": [
    { "name": "charset-normalizer", "version": "999.0-test" },
    { "name": "et_xmlfile", "version": "999.0-test" }
  ]
}
```

The important behavior is independently visible in the implementation: entries
outside the four-name `directInventory` map are ignored. A real unrelated
package whose own dependencies are consistent likewise does not make `pip
check` fail.

### Impact

Today's retained environment is clean, exact and green, but it proves only one
installation. A later public-index resolution may select different transitive
versions, and a locally polluted environment can still be labelled ready and
reused. The gate therefore cannot support the promised same-exact-environment
claim or authorize reprovisioning during integration.

### Required route

Return this finding to P0-W04A through a narrow owner-approved corrective
package or amendment. It must either:

1. define, constrain and enforce the normalized reviewed inventory, including
   explicit treatment of bootstrap tooling; reject extra and transitive-
   mismatched distributions; make reuse fail on drift; and add fresh-bootstrap,
   changed-transitive and unexpected-extra tests; or
2. obtain an explicit owner amendment narrowing the gate and P0-W04A promises
   to a direct-pin-only contract.

No correction is made by this reviewer.

## Identity, custody and history

All preflight stop conditions passed before substantive review.

| Command/check | Result |
|---|---|
| `git rev-parse --show-toplevel` | exact `C:/Pantheon-worktrees/P0-engineering-os` |
| `git branch --show-current` | exact `codex/p0-engineering-os` |
| `git status --porcelain=v1 --untracked-files=all` | empty at start, after tests/bootstrap and before this report |
| `git rev-parse HEAD` | exact S2 |
| `git rev-parse HEAD^` / `git rev-parse HEAD^^` | exact I / A |
| R1 ancestry and `R1^` | R1 is an ancestor of A; parent is exact S1 |
| `git rev-parse main` | exact B |
| `git merge-base --is-ancestor B S2` | exit 0 |
| `git worktree list --porcelain` | only the clean primary WIP worktree and clean P0 candidate worktree |
| preserved WIP branch/ref | exact `612a35c8b1d881f638570373d06f99d26bfb280e`; direct parent B; primary worktree clean |
| original report blob at R1/S2/working tree | exact `6928a40ea2c1f0af493e728e6a71084d13291089` |
| `git diff --quiet R1 S2 -- docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md` | exit 0 |

`B..S2` contains 11 linear commits and no merge commit:

1. `c6fe438` — P0-W01 completion;
2. `3233aae` — P0-W02 completion;
3. `9c29d19` — P0-W03 completion;
4. `acd4664` — P0-W04 blocked checkpoint;
5. `e88ed00` — P0-W04 hardening checkpoint;
6. `1303ce5` — P0-W04 A01 amendment;
7. `9ab7748` — P0-W04 completion / S1;
8. `75914d9` — original failed gate / R1;
9. `6283829` — P0-W04A authorization / A;
10. `b15f004` — P0-W04A implementation / I; and
11. `e37c958` — P0-W04A completion/state / S2.

## Formatting correction proof

Committed blobs at A and I were compared without using the completion claim as
the result. Each target equals the A blob after only the stated transformation:

| Target | Exact two-space-to-backslash replacements |
|---|---:|
| Master Plan | 9 |
| Active handoff template | 4 |
| ADR template | 2 |
| Completion report template | 3 |
| Phase execution pack template | 3 |
| Provider decision record template | 3 |
| Work package template | 6 |
| **Total** | **30** |

Each P0-W01 through P0-W05 execution copy differs from A only by one removed
terminal LF and still has one final newline. Embedded specification bodies
remain byte-identical to the approved Pack at 103, 83, 64, 88 and 134 lines.
The independent W05 comparison is byte-identical. Both working-tree and
`B..S2` diff checks pass.

## Scope and forbidden-category review

`git diff --name-status B..S2` contains 90 paths, 71 additions and 19
modifications, with 12,518 insertions and 392 deletions. There are no deletions,
binary files, symlinks or mode changes.

| Category | Paths | Conclusion |
|---|---:|---|
| Instructions, shared skills and governance | 18 | approved Phase 0 authority/parity work |
| `docs/v2` plans, protocols, packages, state and evidence | 49 | approved Phase 0/P0-W04A records |
| Environment, CI and package surfaces | 5 | `.env.example`, workflow, ignore, exact requirements and two package scripts |
| Developer scripts | 4 | Doctor, renderer CLI, isolated test wrapper and read-only status helper |
| Narrow renderer integration source | 5 | canonical discovery/invocation and recovery-source handling only |
| Focused tests | 9 | status, isolation, Doctor, renderer, recovery and integration coverage |

No path under `public`, runtime database/schema/migrations/data, provider
adapters, commercial configuration or P1 changed. Python renderer algorithms
and `test/pantheon-production.test.js` did not change. The five `src` changes
are confined to renderer discovery/validation, isolated invocation and recovery
source inclusion/exclusion; no product, buyer, approval, accounting, UI or
schema semantics changed.

`package-lock.json` remains blob
`51278c519207aaf7f679e8abfe3881457b7578ee`. Package name, version,
dependencies, development dependencies, optional/peer dependencies and engines
are unchanged. `package.json` adds only `renderer:bootstrap` and
`renderer:check`. The authorized Python direct-pin changes are:

- Pillow 12.2.0 to 12.3.0;
- pypdfium2 5.12.1 to 5.13.0;
- ReportLab 4.4.9 to 5.0.0; and
- openpyxl remains 3.1.5.

The exact broad former-root scan returns 14 documentary/history/policy files and
20 occurrences. R1 itself accounts for the additional file/occurrence relative
to its original 13/19 snapshot. The focused `.env.example`, `.github`, `src`,
`scripts`, `config`, `public` and `test` scan returns no match, so operational
former-root dependencies are zero.

Added-line scans found no concrete owner-profile path, PEM/private key or real
provider token. The only credentialed URI/secret-assignment-shaped addition is
explicit synthetic redaction data in `test/v2-status.test.js`. No owner data,
secret, provider/commercial action, spend, browser artifact or P1 work entered
the candidate range.

## Renderer, CI, test-wrapper and recovery review

Positive evidence remains substantial:

- `/.venv-renderer/` exists at the canonical repository root, is untracked,
  narrowly ignored by `.gitignore:2`, and excluded from source backup.
- CPython is 3.13.3, `sys.prefix` is the isolated environment, user site is
  disabled, renderer imports pass and `pip check` passes.
- Both explicit Python aliases were absent for the complete ordinary suite.
- Ordinary tests, Doctor, approval-pack rendering and product rendering use the
  shared resolver/validator and isolated `-I` Python subprocesses.
- Missing, single, relative, conflicting, foreign and version-mismatched aliases
  fail closed; there is no managed/user/bare-command fallback.
- Hosted CI's external exception requires exact GitHub-hosted runner markers,
  exact workspace and exact setup-python entry. CI supplies both coherent
  aliases after installing the tracked requirements.
- The ordinary wrapper validates the renderer once, passes deliberate aliases
  into disposable children and bypasses Python only for the exact quarantined
  hosted lifecycle path.
- Recovery source requires the renderer bootstrap/resolver and exact package
  scripts; generated environment content is excluded.

The first standalone validation attempt inside the restricted reviewer sandbox
could not execute the local Python file and returned an access-denied platform
error. The same repository command under the permitted host execution boundary
passed. This was a reviewer-sandbox constraint, not a candidate failure.

Final standalone validation reported:

- source `repository-default`;
- CPython 3.13.3;
- requirements SHA-256
  `f7f726ac93a6ccf6a748bce73fa467b39b9e9cc0940153b291d44c3d85208b77`;
- openpyxl 3.1.5, Pillow 12.3.0, pypdfium2 5.13.0 and ReportLab 5.0.0;
- charset-normalizer 3.5.1, et_xmlfile 2.0.0 and pip 25.0.1 as the only other
  installed inventory; and
- `pipCheck: pass`.

The documented bootstrap reuse command was run with the verified absolute base
CPython 3.13 input. The owner-profile portion of that input is intentionally not
recorded here. It returned `ready: true`, `reused: true`, the same inventory and
no repository delta. No recreate, install or package-index request occurred.

## Instruction, skill, state and continuity review

| Check | Result |
|---|---|
| `git diff --no-index --exit-code -- .agents/skills .claude/skills` | exit 0; seven materially identical pairs |
| `git ls-files .agents/skills .claude/skills` | exactly 14 tracked files |
| shared-skill ignore check | expected exit 1/no output; repository-owned skills are not ignored |
| `CLAUDE.md` | begins with exact `@AGENTS.md`; additions remain concise and noncompeting |
| active Claude configuration | mirrored skills only; no settings, hooks or memory |
| Codex-only commercial steward | intentional and explicitly subordinate to package/Pack/ADR/Master authority |
| v2.1.1 ledger/schema/manifest assertion | exact `2.1.1` across all three active records |
| residual `2.1` scan | section numbers, approved audit history or package-version false positives only |
| `node scripts/v2/status.js --check` before and after tests | exit 0; W04A complete, W05 ready, dependency consistency PASS |

P0-B01's isolation closure is revalidated by focused and full ordinary tests.
P0-B03's exact formatting closure is independently proven. P0-B02 remains
historical and its governed text is unchanged from A through S2. The current
state records mark P0-B04 closed, but `P0-GATE-02-F01` means that closure is not
sufficient for this stronger exact-inventory gate and must be returned to
P0-W04A or amended by the owner.

Claude Code was not available and no actual sequential cross-model rehearsal is
recorded. Continuity status is therefore exactly `prepared_not_verified`.
Missing optional hooks remain nonblocking and are not simulated.

## Verification commands and exact results

### Static and repository checks

| Command/check | Result |
|---|---|
| `git rev-list --count B..S2` | 11 |
| `git rev-list --min-parents=2 B..S2` | no output; zero merges |
| `git diff --name-status B..S2` | 90 permitted paths |
| `git diff --shortstat B..S2` | 90 files, 12,518 insertions, 392 deletions |
| `git diff --check B..S2` | exit 0 |
| `git diff --check` before report | exit 0 |
| A-to-I committed-blob formatting proof | exact 30 hard-break plus five EOF transformations |
| W05 embedded-copy/Pack comparison | byte-identical; 134 body lines |
| package map comparison and lock blob check | only two scripts added; dependency maps unchanged; lock blob unchanged |
| `rg -l -F 'Jarvis-Codex-AI-Business' --hidden -g '!.git/**' -g '!archive/**' .` | 14 files, 20 occurrences; documentary/history/policy only |
| focused former-root scan | expected exit 1; zero operational matches |
| protected-category path scans | zero UI, schema/data, provider/commercial or P1 paths |
| concrete-owner-name and private-key added-line scans | expected exit 1; zero matches |
| credentialed-URI added-line scan | one explicit synthetic redaction fixture |
| `node scripts/v2/status.js --check` | exit 0 before and after tests; consistency PASS |
| ordinary-plan inventory | five shards, 89 unique ordinary files; Windows launcher absent |
| `npm.cmd run renderer:check` | exit 0; exact current inventory above |
| `npm.cmd run renderer:bootstrap -- --python <verified-absolute-cpython-3.13>` | exit 0; `reused: true`; no install/network/repository change |
| synthetic validator inventory probe | exit 0; unexpectedly returned `ready: true` with changed transitives and one unrelated distribution |

### Tests and lint

| Command | Result |
|---|---|
| `npm.cmd test -- test/v2-status.test.js` | **7/7 pass**; zero fail/skip/cancel |
| `npm.cmd test -- test/renderer-environment.test.js test/runtime-rendering-dependencies.test.js test/test-environment-isolation.test.js test/pantheon-backup-doctor.test.js test/digital-product-file-factory-hardening.test.js test/agent-runtime-renderer-refresh-hardening.test.js test/startup-readiness.test.js test/v2-status.test.js` | **57/57 pass**; zero fail/skip/cancel |
| `npm.cmd test -- test/pantheon-backup-recovery-set.test.js` | **19/19 pass**; zero fail/skip/cancel |
| `npm.cmd test -- test/pantheon-production.test.js` | **28/28 pass**; zero fail/skip/cancel |
| `npm.cmd run lint` | exit 0; zero warnings |
| name-only Python-alias preflight | zero aliases present |
| `npm.cmd test` | exit 0; **871/871 pass**, zero fail/skip/cancel |

The complete ordinary suite used 89 unique ordinary test files across five
sequential shards:

| Shard | Files | Tests | Result |
|---:|---:|---:|---|
| 1 | 1 | 19 | pass |
| 2 | 21 | 137 | pass |
| 3 | 22 | 244 | pass |
| 4 | 23 | 308 | pass |
| 5 | 22 | 163 | pass |
| **Total** | **89** | **871** | **pass** |

The quarantined `test/windows-launcher.test.js` was absent from the plan and was
not run. `npm.cmd run test:lifecycle:ci`, browser/T3/Playwright, providers, live
models and commercial actions were not run.

## Remaining limitations

- `P0-GATE-02-F01` blocks the gate until correction or an explicit owner
  amendment.
- The expected negative PDF-restore fixture reports the generated absolute
  recovery-snapshot path to stderr so a failed restore can be recovered. On
  Windows that generated temp prefix can contain the local username. It exposes
  no credential, environment value, pre-existing owner filename or file bytes,
  and no such value entered `B..S2`; it is recorded as a diagnostic/privacy
  limitation rather than the range-scope failure. Future W04 hardening should
  retain recoverability while redacting the profile prefix.
- Claude continuity remains `prepared_not_verified`.
- Optional hooks remain absent and nonblocking.
- Remote freshness is unproved because no fetch was authorized or performed.
- No browser/E2E evidence exists because it is explicitly prohibited for P0.

## Rollback and stop

Rollback remains available through normal Git history. Local `main` remains
exact B, candidate S2 remains on the external P0 worktree, original R1 and its
blob are immutable, and the preserved WIP branch/worktree remains clean at
`612a35c8b1d881f638570373d06f99d26bfb280e`. No reset, rebase, force operation,
branch deletion or integration occurred.

Because the result is FAIL, leave local `main` unchanged, do not begin P1 and
route the exact renderer-inventory defect to P0-W04A or an owner-approved
amendment. A fresh independent gate must review the resulting new candidate;
this report must not be rewritten.

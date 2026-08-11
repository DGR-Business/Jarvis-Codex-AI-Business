# Pantheon Pre-Venture Research Schema-27 Recovery Proof

Date: 2026-08-11
Status: approved live recovery and canonical schema-27 release complete; any v2 research authority remains a separate owner decision
Owner: Daniel
Technical steward: Jarvis (Codex)

## Owner Summary

Pantheon's pre-venture research support implementation and approved technical
recovery are complete. The older schema-27 source database was first rebuilt as
a separate lossless candidate, then installed as the live database through the
reviewed atomic replacement path after Daniel explicitly approved recovery.
The original raw database unit and a separately authenticated encrypted
rollback remain retained.

The recovered live runtime passed integrity and current-schema checks, locked
startup, health, monitor, signed-owner browser proof, a disposable restore from
the new active-key recovery set, and Doctor. The current schema-27 database is
therefore technically operations-ready.

This remains a recovery and software-control result only. Daniel approved the
technical recovery, not live research or any commercial action.

The original Pre-Venture Research Authority v1 expired on 2026-08-09 and is
immutable. No v2 authority or approval exists, and no provider call or research
round ran. Recovery and proof added zero provider calls, provider cost,
research artifacts, evidence items, diligence decisions, new approvals, or
outbound actions. There was no paid model cost or external commercial spend,
and no buyer, sale, revenue, publication, customer contact, advertising,
account action, or money movement.

Pantheon's long-term mission remains to build and operate multiple ventures in
parallel. The present one-venture focus is the first proof and safety gate, not
the final operating model.

## Recovery Identity

The proof pins the complete SHA-256 identity of each recovery component:

- standalone source database:
  `668573b8aa5c4086e5eb36431eda2088030ef15bc4efe07a4a8f21c612e722f1`;
- authenticated encrypted source backup:
  `8fbbea99edffeb296c49fb173a55effcddcfecb027e2f8a6be78a112efa01166`;
- verified offline schema-27 candidate:
  `70ea216b1e16dc7756765a6ee075d53a32318953e4e59669b2c405992c1da6db`;
- durable encrypted candidate archive:
  `f93afb102d1a716db6789b7e451493fba445a793bc4addd7523fb8817041eb22`;
- recovery-manifest file:
  `dad88ad19c3c0ccf8e5416b5780bdb8b92c1dc01a25ac0ffeb50a775fb2c9a16`;
  and
- immutable recovery manifest:
  `8e8fb0f324930ddc9c54c947532c0e549cd0a479a50b4f708e54617e66ea527b`.

The encrypted source archive, encrypted candidate archive, and manifest are
retained together under Pantheon's configured private recovery destination in
`schema27-recovery-20260811`. The candidate archive authenticated under key ID
`pbk-4185f1dda61cbd397c49` and restored to the exact candidate payload hash
above. The source archive retained its exact original encrypted hash.

The protected recovery credential was supplied only to the recovery process in
memory. It authenticated the encrypted backup and permitted construction from
that authenticated source. The plaintext credential was not printed, logged,
written into this repository, or included in the manifest or proof.

## What The Recovery Preserves

The offline rebuild preserved the recoverable schema-27 source data while
installing the final schema-27 namespace and its fail-closed controls. The
candidate builder itself contained no apply, replace, or live-swap step. The
later owner-approved installer used a separate reviewed atomic replacement
path, retained the exact original raw database main/WAL/SHM unit, and preserved
an authenticated encrypted pre-swap rollback.

Historical approval compatibility is deliberately exact and one-way. The one
pinned v1 approval pair remains readable only as historical evidence. It cannot
be used to create, activate, extend, revise, or dispatch work under a current
authority. New live approval remains v2 authenticated-owner-attestation only.

The v1 authority expired on 2026-08-09. Recovery neither changes that date nor
creates a v2 authority, approval, assignment, or permission.

## Approved Live Recovery Addendum

After the offline proof above, Daniel separately approved the technical
recovery required to make Pantheon operational. Jarvis then:

- stopped and independently checked the Pantheon runtime before replacement;
- created and authenticated an encrypted pre-swap rollback of the old live
  database and retained its exact raw database unit;
- staged and hash-checked the verified schema-27 candidate before atomically
  replacing the live database;
- started the recovered database in a fail-closed proof configuration with the
  scheduler, live research, provider adapters, and paid AI disabled;
- passed database integrity, current-schema, health, monitor, and signed-owner
  browser checks; and
- created and verified active-key recovery set
  `bdfab6e4-e765-47d0-830d-bfbef0532fe7`, restored it into a disposable
  location, and passed Doctor.

The current recovery set contains 770 files and is retained as
`pantheon-recovery-set-2026-08-11T08-50-37-927Z.jbackup`. Its archive SHA-256 is
`1f3f6c39035be44529e438aa4437e49a999554654a3ed3ab951f7973e51f1727`,
its manifest SHA-256 is
`de8add7f83674ffd8daf7156dd1ecdb8d133a1eda6bc1c765515d8dd01a9ba2b`,
and its payload SHA-256 is
`7f25160683fa1620278694dc01cb1de24b0d8b4cc7bc154cb75bc22fb9b7bab2`.
It authenticated under protected key identifier
`pbk-4185f1dda61cbd397c49`; this is an identifier, not a credential. The
disposable restore reported schema 27 current-ready, SQLite quick and full
integrity checks passed, and zero foreign-key violations. The protected
Pantheon check passed every operations-readiness check.

The locked monitor and browser proof showed the v1 authority as expired and
terminal, with provider contact and dispatch unavailable. The proof caused no
provider, cost, research-artifact, evidence, commercial-decision, approval, or
outbound-action delta.

## Verification Evidence

The recovery candidate passed the following checks:

- the combined focused recovery and authority test pack passed 35 of 35 tests;
- the complete five-shard ordinary test run passed on the final source;
- the full repository lint check passed;
- the Git whitespace and patch-integrity check passed;
- an independent adversarial review found the final authenticated-source,
  namespace-preservation, path-safety, migration-custody, and no-swap controls
  green;
- the candidate reopened and served the isolated local runtime without changing
  the live database;
- the isolated browser proof completed at four supported viewport sizes with
  zero console errors and no horizontal overflow; and
- the local monitor ran safely and reported only the expected inactive
  integration and disabled-scheduler warnings.

Neither the isolated candidate proof nor the approved live recovery approved
or executed a queued provider step. Relative to the recovered historical
candidate, they added zero provider calls, costs, research artifacts, evidence
records, diligence decisions, or approvals. No external commercial action
occurred.

## Explicit Non-Claims And Remaining Gates

- The verified candidate is now the live schema-27 database. The exact original
  raw database unit and encrypted pre-swap rollback remain retained.
- The expired v1 authority is not current permission. Daniel must separately
  approve a new exact, time-bounded v2 authority and provide authenticated owner
  attestation before any provider dispatch can be considered.
- No provider research, marketplace research round, customer interaction, paid
  action, or commercial validation occurred.
- Independent Google Password Manager custody is not recorded as complete.
  Daniel must later confirm masked presence of the recovery entry from a second
  trusted device or browser profile; no secret should be disclosed to Jarvis or
  recorded in the repository.
- The original recovery checkpoint did not itself satisfy the plan's
  diligence-round, readiness-decision, hosted-release, or commercial-result
  gates. The canonical-release addendum below closes only the release gate.

The technical recovery gate is closed. Recovery itself does not grant a v2
authority.

## Canonical Schema-27 Release Addendum

Date: 2026-08-12

### Release identity

Schema 27 is now canonical locally and online. Pull request #10 exact head
`50dba5905df47bb4430a5929d3d0dda7c0690388` passed all eight private release
jobs in GitHub Actions run `31516719014`. It merged through exact merge commit
`fcda9d472b0dcd6dceb53b0afd3b8cd4241fe017`; post-merge `main` run
`31517691274` passed the same eight jobs.

The complete release sequence was:

- pull request #8 final-head run `31489455600` passed, merge
  `c090fa932b198997f2809ddd53592db9c8786f52` landed, and post-merge `main` run
  `31491486655` exposed a containment stop-observation race;
- pull request #9 head `af1519d28d6aa15ffc7d1741e3d1bd4b33e445bb` passed run
  `31499587511`, merged as
  `c79b8a4ff9407534cb2cdd92e692dbb32ea7db2b`, and post-merge `main` run
  `31501123571` passed; and
- release proof then found opportunity timestamp churn, which the pull request
  #10 chain corrected without a commercial or provider effect.

On the exact content commit, local lint, the focused proof (1 of 1), the
Commercial Intelligence pack (13 of 13), and the full five-shard ordinary suite
passed. Supported owner-context Doctor was fully green, including the current
active-key recovery set and its authenticated disposable restore.

### Signed owner path and exact state boundary

The signed owner proof completed Start, one system check, and return to Standby.
Decisions was empty, no commercial test existed, the work queue was empty, and
there were zero Pantheon-origin browser console entries. Pantheon Control
finished in Standby; the working runtime on port 5051 was stopped.

The immutable proof identities are:

- pre-state snapshot SHA-256:
  `1a525d6f5f577d206f33c7e2399a7e052df011786b129d6348b4bd9301238337`;
- post-state snapshot SHA-256:
  `2835628f014c0c5667cd021641351152666751b72260f2945e1647093c428715`;
  and
- snapshot-collector SHA-256:
  `49fe9d844f9e5a9e5a4054ac57508342864cd41e62a9d9fefe9e78091b10be7d`.

All protected commercial records, including opportunity, cost, evidence,
authority, provider-execution, and billing records, and all artifacts remained
exact. Eight source-backed registry sets received timestamp-only readiness
refreshes, and all 11 existing integration records received timestamp-only
`last_checked_at` and `updated_at` observation refreshes while status, mode, and
health remained unchanged. Physical FTS storage rebuilt or
churned while logical and exhaustive FTS truth remained exact. The other bounded
operational changes were two zero-finding monitor runs, one scheduler run, and
three events. They created no provider or model call, cost, buyer contact,
publishing, account action, spend, commercial decision, new approval, or
outbound action.

### Commercial truth and remaining support item

This closes support and release gates only. V1 remains expired and terminal;
its assignments remain cancelled and unattempted. The v2 successor plan remains
an inactive draft and creates no authority, task, provider permission, cost, or
commercial action. There was no buyer, order, revenue, external test, or actual
net cash contribution.

One P2 support item remains. The retained legacy-key fallback in
`restore-pantheon.ps1` is not yet proved because native stderr can interact with
`$ErrorActionPreference = "Stop"` before the wrapper's candidate loop evaluates
the native exit code. This addendum does not claim that legacy wrapper path. The
current active-key recovery restore is proved and healthy, so the P2 is not a
canonical-release or Standby blocker.

Next, Pantheon should apply and prove the small fallback hotfix, refresh the
provider, model, pricing, channel, comparable, and economics facts at A$0, and
then present the exact v2 authority to Daniel for fresh approval and separate
activation. Google Password Manager custody remains deferred and non-blocking
until Daniel returns to the host PC. Pantheon's permanent destination remains a
portfolio-controlled multi-business machine; the first-venture gate still
requires three independent paying buyers and positive actual AUD net cash
contribution before Pantheon may propose up to three isolated venture lanes.

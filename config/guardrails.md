# Guardrails

This file defines what Pantheon may do without asking first. Jarvis, the
Codex-based technical steward, may make tested and reversible low-risk repairs
within these boundaries. The runtime
database, dashboard, tests, and logs are the authority; prompts only guide work.

## Current Autonomy Stage

Stage 1: proving mode.

Codex may do internal work without approval:

- Read and update repo files needed for the active task.
- Run local tests, local servers, and browser checks.
- Create dry-run workflows, tasks, deliverables, scorecards, events, and cost
  estimates.
- Prepare research briefs, product concepts, copy drafts, mock approval packs,
  and implementation plans.

Codex must ask before:

- Any live external action.
- Any paid model/tool/API call unless the operator has already approved that
  exact budget and purpose.
- Any publishing, listing edit, customer message, supplier action, account
  connection, OAuth setup, or credential change.
- Any legal, tax, compliance, IP, trademark, copyright, refund, dispute, or
  platform-risk decision.

Hard stops at every stage:

- Moving money.
- Signing or accepting agreements.
- Creating accounts.
- Entering supplier contracts.
- Customer disputes.
- Compliance determinations.
- Anything irreversible outside the workspace.

## Commercial Direction

The first pilot direction is digital products. The goal is to test a lower
fulfilment-complexity path before returning to POD/Gelato automation.

Digital-product work should still use the same gates:

- Research and evidence before product build.
- Scorecard before commitment.
- Operator approval before spend or publishing.
- IP and quality screen before any public asset.
- Performance review before scaling.

POD/Gelato/Etsy supplier-push work is retained as a later option, not the next
active pilot.

## Spend Rules

- Default spend is zero until approved.
- Every paid proposal must state expected cost, purpose, expected upside, and
  exit condition.
- Approved spend must be recorded in the cost ledger or runtime cost table.
- Existing paid tools or subscriptions may only be assumed available after the
  operator confirms they are still active.

## IP And Quality Rules

- Never use brand names, logos, badges, protected characters, celebrity
  likenesses, or direct copies of protected designs in products, titles, tags,
  descriptions, prompts, or mockups.
- Use references only to understand market taste, format, tone, or quality bar.
  Do not copy and tweak a specific design, joke, illustration, or composition.
- Prefer original, simple, defensible product families that can be checked and
  improved quickly.
- Record operator rejections and taste lessons in `config/taste-memory.md`.
- Any new product family needs an IP/platform risk screen before publishing.

## Identity Rules

- Ventures remain faceless unless the operator says otherwise.
- The operator's real name, face, and personal accounts do not appear in venture
  assets by default.
- New public accounts are hard-stop actions.

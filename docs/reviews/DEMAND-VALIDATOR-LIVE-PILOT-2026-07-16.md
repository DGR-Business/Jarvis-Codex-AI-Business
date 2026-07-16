# Demand Validator Live Pilot Evidence Record

Date: 2026-07-16
Status: technical failure; no commercial result
Operator: Daniel
Maintainer: Codex

## Approved Scope

- Provider: OpenAI Agents SDK `0.13.4`
- Model: `gpt-5.6-terra`
- Worker: Demand Validator
- Fixture hash: `e3293098cb65dc1f43eb5c6abc7e1f0ef6f4a8bed3cc896b470ecb9b15572934`
- Maximum turns: 1
- Maximum output: 1,200 tokens
- Maximum approved exposure: A$1
- Tools: none
- Handoffs: none
- External effects: none
- Protected baseline visible to worker: no

## Evidence Supplied

1. The evaluation fixture described repeated missed invoice, expense and cash-
   review tasks.
2. The fixture explicitly said it contained no paid buyers, product views or
   verified willingness-to-pay evidence.

The fixture was labelled evaluation-only and was not treated as real market
evidence.

## What Actually Happened

- The approval scope hash matched and the one-use approval was consumed.
- One task attempt started at `2026-07-16T04:32:51.582Z` and ended at
  `2026-07-16T04:33:07.514Z`.
- Exactly one live model-call record was created for `gpt-5.6-terra`.
- The SDK returned this error:
  `Invalid output type: Unterminated string in JSON at position 6568 (line 1 column 6569)`.
- No valid structured recommendation was captured.
- No provider response id or token usage survived the SDK parse failure.
- No deterministic pilot review, usefulness score or capability pass was
  created.
- The task and attempt are `needs_attention`; their provider outcome is
  `unknown`.
- The one-use approval was not reused and no automatic retry occurred.
- The A$1 reservation remains `unknown`. It is exposure pending reconciliation,
  not evidence that A$1 was actually charged.

## Diagnosis

Observed fact: the returned text could not be parsed because a JSON string was
unterminated at character 6,568.

Strongest current hypothesis: the generic worker contract asked the model to
repeat the judgement across a large nested business-decision object and pilot
fields, and the response did not finish within the 1,200-token ceiling.

That hypothesis is not a confirmed provider finish reason. The SDK error path
did not preserve raw usage, response id or finish metadata, so the record must
not claim confirmed truncation.

## Correction Made

- Replaced the repeated generic output with a lean Demand Validator contract:
  summary, money move, evidence, counterevidence, assumptions, price/channel
  hypothesis, smallest test, metric, stop rule, risks, next action, decision and
  confidence.
- Kept the same one-turn, 1,200-token and A$1 limits.
- Added token-price AUD estimates for successful runs while keeping provider
  reconciliation separate from estimates.
- Added a separate AUD accounting ledger for operating cash and recurring costs.
- Made consumed approvals disappear from executable-readiness counts.
- `npm.cmd test` passes 84/84 tests after the correction.

The correction is locally proven only. It has not passed a second live call.

## Accounting Context

- OpenAI API credit purchase: US$10 credit plus US$1 tax; actual Australian-bank
  charge A$15.79. Automatic recharge is off.
- ChatGPT Pro 5x July upgrade payment: A$94.68 after an A$5.32 unused-Plus credit.
- Current ChatGPT Pro 5x recurring commitment: A$100.00 per month.
- July cash paid across those confirmed OpenAI items: A$110.47.
- First model-call consumption: unknown pending provider billing evidence.

## Next Gate

1. Reconcile the failed attempt against OpenAI usage/billing.
2. Acknowledge and reset the technically failed fixture without erasing history.
3. Prepare a new one-use approval for the corrected contract.
4. Retry once only after Daniel separately approves that exact action.
5. Judge commercial usefulness only if a valid recommendation is captured.

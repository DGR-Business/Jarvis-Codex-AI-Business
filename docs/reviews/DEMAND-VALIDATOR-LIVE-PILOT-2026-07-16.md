# Demand Validator Live Pilot Evidence Record

Date: 2026-07-16
Status: corrected run passed technical review; operator usefulness verdict pending
Operator: Daniel
Maintainer: Codex

## Approved Scope

Both attempts used separately approved, single-use scopes over the same fixture:

- Provider: OpenAI Agents SDK `0.13.4`
- Model: `gpt-5.6-terra`
- Worker: Demand Validator
- Fixture hash: `e3293098cb65dc1f43eb5c6abc7e1f0ef6f4a8bed3cc896b470ecb9b15572934`
- Maximum turns: 1
- Maximum output: 1,200 tokens
- Maximum approved exposure: A$1 per attempt
- SDK tools: none
- Handoffs: none
- External effects: none
- Protected baseline visible to worker: no

The corrected attempt received a new task, workflow, approval and scope hash.
The first consumed approval was never reused.

## Evidence Supplied

1. The evaluation fixture described repeated missed invoice, expense and cash-
   review tasks.
2. The fixture explicitly said it contained no paid buyers, product views or
   verified willingness-to-pay evidence.

The fixture was labelled evaluation-only. It is useful for testing reasoning
over supplied evidence, not for claiming that live market demand exists.

## Attempt One: Preserved Failure

- Task: `task_live_worker_wf_demand_validator_pilot_d49d9642`
- SDK trace: `trace_39431c0fdacb4eabbcf7371feb132602`
- Started: `2026-07-16T04:32:51.582Z`
- Ended: `2026-07-16T04:33:07.514Z`
- Result: known technical failure
- Error: `Invalid output type: Unterminated string in JSON at position 6568
  (line 1 column 6569)`

Exactly one provider request occurred. No usable recommendation, response ID,
runtime token record, deterministic review or capability pass was captured. The
history-preserving reconciliation later changed the provider outcome from
unknown to known failed; it did not turn the attempt into a pass.

The strongest diagnosis remains that the original repeated output contract was
too large for the 1,200-token ceiling. This is a diagnosis, not a confirmed
provider finish reason.

## Correction

- Replaced the repeated generic business object with a lean Demand Validator
  result contract.
- Retained the same one-turn, no-tool, 1,200-token and A$1 controls.
- Added a one-time technical retry path that requires the exact failed task,
  explicit acknowledgement, a consumed prior approval and a fresh scope.
- Added provider reconciliation for exact task/cost/model records.
- Separated SDK trace IDs from API response IDs and preserved trace IDs even
  when structured-output parsing fails.

No token increase was needed.

## Attempt Two: Corrected Success

- Task: `task_live_worker_wf_demand_validator_pilot_11493dc5`
- Agent run: `agent_run_977b9be7-9868-4150-89ac-f1e5f355470b`
- SDK trace: `trace_ce3936bdcf464644a8b94696598c6aea`
- Response ID: `resp_0c7bd5258a29fcc8016a586aeadec0819b9b60a16506207d5c`
- Started: `2026-07-16T05:23:52.677Z`
- Completed: `2026-07-16T05:23:58.567Z`
- Provider trace duration: 5.393 seconds
- Input tokens: 1,329
- Output tokens: 335
- Total tokens: 1,664
- Raw responses: 1
- Interruptions: 0
- SDK tool calls: 0
- Handoffs: 0

The run returned valid structured output. Runtime evaluation passed at 100, and
the deterministic pilot review passed all six technical criteria:

- source validity;
- no unsupported live-evidence claim;
- required reasoning structure;
- exact scope compliance;
- cost-cap compliance;
- protected baseline exclusion.

## Actual Recommendation

The Demand Validator did not claim that demand was proven. It recommended only
a small, non-paid interest test because the fixture supports a recurring cash-
control problem but contains no evidence that buyers seek or pay for this
specific checklist.

Its proposed next step was to define one approved audience, test duration,
qualified-interest threshold and concept message before outreach. It suggested
an example threshold of five qualified requests from the defined buyer segment.
Its stop rule was to end the test if the approved audience or time limit was
reached without the pre-set interest threshold. Confidence was low.

This is a commercially cautious supplied-evidence judgement. It is not market
research, a buyer test, proof of demand or authority to contact anyone.

## Provider And Cost Proof

The signed-in OpenAI usage dashboard showed exactly two July requests, 2,742
total tokens and US$0.03 total spend. Those counts match the two recorded pilot
attempts. At the actual prepaid-credit acquisition rate of 1.579 AUD per USD,
US$0.03 equals A$0.04737, recorded as A$0.05 after whole-cent rounding.

OpenAI exposed only the aggregate two-call amount. The ledger therefore marks
the A$0.03 failed-call and A$0.02 successful-call split as an allocation, not
exact per-call billing. Current controlled AI spend is:

- Reconciled: A$0.05
- Estimated: A$0.00
- Unknown: A$0.00
- Reserved: A$0.00
- Remaining pre-revenue monthly cap: A$99.95

Operating cash remains separate: A$15.79 API credit purchase, A$94.68 July
ChatGPT Pro upgrade payment and A$100 monthly recurring Pro commitment.

## Safety Result

No publishing, customer contact, account action, legal/compliance decision,
money movement, paid research, search tool or other external effect occurred.
Live-model mode was disabled again after the run. Final restart verification
also found that the restricted key was not persisted outside the live test
process, so the current protected runtime has no credential loaded.

## Verification

- Encrypted pre-retry database backup authenticated and restored exactly.
- A new encrypted post-pilot database, source and artifact checkpoint was made
  after reconciliation and final runtime verification. All three backups
  authenticated on restore. The restored database passed SQLite integrity,
  preserved both attempts and the pending review, and reported A$0.05
  reconciled provider spend. Sampled source hashes matched and 20 artifact files
  were recovered.
- All 86 automated tests pass.
- Local health, cockpit state, recommendation display, review controls, console
  and responsive desktop layouts were checked in a real browser.
- The stale unknown-outcome alert is resolved. Important Work now contains only
  the genuine operator review of the successful recommendation.

## Post-Run Observability Correction

Daniel found that the OpenAI trace existed but its Responses span displayed
`Could not fetch Response`. The cause was verified in the pilot runner:

- `modelSettings.store` was explicitly `false`, so the successful Response was
  not retained for later provider retrieval;
- `traceIncludeSensitiveData` was explicitly `false`, so generation input and
  output were omitted from the provider trace.

Those settings were privacy-preserving but unsuitable for a controlled fixture
that Daniel needs to inspect. The historical provider Response cannot be made
retrievable after the fact. Its structured result, review, usage and local trace
were already preserved in Jarvis.

The AI Team now provides a focused run-review drawer and API record. Future
non-personal controlled fixtures bind provider response storage and trace
content to the exact single-use approval scope. Other work remains privacy-first
unless its own scope explicitly allows provider retention.

The usefulness verdict remains pending until Daniel reviews this local record.

## Next Gate

Daniel must judge whether the recommendation was commercially useful. No
capability streak is awarded before that verdict. If useful, the next live run
must use a distinct fixture and a separate approval. No external test or Chief
of Staff follow-up is authorised by this evidence record.

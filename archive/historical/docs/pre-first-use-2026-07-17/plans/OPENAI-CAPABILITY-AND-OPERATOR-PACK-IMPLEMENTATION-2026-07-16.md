# OpenAI Capability And Operator Pack Implementation

Date: 2026-07-16
Status: implemented and locally verified
Owner: Daniel
Maintainer: Codex

## Objective

Make the existing Agents SDK path fit the actual business system: workers see
only the evidence and tools needed for their job, Jarvis remains the sole owner
of business state and approvals, every paid capability is narrowly bounded, and
Daniel receives concise decision documents rather than machine records.

## Implemented Runtime Boundary

- `AgentRuntime` remains the provider facade. Jarvis owns venture state, task
  claims, approvals, budgets, records, recovery, evaluation and dashboard truth.
- All 11 workers receive `jarvis_worker_model_packet_v1` packets assembled from
  allowlisted commercial context. Each role has its own strict output contract.
- The Agents SDK receives only exact capabilities approved for the worker and
  task. No general browser, filesystem, account, publishing, payment or customer
  contact access is exposed.
- Direct Responses API paths remain available for lower-level calls where
  Jarvis should own the loop; storage policy is explicit on those calls.

## Implemented Capabilities

| Worker | Capability | Limit | State |
|---|---|---:|---|
| Demand Validator | Hosted web search | A$2, 3 calls, 4 turns, 120 seconds | Code-ready; separate live approval required |
| Product Builder | GPT Image generation | A$1, 1 asset, 2 turns, 180 seconds | Code-ready; separate live approval required |
| Quality Reviewer | Visual review of exact same-workflow images | A$1, 4 assets maximum, 1 turn | Code-ready; separate live approval required |

Generated images are stored as local deliverables with model, size, quality,
revised prompt, content hash, byte count and approval provenance. Image bytes are
not copied into logs. Publishing remains a separate hard stop.

## Approval And Observability Contract

- Model, fixture, packet hash, tools, arguments, tool-call count, turn count,
  deadline, cost cap, storage policy, trace-content policy and effects are bound
  to the exact single-use approval.
- An SDK interruption stores the serialized run state and SHA-256 hash in the
  tool approval. Approval resumes that same state; changed or invalid state is
  rejected.
- Provider requests, tool activity, sources, query summaries, generated assets,
  trace IDs, response IDs, tokens and cost status are retained locally.
- Estimated token or hosted-tool cost is never presented as reconciled spend.
  Timeouts remain unknown outcomes and are not automatically retried.

## Operator Decision Brief V2

The human PDF is now `jarvis_operator_decision_brief_v2`, separate from the
structured records used by workers. It presents:

- the next money move and recommendation first;
- buyer, problem, offer, channel, economics and commercial score;
- evidence for, evidence against and material assumptions;
- hypothesis, smallest test, success measure and stop rule;
- risks, safeguards, accountable team work and review outputs;
- clear approve, request changes and decline choices.

Raw paths, database fields, provider payloads and internal status jargon are
removed before rendering. Dense workflows paginate into readable A4 pages
instead of shrinking or overflowing.

## Proof

- 92/92 automated tests pass.
- Quality Reviewer input proof materialises the exact approved local PNG as an
  SDK `input_image`, rejects an asset from another workflow, applies 10 MB per-
  file and 20 MB total limits, and records no base64 or local path.
- The SDK interruption test proves one pause, one exact nested approval, one
  single-use approval consumption and same-state resume without a second start.
- A short decision brief rendered to two pages and a dense 11-worker case to
  four pages. Every rendered page was visually inspected for clipping,
  overlap, hierarchy and legibility.
- Both current production review PDFs were regenerated from live runtime state
  after the redesign. Their eight pages were visually inspected, and the final
  pagination rule keeps the decision heading and its three choices together.
- Text extraction confirms the money move, decision, evidence and test sections
  while excluding raw paths, `file_path`, `approval gate` and `dry-run active`.
- No live model, hosted tool, image generation, publishing, outreach, account
  action, legal decision or money movement was used for this implementation.

## Current Gate

Daniel rated the successful no-tool Demand Validator result useful at 4/5, so
the exact supplied-evidence reasoning capability is supervised at 1/5. The next
decision is whether to advance its recommendation to a small, non-paid interest
test. If the path continues, use one distinct supplied-evidence fixture under a
new A$1 approval. The A$2 search proof follows only after a deliberate timing
decision; image generation waits until the selected product genuinely needs one
asset.

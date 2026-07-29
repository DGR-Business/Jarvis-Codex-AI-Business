# Pantheon Agent Assurance And OpenAI Integration Hardening

Date: 2026-07-28
Status: complete
Owner: Daniel
Technical steward: Jarvis (Codex)

## Goal

Make Pantheon's live AI work trustworthy enough to support the next commercial
test without expanding the system into a larger, harder-to-control agent
platform.

This phase will:

- version the complete worker harness and bind that identity to approvals,
  traces, receipts, evaluations, and operator review;
- make every related worker run navigable as one commercial trace group;
- evaluate agent behavior and commercial usefulness rather than accepting
  structurally complete JSON as sufficient proof;
- add proportionate Agents SDK guardrails while keeping Pantheon runtime policy
  authoritative;
- expose a simple, factual account of what ran, what evidence was used, what it
  cost, and why it passed or failed;
- measure prompt-cache and processing-cost behavior before attempting
  optimization; and
- preserve every useful but premature OpenAI capability behind an explicit
  adoption trigger.

This is a bounded assurance phase. It must not become another long foundation
programme or delay the smallest valid buyer-intent test once its release gates
pass.

## Architecture Decision

Pantheon remains the commercial control plane and source of truth. It owns:

- ventures, work packages, attempts, approvals, costs, evidence, and results;
- task claims, retries, recovery, and unknown provider outcomes;
- worker and tool authority;
- commercial policy and outcome learning;
- the operator dashboard and durable audit history.

The OpenAI Agents SDK remains the first-class bounded execution engine. It may
run a specialist loop, invoke exactly approved tools, pause and resume for an
approval, and emit traces. It may not become the business database, budget
authority, scheduler, approval system, or portfolio controller.

This follows the current OpenAI guidance for
[Agents SDK applications](https://developers.openai.com/api/docs/guides/agents),
[running agents](https://developers.openai.com/api/docs/guides/agents/running-agents),
[orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration),
and [agent evaluations](https://developers.openai.com/api/docs/guides/agent-evals).

## Scope

### In scope

- first-class harness and policy version identity;
- Agents SDK trace grouping and richer safe metadata;
- a versioned behavioral evaluation dataset derived from real Pantheon failure
  modes;
- deterministic, behavioral, trace, operator-usefulness, and eventual
  commercial-outcome evaluation layers;
- one calibrated semantic review path that remains advisory until it matches
  reviewed labels reliably;
- SDK input and output guardrails that fail closed without replacing runtime
  checks;
- stable worker-policy prompts separated from dynamic task packets;
- measured prompt-cache reporting and an eval-only Flex-processing option;
- grouped, ordinary-language Live Run details in the dashboard;
- focused tests, one bounded live provider proof, and real-browser validation;
- current Master Plan, Build Log, decision, architecture, and future-capability
  records.

### Out of scope

- Sandbox Agents or hosted shell in production work;
- broad MCP, connector, browser, filesystem, or computer-use access;
- OpenAI Commerce or Agentic Checkout integration;
- server-side Responses Multi-agent execution;
- SDK conversation sessions as Pantheon business memory;
- autonomous prompt rewriting, code changes, pull-request merge, or deployment;
- dynamic worker creation or recursive delegation;
- a second active venture, product build, publication, customer contact,
  advertising, account action, agreement, or money movement.

The deferred items above are retained in
`docs/architecture/PANTHEON-OPENAI-CAPABILITY-ADOPTION-ROADMAP.md`.

## Implementation Phases

### Phase 1 - Harness Identity And Trace Topology

Create one versioned harness descriptor containing at least:

- worker definition version;
- prompt-policy version;
- output-contract version;
- tool-contract version;
- Commercial Constitution version;
- model-routing policy version;
- evaluator version; and
- a deterministic aggregate harness hash.

Bind the descriptor and hash to:

- model materialization and approval scope;
- worker task and attempt metadata;
- immutable execution receipts;
- Agents SDK trace metadata;
- evaluation subjects and results; and
- operator review.

Give every related commercial workflow a stable trace group ID. Use the Agents
SDK `groupId` surface so independent worker calls remain separate resumable
runs while appearing as one navigable commercial job. The group identity must
derive from Pantheon-owned venture, portfolio case, journey, workflow, or work
package identity. It must not depend on model-generated text.

Trace metadata will include only safe operational identifiers and versions.
Provider trace-content storage remains off by default, and no private
chain-of-thought is requested or displayed.

**Gate:** two independent worker runs for one work package have distinct trace
IDs, the same stable trace group ID, exact local receipt links, and no sensitive
content in provider metadata.

### Phase 2 - Agent Assurance Evaluation V1

Keep `local-structural-v2` as the first deterministic check. Add a separate
behavioral assurance layer; do not silently change the meaning of historical
scores.

Build at least 20 reviewed pass/fail examples across these real failure themes:

1. no attributable evidence;
2. invented demand, sales, traffic, or unit volume;
3. adjacent-market demand presented as proof of the exact offer;
4. unsupported willingness-to-pay or contribution claims;
5. contrary evidence ignored;
6. a future kill rule misread as a present rejection;
7. wrong or unnecessary tool selection;
8. required provider-tool activity missing;
9. stale or changed approval scope;
10. external action or authority implied without permission;
11. incomplete or misleading product artifacts;
12. a recommendation that is complete in shape but commercially useless.

Each case records:

- worker and assignment class;
- exact input fixture and evidence provenance;
- expected behavior and prohibited behavior;
- deterministic assertions;
- semantic rubric;
- reviewed label and reviewer reason;
- applicability and known limitations; and
- training/calibration or held-out status.

Add five evaluation layers:

1. **Runtime and structural:** schema, exact scope, tools, cost, source presence,
   approval, and external-effect checks.
2. **Behavioral:** evidence use, counterevidence, uncertainty, refusal,
   recommendation quality, and compliance with the worker contract.
3. **Trace behavior:** model route, tool choice, tool completion, handoff or
   no-handoff choice, guardrails, interruption, and recovery.
4. **Operator usefulness:** Daniel or Jarvis records whether the result was
   clear, actionable, and commercially credible.
5. **Commercial outcome:** after real action, compare the recommendation with
   conversion, contribution, refund, support, time, or other recorded results.

The first semantic grader must use strict structured output and receive no
hidden expected answer. It remains advisory until it reaches at least 90%
agreement on a minimum 20-case reviewed set, including contradictory examples.
It cannot grant autonomy, approve work, change business state, or overrule
measured outcomes.

Turn accepted human feedback into proposed regression cases. Jarvis reviews the
case and expected behavior before it joins the durable suite. Do not introduce
Promptfoo or HALO unless the native Node runner demonstrably cannot provide the
required repeatability.

**Gate:** the suite rejects every named failure mode, preserves held-out labels,
and detects a deliberately weakened prompt, tool policy, or output.

### Phase 3 - Guardrails And Prompt Discipline

Separate stable worker policy from the dynamic business packet:

- stable developer instructions define role, authority, evidence standards,
  hard stops, language, and output behavior;
- dynamic input carries the exact venture, task, evidence, limits, correction,
  and decision request;
- every materialized request remains hash-bound to approval.

Add deterministic Agents SDK guardrails for:

- input scope and prohibited external effects;
- output authority, unsupported completion claims, and required uncertainty;
- sensitive or irrelevant data classes where the worker has no recorded need.

Runtime approval, tool, cost, and policy checks remain authoritative. SDK
guardrails are an earlier and clearer failure surface, not a second policy
engine. Tool guardrails are added only when Pantheon introduces function or MCP
tools that need argument and result checks.

Keep the existing `prompt_cache_key`, measure cached reads and cache writes by
worker and harness version, and report the result. An eval-only Flex-processing
option may be enabled for retry-safe, non-interactive evaluation work. Flex
unavailability must be a known incomplete evaluation, not a successful run or
an automatic paid retry.

**Gate:** prompt or policy changes invalidate the old approval, cache metrics
are observable, and SDK guardrail failures leave a complete non-dispatched or
known-failure receipt.

### Phase 4 - Operator And Jarvis Observability

Extend the existing AI Team and Live Runs surfaces rather than creating another
dashboard.

The normal view will show:

- commercial job and current stage;
- worker and model route;
- plain-language status;
- evidence and tools actually used;
- conclusion and next action;
- deterministic, behavioral, trace, and usefulness review state;
- elapsed time, token use, cache use, and AUD cost;
- corrections, interruptions, and known limitations; and
- links to exact outputs and technical trace details.

Related runs are grouped under one work item. Technical identifiers and raw
safe events remain available on demand. No screen claims to reveal private
reasoning.

**Gate:** Daniel can tell what ran, what it used, whether it was useful, what it
cost, and what happens next without reading raw JSON or the OpenAI Platform.

### Phase 5 - Verification And Release

Add focused tests for:

- harness-hash determinism and version invalidation;
- trace-group isolation and metadata safety;
- approval binding after any harness change;
- every assurance fixture and held-out case;
- semantic-grader advisory authority;
- guardrail failure before acceptance;
- cache accounting and eval-only Flex behavior;
- resumed approvals and unknown provider outcomes;
- duplicate clicks and idempotent review;
- dashboard grouping and ordinary-language output.

Run:

- the complete isolated Node suite;
- zero-warning lint and `git diff --check`;
- critical dependency audit;
- Pantheon Doctor and database integrity checks;
- one bounded live Luna subject run and one Terra semantic review, with a
  combined A$2 maximum, no external effect, and known outcome required;
- real-browser proof at 1440x900, 1280x720, and 1024x768;
- encrypted recovery and independent restore if the database schema changes;
  and
- private GitHub CI from a clean branch.

The live proof must show the same trace group in Pantheon and OpenAI, exact
model and tool activity, all evaluation layers, token and AUD cost, and one
simple next action. A structural pass without behavioral assurance is not a
release pass.

## Interfaces

Introduce or extend focused internal contracts:

- `AgentHarnessDescriptor`
- `AgentTraceGroup`
- `AgentAssuranceCase`
- `AgentBehaviorEvaluation`
- `AgentSemanticReview`
- `AgentGuardrailResult`
- `AgentImprovementProposal`

Extend focused dashboard reads for grouped live work and assurance detail.
Existing routes remain compatible during migration.

No external-action interface is widened by this goal.

## Completion Criteria

This goal is complete only when:

- every live worker attempt records an exact harness identity;
- related runs are grouped without merging their independent state;
- a minimum 20-case reviewed assurance dataset and held-out set pass;
- one semantic grader reaches the calibration threshold or remains truthfully
  disabled as advisory-only;
- structural success alone cannot promote a capability;
- safe SDK guardrails and authoritative runtime gates both pass;
- Daniel can review grouped work in ordinary language;
- all local, browser, recovery, and CI gates pass;
- one bounded live proof returns a known outcome under the A$2 ceiling; and
- the Master Plan and Build Log state the next commercial action clearly.

The next commercial action remains the smallest functional sample and
measurement-ready buyer-intent test for the parked 9-of-10 Social Media Manager
case. This assurance phase does not change that investment decision.

## Implementation Result

Pantheon completed the local release on 2026-07-28:

- every live attempt carries the exact aggregate harness hash and its component
  policy versions;
- related Agents SDK runs share a stable Pantheon-owned trace group without
  merging attempt state;
- 25 reviewed behavioral cases pass their expected labels, including held-out
  and contradictory cases;
- SDK input and output guardrails fail closed while Pantheon remains the
  authoritative policy engine;
- the semantic reviewer is structured, costed, traceable, and truthfully
  `advisory_not_calibrated`;
- malformed known provider responses are recorded as incurred estimates and
  never retried invisibly;
- Live Runs groups related work and shows assurance, evidence, tokens, costs,
  and limitations in ordinary language;
- one bounded live Luna subject and one separately visible corrected Terra
  review completed under A$0.10 estimated combined exposure; and
- 294 tests, lint, moderate dependency audit, operations-ready Doctor,
  encrypted recovery verification, and all three desktop browser sizes passed.

The exact proof, failures, traces, costs, and limitations are retained at
`docs/proofs/2026-07-28-agent-assurance-openai-hardening-proof.md`.

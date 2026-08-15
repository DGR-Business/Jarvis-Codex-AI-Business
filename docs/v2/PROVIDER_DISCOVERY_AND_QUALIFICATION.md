# Provider Discovery, Qualification and Runtime Selection

## Purpose

Pantheon must use the best available capability for a venture, not merely the provider the owner or an earlier agent happened to know.

Dynamic provider choice is permitted only through a controlled lifecycle.

## 1. Capability requirement first

The Business Systems Architect produces a provider-neutral Capability Requirement specifying:

- business objective;
- inputs and outputs;
- minimum quality;
- acceptable latency;
- expected volume;
- budget;
- required commercial rights;
- data sensitivity;
- jurisdiction;
- integration requirements;
- staging/sandbox needs;
- authority and reversibility;
- observability and evidence needs;
- fallback requirements.

## 2. Candidate discovery

The Capability Procurement Agent researches the current market using official sources first.

It considers:

- direct APIs and SDKs;
- official OpenAPI specifications;
- official MCP servers;
- official export/import workflows;
- qualified managed-data providers;
- controlled browser automation only when better interfaces do not exist.

An owner-suggested service is included as a candidate, not presumed to be the winner.

## 3. Mandatory qualification dimensions

- functional capability fit;
- output quality;
- API/MCP maturity and documentation;
- authentication and least-privilege scopes;
- sandbox/test support;
- asynchronous job and webhook model;
- idempotency and retry safety;
- price, credits, hidden costs and minimum commitment;
- rate limits and quotas;
- latency and reliability;
- commercial-use and output ownership;
- privacy, retention and model-training terms;
- jurisdiction and regional availability;
- moderation and prohibited-use rules;
- observability, support and incident history;
- vendor lock-in and exportability;
- adapter development and maintenance cost;
- rollback and substitute availability.

## 4. Benchmarking

Where practical, shortlisted providers receive the same representative brief, inputs and constraints.

Record:

- raw result;
- success/failure;
- total cost;
- latency;
- manual intervention;
- quality rubric scores;
- output defects;
- legal/rights limitations;
- API or operational friction.

Creative capability benchmarks require AI QA plus owner review until Pantheon has earned reliable visual-quality autonomy.

## 5. Provider Decision Record

A Provider Decision Record must identify:

- capability requirement;
- candidates considered;
- evidence date;
- disqualifiers;
- benchmark results;
- weighted score;
- recommended provider and fallback;
- confidence and unresolved unknowns;
- approved budget and scopes;
- review date;
- rollback path.

## 6. Security boundary

Discovery cannot:

- install an MCP server or package;
- execute unreviewed startup commands;
- provide credentials;
- accept provider terms;
- subscribe or spend;
- expose Pantheon data;
- activate a provider.

Public MCP registry presence is not a security certification. Every MCP server is treated as untrusted code or a remote trust boundary until qualified.

## 7. Registry lifecycle

```text
discovered
researched
shortlisted
sandboxed
qualified
approved
active
degraded
suspended
retired
```

Only `active` providers are eligible for runtime routing.

## 8. Runtime routing

Routing is deterministic and auditable at first. It enforces hard eligibility before scoring quality, cost or latency.

The agent may recommend a provider, but deterministic policy decides whether that provider is allowed for the current venture, data, budget and action.

## 9. Requalification

Re-evaluate providers when:

- the review date arrives;
- pricing or terms change;
- quality materially changes;
- failure rate crosses threshold;
- a better candidate emerges;
- a security or privacy issue appears;
- a venture requires materially different capabilities.

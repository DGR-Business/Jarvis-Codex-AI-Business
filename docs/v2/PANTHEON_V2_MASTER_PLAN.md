# Pantheon v2.1.1 Master Plan

**Version:** 2.1.1  
**Date:** 15 August 2026  
**Owner:** Daniel / DGR Business  
**Status:** Proposed execution baseline  
**Primary implementation agent:** OpenAI Codex  
**Continuity and independent-review agent:** Claude Code  
**Current product:** Pantheon, formerly Jarvis-Codex AI Business  
**Canonical Windows repository path:** `C:\Pantheon`  
**Current remote repository identity:** `DGR-Business/Jarvis-Codex-AI-Business` unless separately renamed  
**Scope:** From the current repository state to a commercially viable, continuously learning AI business builder and operator

---

## 1. Executive mandate

Pantheon v2.1.1 is not a single-product automation bot and not a collection of AI chat personas.

It is a governed AI business operating system that must repeatedly:

1. discover viable business opportunities;
2. investigate markets and disconfirm weak ideas;
3. construct a venture-specific operating system;
4. assemble the necessary AI team and external capabilities;
5. validate demand;
6. create a commercially credible offer, product, brand, website and marketing;
7. launch through controlled external actions;
8. operate customer, finance, marketing, product, compliance and support functions;
9. measure real outcomes;
10. learn from success and failure;
11. scale, revise, pause or kill ventures;
12. transfer reliable learning to future ventures; and
13. repeat across multiple ventures.

Pantheon v2.1.1 must preserve the valuable control-plane foundation already built. It must not be rewritten from scratch.

The v2 programme has three dominant objectives:

- **Capability:** connect Pantheon to best-in-class external tools and data providers through a provider-neutral Capability Fabric.
- **Visibility:** replace the current developer-centric cockpit with an elegant, dynamic, real-time owner control plane.
- **Commercial operation:** complete the missing path from intelligence and product creation to publication, traffic, transaction, fulfilment, customer feedback, reconciliation and learning.

The programme must stop adding foundation for its own sake. New foundation work is permitted only where it is required by the target architecture, maintainability, safety, visibility or a verified commercial need.

Named providers in this plan are **bootstrap candidates, not permanent architectural commitments**. Pantheon must identify the capability a venture needs, research the current provider market, qualify candidates, benchmark them where practical, and route execution only through providers that have been approved into the Capability Fabric. A provider suggested by the owner, Codex, Claude or an agent is a candidate until evidence supports its use.

---

## 2. Definition of success

### 2.1 Pantheon v2.1.1 technical success

Pantheon v2.1.1 is technically successful when:

- the owner can observe all ventures, agents, tasks, evidence, costs, approvals, assets, experiments and commercial outcomes in real time;
- Venture Kits describe business domains rather than rigid human task lists;
- a Business Systems Architect can generate a venture-specific operating plan and executable workflow graph;
- specialist agents use governed capabilities through a common provider interface;
- low-risk work proceeds under standing authority;
- consequential actions pause for human approval;
- every material external action is attributable, idempotent, auditable and recoverable;
- the workflow runtime supports dependency-aware parallelism even when operational concurrency is initially restricted to one;
- provider integrations can be added or replaced without rewriting agents;
- the system records commercial evidence and learning in a reusable institutional knowledge layer;
- the runtime can continue independently of the dashboard process; and
- Codex and Claude Code can develop the system through bounded work packages without relying on conversation memory;
- material UI changes are inspected in the running application through an interactive browser, while Playwright is reserved for durable automated regression; and
- provider selection is evidence-based, revisable and separated from provider installation or live authority.

### 2.2 Commercial viability

Commercial viability is not defined by a demo, a generated product or a test-mode payment.

The first venture reaches commercial viability when all of the following are true:

1. at least one offer has been launched to real prospective customers;
2. at least three independent paying customers have completed genuine transactions;
3. products or services were fulfilled correctly;
4. payment, fees, refunds, external spend and fulfilment costs are reconciled;
5. the offer has positive net cash contribution after attributable variable costs;
6. Pantheon has recorded evidence, diagnosed outcomes and proposed the next action;
7. the result can be reproduced without changing Pantheon source code for that individual offer; and
8. the owner can understand the full result from the control plane without reading code or logs.

The first failed offer is not a programme failure. Pantheon must be able to kill or revise it, retain the learning, choose another opportunity and run the loop again.

### 2.3 Repeatability

The digital-product Venture Kit is proven only after a second opportunity can pass through the same operating system without bespoke source-code changes.

Multi-venture operation is proven only after two isolated ventures can operate concurrently without state, credential, budget, customer, evidence or workflow contamination.

---

## 3. Current-state diagnosis

### 3.1 What must be retained

The current Pantheon repository contains valuable machinery that should form the v2 foundation:

- persistent ventures, workflows, tasks, runs and deliverables;
- task claims, leases and stale-work recovery;
- OpenAI Agents SDK and Responses API execution paths;
- specialist worker definitions and structured output contracts;
- approval, permission and spend controls;
- research provenance and commercial truth classification;
- model and hosted-tool cost records;
- internal accounting and commercial-result reconciliation;
- quality review and evidence bindings;
- scheduler and monitoring functions;
- backup, restore, recovery and local security controls;
- existing digital product generation capabilities; and
- extensive regression tests.

### 3.2 What must change

The current implementation has several structural limitations:

- important production modules are extremely large and expensive for a coding agent to understand safely;
- the UI is developer-centric and concentrated in a large vanilla JavaScript application;
- workflow execution is effectively serial;
- external commercial I/O remains narrow or dry-run;
- Venture Kits are not yet a complete dynamic venture-planning system;
- the system has stronger internal assurance than real-world commercial capability;
- provider integrations are too implementation-specific and the initial roadmap risks treating suggested vendors as predetermined winners;
- development continuity is too dependent on one model session rather than repository-owned handoff state;
- full test and Git activity can consume coding-agent sessions before commercial work is completed;
- project progress is not expressed as a machine-executable engineering programme; and
- the owner cannot yet see Pantheon operating as a living company.

### 3.3 What must be deferred

The following are deliberately deferred until after commercial viability:

- a ground-up rewrite;
- Kubernetes or a microservice estate;
- multi-tenant SaaS architecture;
- unrestricted self-modifying source code;
- fully autonomous high-value spending;
- arbitrary browser automation where an official API or MCP service exists;
- simultaneous support for every possible business model;
- migration to PostgreSQL solely for prestige;
- migration to Temporal, LangGraph or Trigger.dev solely because they are fashionable;
- a mobile application;
- a public app marketplace; and
- fully autonomous portfolio capital allocation.

---

## 4. Non-negotiable architecture principles

### 4.0 Repository identity and path portability

The canonical Windows master-worktree path for this programme is `C:\Pantheon`.
This is an operator convention, not a production-code dependency.

Pantheon, Codex and Claude Code must treat the active Git root returned by
`git rev-parse --show-toplevel` as authoritative. They must not infer the root
from a remembered conversation, an old recent-project entry, the GitHub
repository name or the former local folder name.

The following rules apply:

- do not hard-code `C:\Pantheon`, `Jarvis-Codex-AI-Business` or any other
  machine-specific repository path into production code, tests, scripts,
  provider manifests or workflow definitions;
- derive repository-owned paths from the current Git root, module location,
  `CONFIG.rootDir` or an explicit validated environment variable;
- keep environment-specific absolute paths in ignored local configuration and
  verify them after any repository move;
- treat the local folder name and the GitHub remote repository name as separate
  identities. Renaming the local folder does not require renaming the remote;
- create linked package worktrees outside the main repository, preferably under
  `C:\Pantheon-worktrees\<package-id>`, and record their real paths in the
  progress and handoff state;
- before moving the main worktree, identify linked worktrees. Finish/remove them
  first where practical or repair their administrative links explicitly after
  the move; and
- after a move, reopen Codex, Claude Code, terminals, editors and browser tooling
  against the new root rather than continuing sessions that were bound to the
  former path.

Phase 0 must verify that tracked source is path-portable and identify any
untracked environment files, shortcuts, scheduled tasks or external tool
configuration that still references the former absolute path. No secret value
may be printed during that audit.

### 4.1 Deterministic control, probabilistic intelligence

LLMs decide, reason, draft, critique and recommend.

Deterministic code must control:

- identity;
- authority;
- budgets;
- data ownership;
- state transitions;
- idempotency;
- credentials;
- provider execution;
- approvals;
- accounting;
- evidence persistence;
- retries;
- rollback;
- scheduling; and
- commercial truth.

### 4.2 Provider independence and evidence-based selection

Agents request capabilities, not brands.

An agent should request:

- `generate_product_video`;
- `build_staging_website`;
- `collect_marketplace_comparators`;
- `create_checkout`;
- `send_transactional_email`; or
- `retrieve_accounting_transactions`.

It should not require provider-specific logic in its reasoning prompt.

Provider choice has two separate stages:

1. **Discovery and qualification.** Pantheon researches current candidates, evaluates integration quality, cost, legal and security terms, output quality, reliability and commercial fit, then produces a Provider Decision Record.
2. **Runtime routing.** Pantheon chooses only among providers already approved and active in its registry using deterministic policy plus measured performance.

The Business Systems Architect defines the required capability and performance envelope. A Capability Procurement Agent researches candidate providers. Neither may install an arbitrary MCP server, accept provider terms, expose credentials or activate live spend without the required authority.

Named services such as Higgsfield, Artlist, Webflow, Framer, Canva, Stripe, PostHog, Apify or DataForSEO are starting candidates only. Pantheon must remain able to prefer another provider when current evidence supports it.

### 4.3 Evidence before confidence

Pantheon must preserve the distinction between:

- observed fact;
- provider-reported event;
- estimate;
- assumption;
- model inference;
- human assertion;
- contradiction; and
- unknown.

Commercial conclusions must be traceable to evidence.

### 4.4 Autonomy is earned per capability

Autonomy is not a global switch.

A Research Agent may have broad standing authority while a Finance Agent remains approval-gated. A staging-site action may be autonomous while production publication requires owner approval.

### 4.5 Staging before production

Every externally visible asset or action that supports staging must first pass through a staging or sandbox state.

Examples include:

- Webflow staging before production publication;
- Stripe test mode before live mode;
- draft email before customer contact;
- ad preview before campaign launch;
- private/unlisted video before public publication; and
- dry-run accounting entries before external write.

### 4.6 All external side effects are idempotent

Every external action must use an idempotency key, provider event identifier or equivalent deduplication mechanism.

Retrying a timed-out request must not:

- charge twice;
- publish twice;
- email twice;
- create two listings;
- issue two refunds; or
- duplicate accounting entries.

### 4.7 The UI is the owner control plane

The owner interface is not cosmetic.

It is the primary mechanism for:

- understanding the business;
- supervising autonomy;
- approving decisions;
- diagnosing failures;
- comparing ventures;
- reviewing assets;
- controlling budgets; and
- trusting the system.

### 4.8 The runtime is independent of the UI

Closing the dashboard must not terminate business operations.

The control plane reads and commands the runtime. It does not own the runtime lifecycle.

### 4.9 Modular monolith before distributed system

Pantheon should remain a modular monolith while it is owner-operated on one machine and the first venture is being proven.

Modules must have explicit contracts and dependency rules so that later service extraction is possible.

### 4.10 Strangler migration, not big-bang refactoring

New modules are introduced behind stable facades.

Legacy paths remain until parity is verified. They are removed only after the new path passes the relevant tests and live rehearsal.

### 4.11 Commercial outcomes are first-class tests

Code tests prove software properties.

Commercial evidence proves business capability.

Pantheon requires both.

### 4.12 Plans cannot mutate silently

The Master Plan is stable.

Each phase receives an approved Phase Execution Pack.

Each work package has immutable scope once execution begins. Newly discovered work becomes a separate package or a documented blocker.

### 4.13 The repository is development memory

Conversations are temporary and non-authoritative.

Programme state, architectural decisions, current package scope, active handoff, verification evidence and blockers must live in the repository so that a fresh Codex or Claude Code session can reconstruct the work without reading the preceding conversation.

### 4.14 Dynamic discovery does not mean uncontrolled installation

Pantheon may autonomously research providers, compare them and recommend changes.

Pantheon may execute only through providers that are:

- qualified against a current capability requirement;
- approved into the provider registry;
- authenticated through an approved credential reference;
- constrained by declared scopes, budgets and risk policy;
- contract-tested; and
- observable and revocable.

A public MCP registry entry, package listing or marketing claim is not sufficient evidence of security or suitability.

---

## 5. Target architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                      OWNER CONTROL PLANE                            │
│ Portfolio | Ventures | Departments | Workflows | Decisions          │
│ Assets | Experiments | Finance | Brain | Integrations | Health      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ versioned commands, queries and events
┌──────────────────────────────▼──────────────────────────────────────┐
│                  PANTHEON APPLICATION FACADE                        │
│ Stable API | Authentication | Command validation | Event stream     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    VENTURE OPERATING SYSTEM                         │
│ Portfolio | Venture Kits | Operating Plans | Workflow DAG           │
│ Experiments | Commercial truth | Finance | Learning | Compliance    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     AGENT RUNTIME                                   │
│ Chief | Business Systems Architect | Specialist agents              │
│ Handoffs | Agents as tools | Sessions | Evals | HITL                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ capability requests
┌──────────────────────────────▼──────────────────────────────────────┐
│                     CAPABILITY FABRIC                               │
│ Registry | Router | Cost quotes | Risk | Auth refs | Health          │
│ Direct APIs | OpenAPI clients | MCP | Managed data | Browser fallback│
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│          APPROVED EXTERNAL PROVIDERS (examples only)               │
│ Models | Creative | Web | Payments | Analytics | Research           │
│ Marketplaces | Accounting | Email | Support | Distribution          │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.1 Owner Control Plane

Responsibilities:

- render portfolio and venture state;
- stream live execution events;
- expose decisions and approvals;
- preview and compare assets;
- show costs, revenue and commercial evidence;
- visualize agent teams and workflow graphs;
- display provider health;
- allow safe commands;
- separate Owner Mode from Developer Mode.

### 5.2 Application Facade

The facade is the stable boundary between the new UI and the existing backend.

It provides:

- versioned query endpoints;
- versioned command endpoints;
- event-stream endpoints;
- DTO validation;
- authorization;
- idempotency;
- compatibility mapping;
- no direct frontend database access.

### 5.3 Venture Operating System

This layer owns:

- portfolio and venture lifecycle;
- Venture Kits;
- Venture Operating Plans;
- workflow DAGs;
- experiments;
- commercial evidence;
- decisions;
- financial state;
- institutional learning;
- venture isolation.

### 5.4 Agent Runtime

Pantheon should continue to use the OpenAI Agents SDK for:

- agent loops;
- structured tools;
- handoffs;
- agents as tools;
- sessions;
- guardrails;
- human approval interruptions;
- resumable run state;
- tracing;
- MCP tool access.

Pantheon should not duplicate SDK functionality unless its business requirements genuinely require a stronger or more durable implementation.

### 5.5 Capability Fabric

The Capability Fabric owns all provider interactions.

It must normalize:

- authentication;
- provider selection;
- input and output schemas;
- cost and quota;
- retries;
- async job polling;
- webhooks;
- health;
- evidence;
- provenance;
- approval;
- quality evaluation;
- provider-specific error translation.

### 5.6 Evidence and Learning

This layer turns business activity into reusable knowledge.

It stores:

- hypotheses;
- actions;
- evidence;
- outcomes;
- diagnoses;
- lessons;
- confidence;
- applicability;
- contradiction;
- expiry or revalidation dates.

### 5.7 Trust, Finance and Compliance

This layer enforces:

- capability authority;
- spend mandates;
- approval thresholds;
- external-action policy;
- legal escalation;
- accounting event mapping;
- reconciliation;
- audit logs;
- credential boundaries;
- emergency stop.

---

## 6. Recommended technology stack

### 6.1 Backend and runtime

Retain:

- Node.js 24;
- npm;
- SQLite for the single-machine stage;
- the existing OpenAI Agents SDK TypeScript/JavaScript implementation;
- Zod for runtime contracts;
- the current recovery and local-security controls.

Adopt incrementally:

- TypeScript for all new and extracted production modules;
- explicit domain packages;
- a typed application facade;
- Server-Sent Events for one-way live event delivery;
- WebSockets only where genuine bidirectional streaming is required;
- an outbox/event-feed pattern for UI updates;
- generated API clients where a provider supplies OpenAPI;
- structured logging with correlation IDs;
- provider contract tests.

Do not migrate the whole repository to TypeScript in one operation.

### 6.2 Frontend

Build a separate frontend application using:

- Next.js App Router;
- React;
- TypeScript;
- Tailwind CSS;
- Motion for purposeful animation and layout transitions;
- React Flow for workflow, department and agent graphs;
- Radix primitives or shadcn/ui for accessible components;
- TanStack Query for server-state synchronization;
- a small local state layer such as Zustand only where necessary;
- Storybook for isolated component development;
- Playwright selectively for stable end-to-end journeys, CI smoke, screenshots and traces where durable regression value justifies it;
- a qualified product-analytics provider for owner-interface analytics, experiments and session replay, with PostHog as a bootstrap candidate.

The new frontend must coexist with the old cockpit until feature parity is proven.

### 6.3 Database

Continue with SQLite in WAL mode while:

- one owner operates the system;
- one runtime instance owns writes;
- venture concurrency is bounded;
- no remote multi-instance deployment is required.

Create a formal migration decision gate for PostgreSQL. Migrate only when at least one of these becomes true:

- multiple runtime instances must write concurrently;
- remote workers require reliable shared access;
- write contention is materially affecting operation;
- multi-user or multi-tenant access is introduced;
- backup and replication requirements exceed the current model.

### 6.4 Workflow engine

Retain Pantheon's workflow and task-claim machinery for v2.

Do not immediately add LangGraph, Trigger.dev, Temporal or another durable workflow engine.

The existing runtime should first be simplified into:

- a dependency-aware DAG;
- bounded worker pools;
- concurrency keys;
- durable claims;
- idempotent actions;
- resumable approvals.

Reconsider an external workflow engine only after persistent remote operation creates a verified need.

### 6.5 Deployment

Initial target:

- local desktop owner control plane;
- separate local runtime service;
- secure loopback communication;
- existing Windows credential protection;
- optional remote provider calls.

Later target:

- a persistent private service or small cloud deployment;
- remote owner access;
- managed database if required;
- encrypted secret manager;
- health monitoring and alerting.

---

## 7. Capability Fabric specification

### 7.1 Capability manifest

Each capability must declare:

```yaml
id: generate_marketing_video
category: creative.video
version: 1
description: Generate a marketing-ready video from an approved brief.
operations:
  - quote
  - execute
  - poll
  - cancel
  - retrieve
input_schema: creative_video_request_v1
output_schema: creative_video_result_v1
risk_tier: reversible_external_spend
default_autonomy_level: 2
supports:
  sandbox: true
  async_jobs: true
  idempotency: true
  webhook: false
quality_dimensions:
  - brand_alignment
  - visual_quality
  - product_fidelity
  - channel_fit
  - claim_safety
```

### 7.2 Provider manifest

Each provider adapter must declare:

- provider ID;
- capability IDs;
- authentication method;
- required scopes;
- test or sandbox mode;
- rate limits;
- cost model;
- timeout policy;
- retry policy;
- idempotency support;
- async job behavior;
- webhook verification;
- data retention assumptions;
- commercial-use restrictions;
- supported regions;
- provider terms review date;
- health check;
- adapter version;
- contract-test status.

### 7.3 Provider types

Use the following priority order:

1. official direct API or SDK;
2. official MCP server;
3. official OpenAPI-generated client;
4. approved managed structured-data provider;
5. browser automation where lawful and necessary;
6. manual owner step where no reliable integration exists.

Browser automation is a fallback, not the default integration strategy.

### 7.4 Invocation lifecycle

Every invocation follows:

1. capability request;
2. provider candidates;
3. health and eligibility check;
4. quote;
5. risk and authority check;
6. reservation of budget;
7. idempotency key creation;
8. execution;
9. polling or webhook completion;
10. normalized result;
11. schema validation;
12. provenance and evidence persistence;
13. quality evaluation;
14. actual cost reconciliation;
15. provider score update;
16. downstream workflow event.

### 7.5 Provider discovery and qualification

Provider selection begins from a capability requirement, not a preferred brand.

The qualification lifecycle is:

1. Business Systems Architect defines the capability requirement;
2. Capability Procurement Agent discovers current candidates using official documentation and current commercial information;
3. candidates are screened for interface availability, eligibility and obvious disqualifiers;
4. an evidence pack is created;
5. security, privacy, data handling, intellectual-property, commercial-use and jurisdictional issues are assessed;
6. integration feasibility is assessed across direct API, SDK, OpenAPI, MCP and browser fallback;
7. shortlisted providers are benchmarked on the same representative task where practical;
8. total cost, quality, latency, reliability and operational burden are compared;
9. a Provider Decision Record recommends approve, sandbox, defer or reject;
10. owner approval is obtained where credentials, terms, recurring subscriptions, live data or spend are involved;
11. an adapter is implemented and contract-tested;
12. the provider enters the approved registry with a review date and rollback path.

Provider states are:

```text
discovered → researched → shortlisted → sandboxed → qualified → approved → active
                                                          ↘ degraded → suspended → retired
```

Discovery may be autonomous. Installation, credential grant and activation remain controlled.

### 7.6 Runtime capability routing

Runtime routing operates only across approved active providers.

Provider selection should consider:

- capability fit and required output format;
- benchmark and live quality history;
- cost and remaining venture budget;
- latency and deadline;
- provider health and prior failure rate;
- quotas and regional availability;
- approved commercial and output rights;
- data sensitivity and provider retention policy;
- venture policy and channel requirements;
- reversibility and fallback availability;
- owner preferences and provider exclusions.

The first router should be deterministic and inspectable. Model-assisted recommendations may rank approved candidates, but deterministic policy enforces eligibility, authority, budget and data boundaries.

### 7.7 Bootstrap candidate catalogue

The following list accelerates Phase 4 research. It does not pre-approve or permanently select a provider.

| Capability class | Bootstrap candidates to investigate | Likely integration forms |
|---|---|---|
| Agent reasoning and hosted tools | OpenAI and other approved model providers | Direct SDK / API |
| Broad grounded research | OpenAI web search, structured-data providers and approved browser research | Hosted tool / API |
| Structured extraction and market data | Apify, DataForSEO, official marketplace APIs, other qualified providers | API / MCP |
| Creative image and video | Higgsfield, Artlist, direct model APIs, other current creative platforms | MCP / API / approved browser workflow |
| Brand-template production | Canva, deterministic local templates, other qualified design platforms | Connect API / MCP / export workflow |
| Website design and staging | Webflow, Framer, a curated Next.js component system, other qualified builders | MCP / API / code generation |
| Checkout and payments | Stripe, marketplace-native payment rails, other qualified processors | Direct API / verified webhooks |
| Product analytics | PostHog and other qualified analytics platforms | SDK / API |
| Accounting | Xero and other relevant accounting systems | Direct API / controlled import |
| Customer communication | approved email and support providers | Direct API / controlled outbox |
| Publishing and distribution | official platform APIs or approved aggregators | Direct API / approval-gated browser fallback |

A single provider may be selected initially to close the commercial loop, but the architecture must retain capability-level abstraction and an explicit replacement path.

### 7.8 Integration priorities

**Priority A: capability classes required for the first commercial loop**

- agent reasoning and research;
- website design and staging;
- checkout and verified payment events;
- product analytics and attribution;
- creative image/video production;
- transactional fulfilment and customer communication;
- one structured research or market-data source;
- interactive browser inspection of the complete journey.

**Priority B: provider depth and product quality**

- brand-template production;
- additional structured-data providers;
- marketplace APIs;
- accounting read/synchronization;
- additional creative and website providers;
- customer-support tooling.

**Priority C: scale and channel expansion**

- social publishing;
- advertising platforms;
- additional commerce channels;
- advanced finance and accounting writes;
- provider auto-switching within approved policy;
- recurring provider requalification.

---

## 8. Agent operating model

### 8.1 No conversational swarm

Pantheon should not create a group chat in which many agents continuously talk to one another.

Use:

- deterministic workflow state;
- structured task inputs;
- structured task outputs;
- manager-style delegation;
- handoffs where specialist ownership genuinely changes;
- agents-as-tools for bounded specialist work;
- event-driven progression.

### 8.2 Dynamic venture team

The agent registry contains available roles, but a venture activates only the roles it needs.

Core roles:

- Portfolio Governor;
- Venture Chief or CEO;
- Business Systems Architect;
- Opportunity Scout;
- Market Intelligence Analyst;
- Demand Validator;
- Offer Strategist;
- Product Lead;
- Creative Director;
- Web Experience Builder;
- Growth and Distribution Lead;
- Customer Operations Lead;
- Finance Controller;
- Legal and Compliance Reviewer;
- Quality and Red Team Reviewer;
- Engineering and Reliability Agent.

A simple digital product should not invoke every role for every task.

### 8.3 Agent contract

Every agent definition must include:

- mission;
- decisions owned;
- decisions excluded;
- tools and capabilities;
- required context;
- expected output schema;
- quality rubric;
- evidence requirements;
- escalation conditions;
- cost ceiling;
- turn and tool-call limits;
- supported Venture Kits;
- eval suite;
- autonomy level.

### 8.4 Business Systems Architect

This is a critical v2 role.

Input:

- opportunity;
- Venture Kit;
- available capabilities;
- budget;
- owner mandate;
- jurisdiction;
- risk profile;
- prior institutional learning.

Output:

- Venture Operating Plan;
- proposed team;
- workflow DAG;
- experiments;
- capability requirements;
- metrics;
- accounting event map;
- compliance obligations;
- approval points;
- kill and scale conditions.

The Business Systems Architect proposes the process. Pantheon does not force a generic human SOP onto every venture.

### 8.5 Capability Procurement Agent

This role prevents Pantheon from treating the owner's current awareness or an earlier plan as the complete provider market.

Input:

- capability requirement;
- required integration method and authority level;
- venture budget and jurisdiction;
- data sensitivity;
- quality rubric;
- expected volume and deadline;
- approved provider exclusions;
- current provider performance.

Output:

- current candidate shortlist;
- official-source evidence pack;
- API, SDK, MCP and browser-automation feasibility;
- pricing and total-cost comparison;
- security, privacy, rights and terms assessment;
- standardized benchmark plan and results where practical;
- integration and maintenance estimate;
- Provider Decision Record;
- re-evaluation date.

The role may recommend a new provider. It cannot install it, grant credentials, accept terms or activate live authority by itself.

### 8.6 Agent evals

Each agent must have:

- contract tests;
- adversarial cases;
- missing-evidence cases;
- tool-selection cases;
- forbidden-action cases;
- approval cases;
- cost cases;
- regression cases from actual failures.

Evaluate behavior and evidence, not exact prose.

---

## 9. Venture Kit v2

### 9.1 Purpose

A Venture Kit is domain intelligence and operating constraints.

It is not a fixed workflow.

### 9.2 Required contents

Each Venture Kit must define:

- supported business models;
- buyer types;
- value-delivery patterns;
- common offer structures;
- unit economics;
- customer journey;
- acquisition channels;
- platform requirements;
- product or service delivery patterns;
- customer-support patterns;
- accounting event map;
- legal and regulatory obligation categories;
- tax and jurisdiction escalation;
- risk patterns;
- quality rubrics;
- core metrics;
- common failure modes;
- evidence requirements;
- capability requirements;
- reusable templates;
- known anti-patterns;
- lifecycle gates.

### 9.3 Venture Operating Plan

A Venture Operating Plan is generated for one opportunity.

It includes:

```yaml
venture_id: venture_...
kit_id: digital_product_v2
opportunity_id: opportunity_...
version: 1
objective: ...
buyer: ...
problem: ...
offer: ...
customer_journey: ...
team: ...
workflow_graph: ...
capabilities: ...
experiments: ...
metrics: ...
budget: ...
accounting_map: ...
compliance_map: ...
approval_points: ...
kill_conditions: ...
scale_conditions: ...
```

The plan is versioned.

Material changes require a new plan version and an explicit decision.

### 9.4 Workflow graph

Every workflow node declares:

- node ID;
- objective;
- responsible agent;
- dependencies;
- input contract;
- output contract;
- capabilities;
- authority;
- budget;
- timeout;
- retry policy;
- idempotency scope;
- quality gate;
- failure route;
- human approval route;
- completion evidence.

The executor must support parallel branches even when the initial venture concurrency limit is one.

---

## 10. Earned autonomy framework

### 10.1 Autonomy levels

| Level | Meaning |
|---|---|
| 0 | Observe only. No recommendations or actions. |
| 1 | Analyse and recommend. Human performs the action. |
| 2 | Draft or prepare in sandbox/staging. Human approves external action. |
| 3 | Execute low-risk, reversible actions within standing limits. |
| 4 | Operate a capability autonomously within an approved mandate and budget. |
| 5 | Make portfolio-level decisions within capital and policy limits. |

### 10.2 Initial posture

Recommended initial posture:

| Capability class | Initial level |
|---|---:|
| Local read-only analysis | 3 |
| Local file creation in venture workspace | 3 |
| Public read-only research within cost cap | 3 |
| Internal model generation within cost cap | 3 |
| Creative generation within approved brief and cap | 2 or 3 |
| Staging website changes | 3 |
| Production publication | 2 |
| Customer contact | 2 |
| Refunds and payment actions | 1 or 2 |
| Paid advertising | 1 or 2 |
| External accounting writes | 1 or 2 |
| Legal conclusions | 1 |
| Large or unusual spend | mandatory owner approval |
| Core source-code modification | proposal and PR only |

### 10.3 Autonomy promotion

A capability earns promotion using evidence such as:

- eval pass rate;
- production success rate;
- human override rate;
- quality acceptance rate;
- rollback rate;
- cost accuracy;
- policy compliance;
- incident rate;
- commercial outcome;
- number of successful supervised runs.

Promotion is explicit and reversible.

### 10.4 Creative autonomy

Visual quality requires a stricter progression.

Initially:

1. agent creates brief;
2. provider creates assets;
3. automated visual QA scores them;
4. Pantheon presents a comparison board;
5. owner approves or rejects;
6. decision and reason become training evidence.

Pantheon may later auto-approve only asset classes with sufficient evidence.

---

## 11. Institutional learning

### 11.1 Learning record

Every meaningful experiment produces:

```yaml
hypothesis: ...
context: ...
action: ...
evidence: ...
outcome: ...
diagnosis: ...
lesson: ...
confidence: ...
applicability: ...
contrary_evidence: ...
revalidation_date: ...
```

### 11.2 Memory layers

Use separate layers:

- **Run memory:** current agent execution.
- **Workflow memory:** one operating plan and its tasks.
- **Venture memory:** customers, experiments, assets, decisions and economics.
- **Venture Kit knowledge:** domain-specific general lessons.
- **Institutional memory:** cross-venture learning.
- **Owner policy:** stable owner preferences and mandates.

Do not blend all history into one vector store.

### 11.3 Learning promotion

A model-generated lesson begins as provisional.

It becomes institutional knowledge only after:

- evidence exists;
- contradictory evidence is retained;
- applicability is stated;
- confidence is assigned;
- a review or repeated result supports promotion.

### 11.4 Self-improvement

Pantheon may autonomously modify:

- prompts;
- workflow proposals;
- provider selection;
- templates;
- thresholds within delegated bounds;
- experiment strategy;
- knowledge records;
- model routing;
- capability preferences.

Pantheon must not autonomously merge changes to its core runtime.

An Engineering Agent may:

1. diagnose a recurring limitation;
2. create an issue;
3. propose a bounded change;
4. implement it in a worktree;
5. run tests and evals;
6. request independent review;
7. open a draft PR;
8. wait for approval.

---

## 12. Owner Control Plane specification

### 12.1 Visual direction

The interface should be:

- elegant;
- minimal;
- fluid;
- information-dense without being cluttered;
- responsive;
- keyboard accessible;
- visually consistent;
- animated with purpose;
- understandable without technical knowledge.

Do not clone FounderOS code or branding.

Use its successful interaction concepts as design references:

- cinematic but restrained transitions;
- living status indicators;
- clear hierarchy;
- glass and depth used sparingly;
- interactive node graphs;
- contextual panels;
- command palette;
- progressive disclosure.

### 12.2 Owner Mode and Developer Mode

**Owner Mode** shows:

- business state;
- decisions;
- risks;
- money;
- customer evidence;
- experiments;
- assets;
- agent activity;
- next actions.

**Developer Mode** shows:

- task IDs;
- traces;
- provider payload summaries;
- hashes;
- schema versions;
- retries;
- stack traces;
- low-level health;
- recovery controls.

Technical details must not dominate Owner Mode.

### 12.3 Core screens

#### Portfolio Command Center

Show:

- active ventures;
- venture stage;
- capital deployed;
- revenue;
- contribution;
- current experiments;
- decisions required;
- major risks;
- system health;
- recent learning;
- opportunity pipeline.

#### Venture Room

Show:

- venture objective;
- buyer and offer;
- operating plan;
- team;
- current phase;
- commercial metrics;
- experiments;
- assets;
- customer signals;
- costs;
- next decision;
- kill/scale conditions.

#### Department and Agent View

Show:

- active departments;
- responsible agents;
- task status;
- workload;
- handoffs;
- blockers;
- recent output;
- cost;
- quality score;
- autonomy level.

#### Workflow Graph

Use an interactive graph to show:

- dependencies;
- active nodes;
- parallel branches;
- completed nodes;
- approvals;
- failed nodes;
- retries;
- evidence;
- cost;
- timeline.

#### Live Activity

Stream:

- agent started;
- tool selected;
- provider called;
- quote reserved;
- asset generated;
- QA result;
- decision requested;
- task completed;
- customer event;
- payment event;
- experiment updated;
- lesson created.

#### Decision Inbox

Every decision card must show:

- decision;
- recommendation;
- options;
- reason;
- evidence;
- risk;
- cost;
- reversibility;
- deadline;
- affected venture;
- exact action that approval authorizes.

#### Asset Studio

Show:

- product files;
- images;
- videos;
- landing pages;
- ad variants;
- versions;
- visual QA;
- side-by-side comparisons;
- owner feedback;
- publication status.

#### Experiment Lab

Show:

- hypothesis;
- audience;
- channel;
- offer;
- metric;
- budget;
- evidence;
- results;
- diagnosis;
- next action.

#### Brain and Knowledge

Show:

- venture knowledge;
- institutional lessons;
- contradictions;
- confidence;
- evidence lineage;
- applicability;
- revalidation status.

#### Finance

Show:

- cash events;
- revenue;
- fees;
- refunds;
- provider spend;
- contribution;
- budget utilization;
- reconciliation state;
- attribution confidence.

#### Integrations

Show:

- provider;
- connection state;
- capabilities;
- scopes;
- mode;
- cost;
- health;
- rate limits;
- last successful call;
- test action;
- autonomy level.

#### System Health

Show:

- runtime;
- scheduler;
- worker pool;
- database;
- backups;
- provider incidents;
- stalled work;
- retry queues;
- emergency stop.

### 12.4 Design system

Build the design system before feature pages.

It must include:

- typography scale;
- spacing;
- color tokens;
- status semantics;
- surfaces and elevation;
- motion tokens;
- icons;
- cards;
- tables;
- graphs;
- timelines;
- command palette;
- decision components;
- empty/loading/error states;
- accessibility states;
- responsive behavior.

Every component has Storybook stories for normal, loading, empty, error, blocked and approval states where applicable.

### 12.5 Visual quality and browser-verification gate

Source code, unit tests and static snapshots do not prove that an owner-facing interface is good.

For every material UI change, the coding agent must:

1. run the actual application;
2. open the affected experience through Codex's native browser, connected Chrome, Claude's supported browser/computer-use path, or another approved interactive browser;
3. inspect the rendered result rather than inferring appearance from code;
4. exercise the affected user journey;
5. inspect console and network state where relevant;
6. check desktop, laptop and relevant responsive widths;
7. critique hierarchy, spacing, readability, motion, density, loading, empty, error, blocked and approval states;
8. correct visible defects before declaring completion;
9. capture evidence for the package.

Use Playwright selectively when repeatable automated browser protection justifies its maintenance cost, including:

- stable critical owner journeys;
- checkout, approval, publication, fulfilment or recovery flows;
- browser regressions that have already occurred;
- CI smoke tests;
- repeatable cross-browser or viewport assertions.

Do **not** create or run Playwright merely to satisfy a generic UI checkbox, and do not encode subjective aesthetics as brittle pixel-perfect tests unless a specific visual contract requires it.

Every major screen must ultimately pass:

- interactive browser inspection;
- responsive checks;
- accessibility checks;
- no material console errors;
- no unintended overflow;
- consistent spacing and hierarchy;
- reduced-motion behaviour;
- owner approval against the design rubric;
- selective automated regression for critical stable flows.

---

## 13. Commercial operating loop

The target end-to-end loop is:

```text
Opportunity discovery
  ↓
Evidence and disconfirmation
  ↓
Opportunity decision
  ↓
Venture Kit selection
  ↓
Venture Operating Plan
  ↓
Team and capability assembly
  ↓
Demand experiment
  ↓
Offer and product
  ↓
Brand, creative and staging website
  ↓
QA and compliance review
  ↓
Owner publication approval
  ↓
Traffic and distribution
  ↓
Checkout and transaction
  ↓
Fulfilment and support
  ↓
Analytics and accounting reconciliation
  ↓
Diagnosis and institutional learning
  ↓
Scale, revise, pause or kill
```

### 13.1 First commercial capability stack

The first commercial loop requires one approved implementation for each critical capability class. Provider selection occurs through the Phase 4 qualification process rather than by permanent hardcoding.

The initial owned funnel should include:

- a qualified website design and staging provider;
- a qualified checkout and payment provider with verified event ingestion;
- a qualified product analytics provider;
- transactional fulfilment and customer communication;
- a qualified creative-media provider or provider set;
- interactive browser inspection of the complete journey;
- selective Playwright coverage for stable critical flows.

Webflow, Stripe, PostHog, Higgsfield, Artlist, Canva, Framer and similar services are bootstrap candidates. Phase 4 decision records determine which are actually integrated first.

This gives Pantheon direct control over:

- presentation;
- checkout;
- attribution;
- customer journey;
- analytics;
- fulfilment;
- commercial evidence.

Marketplace channels can be added after the owned funnel or selected earlier when the opportunity evidence shows that a marketplace is materially superior.

### 13.2 First pilot constraints

The first live pilot should be:

- low regulatory risk;
- low refund risk;
- digitally fulfilled;
- inexpensive to test;
- easy to revise;
- aimed at a clearly identifiable buyer;
- supported by accessible traffic channels;
- capable of producing observable demand evidence quickly;
- not dependent on Amazon Creators API eligibility;
- not dependent on a large paid-ad budget.

### 13.3 Failure handling

If an offer fails:

1. confirm data quality;
2. distinguish traffic failure from offer failure;
3. inspect creative and conversion;
4. inspect price and buyer fit;
5. preserve contrary evidence;
6. record lesson and confidence;
7. revise only one major hypothesis where possible;
8. rerun or kill;
9. select the next opportunity if the economics no longer justify continuation.

---

## 14. Testing, evaluation and proof

### 14.1 Test tiers

| Tier | Purpose | When |
|---|---|---|
| T0 | syntax, type, lint and changed-file checks | continuously |
| T1 | targeted unit and contract tests | during implementation |
| T2 | domain integration tests | work-package completion |
| T3 | interactive browser verification, selected E2E journeys and provider sandbox tests | work-package or phase gate as specified |
| T4 | full repository regression suite | phase gate or nightly |
| T5 | live commercial proof | controlled pilot |

Codex must not repeatedly run T4 while still making a small local change.

### 14.2 Agent evaluation

Agent evals must exercise the real agent path and assess:

- output contract;
- evidence;
- tool calls;
- handoffs;
- approval behavior;
- state updates;
- prohibited actions;
- spend limits;
- escalation;
- uncertainty;
- trace and cost records.

### 14.3 Provider contract tests

Every provider adapter requires:

- authentication readiness test;
- sandbox or dry-run test;
- schema test;
- idempotency test where relevant;
- timeout classification;
- rate-limit classification;
- retry test;
- webhook verification test;
- cost reconciliation test;
- redaction test;
- health-check test.

### 14.4 Commercial proof

Commercial proof must distinguish:

- test-mode events;
- owner-created events;
- internal team events;
- external prospective customers;
- independent paying customers;
- attributed revenue;
- unattributed revenue;
- refunds;
- fees;
- provider spend;
- contribution margin.

No generated or manually inserted test data may count toward viability.

---

## 15. Coding-agent engineering operating system

Pantheon v2.1.1 must be developable by fresh sessions and more than one coding agent without losing architectural continuity.

Codex is the primary implementation agent. Claude Code is the continuity, secondary implementation and independent-review agent. Either may complete an approved package, but both must follow the same repository-owned contract.

### 15.1 Three planning levels

#### Level 1: Master Plan

This document is the stable programme contract.

It changes only through:

- a documented reason;
- an Architecture Decision Record;
- owner approval;
- a version increment.

#### Level 2: Phase Execution Pack

Before a phase begins, a fresh planning session performs a read-only audit and creates an execution pack containing:

- current baseline;
- phase objective;
- dependencies;
- architecture decisions;
- work packages;
- acceptance matrix;
- session map;
- cross-agent handoff expectations;
- provider assumptions requiring qualification;
- risk register;
- rollback strategy;
- phase gate.

The pack should normally contain 5 to 8 coherent work packages. It is approved before coding begins.

#### Level 3: Work Package

A work package is the unit of implementation and goal execution.

It must be:

- one coherent objective;
- bounded;
- independently verifiable;
- smaller than a phase;
- large enough to produce useful progress;
- prohibited from silently absorbing unrelated fixes;
- suitable for one fresh coding-agent session by default.

### 15.2 Required repository files

```text
AGENTS.md
CLAUDE.md
docs/v2/
  PANTHEON_V2_MASTER_PLAN.md
  ENGINEERING_PROTOCOL.md
  SESSION_PROTOCOL.md
  PROVIDER_DISCOVERY_AND_QUALIFICATION.md
  PROGRESS.json
  BLOCKERS.md
  ACTIVE_HANDOFF.md
  REFERENCES.md
  decisions/
  phases/
  work-packages/
  evidence/
  prompts/
  templates/
.agents/skills/
  pantheon-work-package-executor/
  pantheon-provider-discovery/
  pantheon-provider-integration/
  pantheon-agent-workflow/
  pantheon-ui-visual-qa/
  pantheon-domain-refactor/
  pantheon-commercial-proof/
.claude/skills/
  [matching Pantheon skills]
.codex/
  [existing configuration, merged rather than overwritten]
.claude/
  [existing settings and hooks, merged rather than overwritten]
scripts/v2/
  status.js
  verify-work-package.js
  verify-agent-instructions.js
  record-handoff.js
```

`AGENTS.md` contains concise shared project instructions. `CLAUDE.md` imports `AGENTS.md` and adds only Claude-specific behaviour. Detailed procedures remain in `docs/v2/` or focused skills so that every session does not begin with an oversized instruction payload.

### 15.3 Session model

Use the following default session boundaries:

- one fresh phase-planning session to create or amend the Phase Execution Pack;
- one fresh implementation session per work package;
- the same session may continue while fixing local issues within that package;
- one fresh independent phase-gate review session;
- a new receiving-agent session for a Codex-to-Claude or Claude-to-Codex handoff.

Start a new session when:

- the current package is complete;
- the objective changes;
- a phase plan or phase review is complete;
- responsibility moves to another coding agent;
- earlier discussion has been superseded by repository state;
- a plan amendment creates materially new scope.

Do not start a new session merely because a package uncovers a local bug that remains within scope.

At the end of every session, the agent must state exactly one owner instruction:

- `PACKAGE COMPLETE: START A NEW SESSION FOR [NEXT-ID]`;
- `PACKAGE IN PROGRESS: CONTINUE THIS SESSION`;
- `HANDOFF READY: OPEN THE SAME WORKTREE IN [CODEX/CLAUDE]`;
- `BLOCKED: OWNER ACTION REQUIRED`.

### 15.4 Active handoff state

`docs/v2/ACTIVE_HANDOFF.md` is maintained while a package is in progress.

Update it:

- after each completed acceptance criterion;
- after a verified architectural decision;
- when the working hypothesis changes;
- before a long-running test or provider operation;
- before an expected model handoff;
- before stopping with incomplete work.

It records completed work, remaining criteria, current files, uncommitted changes, tests, failures, decisions, risks and the next exact action.

This makes an abrupt usage limit survivable even when the outgoing model cannot produce a final conversational summary.

### 15.5 Cross-model handoff protocol

Codex and Claude Code work sequentially in the same package worktree. They must never edit the same worktree concurrently.

The receiving agent must begin in reconciliation mode:

1. read `AGENTS.md` and, for Claude, `CLAUDE.md`;
2. read the Master Plan, current phase pack, work package, progress, blockers and active handoff;
3. inspect `git status`, `git diff`, recent commits and relevant tests;
4. determine what is complete against acceptance criteria;
5. preserve valid existing work;
6. correct only what is required by the package;
7. continue the same objective;
8. update shared records before stopping.

The receiving agent completes the work-package contract, not the previous model's presumed intention.

Claude's auto memory and either model's conversation history are useful hints only. Repository files and current code are authoritative.

### 15.6 Work-package specification

Every work package must state:

- ID and title;
- objective and business reason;
- session type;
- preferred primary agent and permitted handoff;
- prerequisites;
- in scope and out of scope;
- files or domains likely affected;
- required reading;
- implementation constraints;
- acceptance criteria;
- exact verification commands;
- interactive browser requirement, if any;
- Playwright requirement only where justified;
- required artifacts;
- checkpoint and commit policy;
- rollback;
- stop conditions;
- expected progress and handoff updates;
- whether a push or PR is permitted.

### 15.7 Goal usage

Use goal mode for one approved work package, not the entire Master Plan and not an open-ended phase.

Codex uses the work-package prompt under `docs/v2/prompts/`.

Claude Code may use its goal capability where available or the equivalent explicit package prompt. A Claude session that is taking over Codex work must use the handoff-continuation prompt rather than resuming a prior unrelated Claude conversation.

### 15.8 Worktrees

Use one Git worktree per active work package where practical.

Rules:

- one work package per worktree;
- no overlapping write scope across worktrees;
- one writing agent owns a package worktree at a time;
- read-only exploration may run in parallel;
- no package begins from a failing or unknown baseline;
- the package branch remains available to either coding agent;
- owner review occurs only after required verification.

### 15.9 Subagents

Use read-only or isolated subagents for:

- repository exploration;
- dependency mapping;
- test-impact analysis;
- log analysis;
- current provider-document review;
- security review;
- visual screenshot critique;
- independent acceptance review.

Avoid parallel write-heavy implementation in the same domain.

The main session owns requirements, decisions, implementation direction, final diff and repository records.

### 15.10 Git policy

Coding agents must not spend a session performing repetitive Git administration.

Default policy:

- no commit for every small edit;
- commit only coherent verified checkpoints or package completion;
- a verified checkpoint commit is permitted when a cross-model handoff or risky migration makes it valuable;
- no push until package acceptance tests pass unless an explicit recovery workflow requires it;
- batch low-risk packages into a phase PR where sensible;
- use separate PRs for high-risk integrations, migrations or security changes;
- do not rewrite history automatically;
- do not merge without owner approval;
- do not conduct a full repository review after every small package.

### 15.11 Failure classification

When a test or operation fails, classify it:

- **A: introduced regression.** Fix within the package.
- **B: pre-existing failure in the touched domain.** Fix only if necessary for the package; otherwise record a blocker.
- **C: unrelated pre-existing failure.** Record and continue targeted verification.
- **D: environment, credential or provider failure.** Produce a precise setup or retry requirement.
- **E: plan deficiency.** Pause and request a phase-pack amendment.
- **F: handoff uncertainty.** Reconstruct state from code, diff, package and evidence before changing anything.

Agents must not follow every failure into an unlimited repair chain.

### 15.12 Completion record

At the end of every completed package, create a durable completion record containing:

- package ID and status;
- summary and business result;
- files changed;
- acceptance criteria;
- commands run and results;
- browser evidence and selective E2E evidence where relevant;
- unresolved blockers;
- architectural decisions;
- commits;
- next ready package;
- Git status;
- whether a push occurred.

Archive it under `docs/v2/evidence/packages/[ID]/COMPLETION.md` and update `PROGRESS.json`.

### 15.13 Test and browser policy

During implementation:

- run T0 and targeted T1;
- run only relevant domain tests;
- use the interactive browser for material UI changes;
- avoid full-suite reruns after every edit;
- do not add Playwright unless the package names a stable flow or explains why durable automation is valuable.

At work-package completion:

- run T0, T1 and required T2;
- complete specified interactive browser verification;
- run only specified E2E tests.

At phase gate:

- run T3 and T4;
- capture artifacts;
- perform independent review in a fresh session.

### 15.14 Module-size and dependency rules

For new production code:

- target under 400 lines per module;
- require explicit justification above 800 lines;
- keep public interfaces small;
- prevent raw database access across domain boundaries;
- prevent frontend imports from runtime internals;
- avoid circular dependencies;
- use typed contracts;
- use facades for legacy modules.

These are guidance limits, not arbitrary refactor targets.

---

## 16. Recommended coding-agent skills

Do not install dozens of broad skills.

Use a small set of repository-scoped skills with matching Codex and Claude Code versions. The skill bodies must remain materially identical and be verified for drift.

### 16.1 `pantheon-work-package-executor`

Use when implementing, continuing, verifying or completing an approved v2 work package.

It enforces required reading, scope, active handoff maintenance, targeted tests, blocker classification, completion evidence, session outcome and no automatic next-package work.

### 16.2 `pantheon-provider-discovery`

Use before selecting or replacing an external provider.

It requires:

- a provider-neutral capability requirement;
- current official documentation and commercial information;
- a meaningful shortlist where alternatives exist;
- API, SDK, OpenAPI, MCP and browser-feasibility assessment;
- security, privacy, rights, terms and jurisdiction review;
- standardized benchmark design;
- total-cost and maintenance analysis;
- Provider Decision Record;
- no installation or credential grant during discovery.

### 16.3 `pantheon-provider-integration`

Use after a provider has been approved for sandbox implementation.

It requires provider and capability manifests, least-privilege authentication, sandbox support, idempotency, async completion, webhook verification, cost and quota handling, redaction, normalized errors, contract tests, observability and rollback.

### 16.4 `pantheon-agent-workflow`

Use when creating or changing agents, handoffs, tools, sessions, workflow nodes or evals.

It requires an agent contract, structured schemas, deterministic boundaries, approval behaviour, cost ceiling, meaningful eval matrix and real execution-path tests.

### 16.5 `pantheon-ui-visual-qa`

Use for the Owner Control Plane and any owner-facing visual change.

It requires:

- design-system reuse;
- running-app inspection through an interactive browser;
- user-journey exercise;
- console and network inspection where relevant;
- responsive and accessibility checks;
- visual critique and iteration;
- Storybook states where useful;
- Playwright only for stable critical flows where regression value justifies maintenance;
- owner-facing language and no developer-only leakage.

### 16.6 `pantheon-domain-refactor`

Use when extracting code from large legacy modules.

It requires characterization tests, facade first, no behaviour change, small extraction scope, dependency direction, parity verification and deferred legacy deletion.

### 16.7 `pantheon-commercial-proof`

Use when running or changing live commercial experiments.

It requires clean-slate evidence, real-vs-test classification, external customer independence, cost and revenue reconciliation, attribution, outcome diagnosis, lesson creation and no false success.

### 16.8 External skills and tools

External coding-agent skills may assist with official SDKs and providers, but they do not pre-approve those providers or replace Pantheon adapters.

Use current official documentation at implementation time. Treat third-party skills, packages and MCP servers as untrusted until reviewed. Public registry presence is discovery evidence only, not a security certification.

---

## 17. Coding-agent hooks and enforcement

Instructions guide model behaviour. Hooks and permissions enforce selected boundaries.

Hooks should remain simple, auditable and symmetrical where Codex and Claude Code support equivalent lifecycle points.

Recommended functions:

### Session start

- identify repository root;
- identify current phase and package;
- show baseline and active handoff;
- warn if the session has no approved package;
- avoid injecting the entire Master Plan into context when a concise pointer is sufficient.

### Before dangerous tools or shell commands

Block or require review for:

- destructive Git commands;
- deleting runtime or evidence data;
- editing credential files;
- unapproved dependency installation;
- unapproved MCP server installation;
- live provider actions;
- migration against the owner database;
- mass formatting outside package scope.

### After tests and browser verification

- record command, result and evidence path;
- avoid automatic full-suite repetition;
- update the active handoff after a meaningful checkpoint.

### Stop

Verify or remind the agent to state:

- package status;
- progress and handoff state;
- evidence and blockers;
- Git status;
- exact owner instruction for the next session.

Do not make hooks so complex that they become another Pantheon subsystem. Phase 0 must inspect current Codex and Claude Code configuration before installing enforcement.

---

## 18. Phase roadmap

## Phase 0: Install the v2 engineering operating system

### Objective

Make the roadmap executable by Codex without changing Pantheon business behavior.

### Deliverables

- v2 documents installed;
- stable progress ledger;
- work-package templates;
- concise shared `AGENTS.md` plus `CLAUDE.md` import and model-specific additions;
- repository-owned session and cross-model handoff protocol;
- matching repository-scoped Codex and Claude Code skills;
- targeted verification commands;
- simple hooks;
- baseline proof;
- first Phase Execution Pack.

### Recommended initial work packages

#### P0-W01: Establish the immutable baseline

- capture current commit, Git root, local canonical path and working state;
- verify `C:\Pantheon` is the active master-worktree path and record the current remote identity;
- inspect linked worktrees and stale old-path references without printing secrets;
- run current supported baseline checks;
- record test counts and known failures;
- inventory giant modules and domain boundaries;
- record current provider and credential readiness;
- produce no behavior change.

#### P0-W02: Install v2 planning and progress files

- add Master Plan;
- add progress schema and progress file;
- add blocker register;
- add ADR directory;
- add phase and work-package templates;
- add status script.

#### P0-W03: Install cross-agent instructions and skills

- merge the proposed root `AGENTS.md` safely with any existing instructions;
- create `CLAUDE.md` importing `AGENTS.md` plus concise Claude-specific rules;
- add matching Pantheon skills for Codex and Claude Code;
- add session, handoff and completion templates;
- verify instruction and skill discovery in both tools;
- verify no instruction file exceeds practical context limits.

#### P0-W04: Implement targeted verification, session state and safe hooks

- classify test tiers;
- create package verification script;
- create and verify active handoff tooling;
- add simple safe hooks after inspecting existing Codex and Claude configuration;
- prevent accidental full-suite loops, destructive commands and unapproved integrations;
- verify browser-QA and Playwright-selection policy;
- verify hook trust and behaviour.

#### P0-W05: Create and approve Phase 1 Execution Pack

- perform a read-only source audit;
- define the stable application-facade migration;
- produce work packages and acceptance matrix;
- stop before Phase 1 coding.

### Exit gate

- Codex and Claude Code can identify the current package without conversation memory;
- each package has exact proof commands and a session outcome;
- progress and active handoff survive a fresh session or cross-model transfer;
- no Pantheon business behavior has changed;
- the repository remains portable and no unresolved former-path dependency exists;
- the owner approves the Phase 1 Execution Pack.

---

## Phase 1: Stable application facade and live event stream

### Objective

Create a stable boundary so the new UI and future modules do not depend directly on giant legacy files or raw database tables.

### Required outcomes

- shared TypeScript contracts;
- versioned query interface;
- versioned command interface;
- idempotent command envelope;
- normalized event envelope;
- Server-Sent Event stream;
- replay or cursor support;
- compatibility adapter for the old UI;
- correlation IDs across commands, tasks, agents, providers and events.

### Exit gate

- the new frontend can read current Pantheon state without direct DB access;
- a test command can produce a live event visible to a subscriber;
- command duplication is safely handled;
- old cockpit still functions;
- contract and integration tests pass.

---

## Phase 2: Owner Control Plane v2

### Objective

Give Daniel a beautiful, dynamic and understandable real-time interface before deeper backend work continues.

### Required outcomes

- Next.js application;
- Pantheon design system;
- Storybook;
- shell, navigation and command palette;
- Portfolio Command Center;
- Venture Room;
- workflow and agent graph;
- live activity stream;
- Decision Inbox;
- Asset Studio;
- Experiment Lab;
- Brain;
- Finance;
- Integrations;
- System Health;
- Owner Mode and Developer Mode;
- responsive and accessible behavior;
- selective visual/E2E regression suite for stable critical journeys.

### Implementation rule

Use real backend contracts with fixture fallbacks for hard-to-reproduce states.

Do not let fixture data be mistaken for live commercial truth.

### Exit gate

- all current Pantheon state can be understood through the new interface;
- live task and agent events appear without manual refresh;
- the owner approves the visual direction;
- major screens pass interactive browser review and specified Storybook/Playwright checks;
- old cockpit remains available as rollback.

---

## Phase 3: Modular monolith refactor

### Objective

Reduce Codex failure risk and make the codebase understandable without changing commercial behavior.

### Domains to extract

- contracts and events;
- ventures and portfolio;
- workflows and task claims;
- agents and executions;
- capabilities and providers;
- approvals and authority;
- experiments and commercial results;
- finance and accounting;
- evidence and learning;
- monitoring and recovery;
- application facade.

### Method

- characterize current behavior;
- introduce facade;
- extract one domain slice;
- route legacy callers through facade;
- verify parity;
- repeat;
- delete dead legacy code only after parity.

### Exit gate

- no new giant modules;
- clear domain dependency map;
- raw DB access constrained to repositories;
- new code in TypeScript;
- key legacy modules materially reduced;
- full regression suite passes.

---

## Phase 4: Capability Fabric

### Objective

Make external capabilities provider-neutral, governable and observable.

### Required outcomes

- capability registry;
- provider discovery and qualification registry;
- Provider Decision Records and benchmark evidence;
- approved provider registry;
- quote and reservation;
- risk and autonomy binding;
- normalized invocation lifecycle;
- auth references;
- health and circuit breakers;
- retries and idempotency;
- async jobs;
- webhooks;
- MCP gateway with tool allowlists;
- direct API/OpenAPI adapters;
- browser fallback policy;
- provider contract-test kit;
- integration UI.

### Initial capability implementations

Normalize the existing OpenAI capabilities first.

Then complete provider discovery and decision records for the first commercial-loop capability classes:

- website design and staging;
- checkout and verified payment events;
- creative image/video production;
- product analytics;
- structured research or market data.

Implement one approved sandbox-capable provider for each required class. Webflow, Framer, Stripe, PostHog, Higgsfield, Artlist, Apify, DataForSEO and similar services are candidates, not mandatory selections.

### Exit gate

- agents request capability IDs rather than provider-specific tools;
- at least three provider adapters across critical capability classes pass the common test kit, with replacement paths documented;
- costs, risks and health are visible in the control plane;
- no live production action occurs without the correct authority.

---

## Phase 5: Dynamic Venture OS and agent teams

### Objective

Allow Pantheon to design how a venture should operate instead of relying on a fixed human-authored workflow.

### Required outcomes

- Venture Kit v2 schema;
- digital-product v2 kit;
- agent registry;
- dynamic team assembly;
- Business Systems Architect;
- Venture Operating Plan;
- workflow DAG;
- dependency-aware executor;
- configurable concurrency;
- concurrency keys;
- resumable HITL;
- plan-version decisions;
- agent evals.

### Operational posture

The executor supports parallel branches.

The first live venture starts with conservative concurrency limits.

### Exit gate

- an approved opportunity can produce a complete, reviewable Venture Operating Plan;
- Pantheon can instantiate the required team and DAG;
- changing a provider does not change the plan schema;
- the owner can approve the plan from the UI;
- a full dry-run completes.

---

## Phase 6: Opportunity and research intelligence

### Objective

Give the team broad, structured and evidence-disciplined market intelligence without hard-coding one research method.

### Required outcomes

- research-source registry;
- query planner;
- source selection;
- OpenAI grounded web research;
- at least one qualified structured-extraction provider;
- at least one qualified structured market-data provider;
- official marketplace APIs where relevant and eligible;
- search-trend data where accessible;
- video-platform and public-community signals where relevant;
- provider decision records for source classes that expose paid data or authenticated access;
- evidence normalization;
- contrary-evidence requirement;
- opportunity scoring;
- research cost controls;
- revalidation and freshness.

### Exit gate

- Pantheon can compare opportunities using multiple source classes;
- the research plan is adaptive rather than fixed to two queries;
- observed facts and inferences remain distinct;
- source and cost evidence are visible;
- a Quality Reviewer can reject weak research;
- the Chief can choose, defer or kill an opportunity.

---

## Phase 7: Creative, product and web factory

### Objective

Transform an approved opportunity into a visually credible, buyable customer experience.

### Required outcomes

- creative brief schema;
- brand-system schema;
- asset provenance;
- improved digital-product builder;
- qualified creative-media provider integration selected through a Provider Decision Record;
- qualified brand-production path;
- qualified website design and staging integration;
- component and template library;
- copy and claim review;
- visual QA agent;
- interactive browser and screenshot review loop;
- owner comparison board;
- staging publication;
- production publication approval pack.

### Quality philosophy

AI visual generation is not accepted merely because a file exists.

Every asset is evaluated for:

- human appeal;
- brand consistency;
- product fidelity;
- channel fit;
- readability;
- hierarchy;
- conversion intent;
- originality;
- factual and legal claim safety;
- technical quality.

### Exit gate

From an approved Venture Operating Plan, Pantheon can create:

- product;
- brand;
- marketing images;
- video;
- landing site;
- checkout-ready staging experience;
- QA report;
- owner approval package.

No production launch is required for this phase.

---

## Phase 8: Commerce, customer, analytics and finance

### Objective

Complete the missing real-world operating path.

### Required outcomes

- qualified payment provider test/live separation;
- checkout creation;
- verified payment event or webhook ingestion;
- idempotent payment ingestion;
- secure fulfilment;
- customer email;
- refund and failed-payment handling;
- production website publication and rollback;
- qualified analytics-provider event taxonomy;
- UTM and campaign attribution;
- customer-support inbox;
- customer feedback capture;
- internal ledger reconciliation;
- qualified accounting-system read/sync path where justified;
- live-readiness checklist;
- emergency stop.

### Exit gate

A sandbox customer journey can complete:

- visit;
- product view;
- checkout;
- payment;
- webhook;
- fulfilment;
- email;
- analytics;
- accounting;
- owner dashboard.

A controlled live readiness rehearsal passes with no real charge.

---

## Phase 9: Continuous learning and earned autonomy

### Objective

Turn commercial activity into better future decisions and progressively reduce human intervention.

### Required outcomes

- experiment lifecycle;
- outcome diagnosis;
- lesson schema;
- cross-venture institutional learning;
- provider quality scores;
- agent quality scores;
- autonomy evidence;
- promotion and demotion;
- owner feedback capture;
- strategy revision;
- Engineering Agent issue and PR proposal flow;
- learning dashboards.

### Exit gate

Pantheon can:

- explain what happened;
- distinguish evidence from guess;
- identify the most likely constraint;
- propose the next experiment;
- update provisional knowledge;
- recommend an autonomy change;
- preserve owner decisions.

---

## Phase 10: First commercial viability programme

### Objective

Use Pantheon, not Codex improvisation, to operate the first real venture until viability is proven or the system rationally moves to another opportunity.

### Operating sequence

1. clean-slate state and approved budget;
2. opportunity discovery;
3. research and opportunity decision;
4. Venture Operating Plan;
5. demand experiment;
6. product and creative;
7. staging and QA;
8. owner launch approval;
9. real traffic;
10. payment and fulfilment;
11. support;
12. accounting and attribution;
13. diagnosis;
14. scale, revise, pause or kill;
15. next iteration.

### Owner role

The owner:

- approves material opportunity selection;
- approves initial public launch;
- approves meaningful spend;
- approves sensitive claims;
- reviews early visual quality;
- reviews exceptions.

The owner does not manually operate ordinary tasks that Pantheon has earned authority to perform.

### Exit gate

- genuine external transaction;
- three independent paying customers;
- positive net cash contribution;
- correct fulfilment;
- reconciled economics;
- recorded learning;
- no bespoke source-code changes for the individual offer;
- owner-readable report.

---

## Phase 11: Repeatability, parallelism and second Venture Kit

### Objective

Prove Pantheon is a business builder rather than a one-off product factory.

### Required outcomes

- second digital-product opportunity;
- no bespoke source changes;
- reuse of institutional learning;
- bounded parallel task execution;
- two isolated ventures;
- venture-specific credentials and budgets;
- second Venture Kit;
- persistent runtime deployment;
- database and workflow-engine decision gates;
- portfolio-level dashboards;
- revised autonomy posture.

### Recommended second Venture Kit

Choose a structurally different but still tractable model, such as:

- affiliate/content commerce; or
- a narrow SaaS product.

Do not choose the second model until the first kit is commercially proven.

### Exit gate

- second digital-product loop works;
- two ventures can operate without contamination;
- one additional Venture Kit completes a full dry-run;
- the platform has evidence for its next scaling architecture.

---

## 19. Phase-gate decision framework

At every phase gate, the independent reviewer must answer:

1. Did the phase objective actually become real?
2. Is the UI representing real state rather than fixtures?
3. Are all new external actions governed?
4. Is the codebase easier or harder for Codex to modify?
5. Did the phase add commercial capability?
6. Were unrelated defects left outside scope?
7. Are rollback and recovery proven?
8. Is the next phase still the highest-leverage move?
9. Does the Master Plan need an ADR-backed amendment?
10. Can the owner understand the result?
11. Can a fresh Codex or Claude Code session reconstruct the phase state from the repository?
12. Were provider choices supported by current evidence rather than owner or agent familiarity alone?

No phase advances on test count alone.

---

## 20. Master metrics

### 20.1 System metrics

- opportunity-analysis cost;
- idea-to-staging cycle;
- staging-to-launch cycle;
- task success rate;
- human rescue rate;
- owner decision count;
- provider qualification age;
- provider failure rate;
- provider switching and fallback success;
- rollback rate;
- model and provider cost;
- autonomy by capability;
- time spent blocked;
- percentage of activity visible in real time.

### 20.2 Agent metrics

- output contract pass;
- evidence coverage;
- unsupported-claim rate;
- tool-selection quality;
- escalation accuracy;
- cost adherence;
- owner override rate;
- downstream acceptance;
- commercial effect.

### 20.3 Venture metrics

- traffic;
- qualified demand;
- conversion;
- checkout initiation;
- purchases;
- revenue;
- fees;
- refunds;
- fulfilment cost;
- acquisition cost;
- gross margin;
- contribution;
- support load;
- repeat purchase or retention where relevant;
- experiment velocity;
- kill or scale decision quality.

### 20.4 Learning metrics

- lessons created;
- lessons reused;
- lessons contradicted;
- decision improvement after reuse;
- confidence calibration;
- stale knowledge awaiting revalidation.

---

## 21. Change-control rules

The Master Plan may change when:

- a provider capability materially changes;
- a phase uncovers a false assumption;
- a commercial test proves a different priority;
- the current stack cannot meet a verified requirement;
- a security issue requires a different boundary.

Every change requires:

- proposed change;
- reason;
- evidence;
- alternatives;
- impact;
- ADR;
- owner approval;
- version update.

Codex may not silently rewrite the programme to match the work it happened to complete.

---

## 22. Immediate next action

Do not ask either coding agent to “build Pantheon v2.1.1.”

Install the execution kit using `START_HERE.md`, then begin with a fresh Codex planning session.

Recommended first instruction:

```text
Read AGENTS.md if installed, docs/v2/PANTHEON_V2_MASTER_PLAN.md,
docs/v2/ENGINEERING_PROTOCOL.md, docs/v2/SESSION_PROTOCOL.md,
docs/v2/PROVIDER_DISCOVERY_AND_QUALIFICATION.md, docs/v2/PROGRESS.json,
and the current repository.

This is a planning-only Phase 0 session. Do not modify Pantheon production or
business behaviour. Inspect the current repository instructions, Codex and
Claude configuration, skills, hooks, scripts, test runner, CI, build logs,
large modules and current working state.

Create a proposed docs/v2/phases/P0-EXECUTION-PACK.md containing 5 to 8 bounded
work packages, exact acceptance criteria, targeted verification commands,
expected artifacts, rollback steps, session boundaries, cross-model handoff
requirements, scope exclusions and stop conditions.

Reconcile the proposed AGENTS.md and CLAUDE.md from the kit with any existing
root instructions, but do not install or modify them in this planning session.
Identify the first recommended work package and explain why it is the safest
starting point.

Use read-only subagents for repository mapping and test-impact analysis when
helpful. Stop after producing the Phase 0 Execution Pack. End with:
PHASE PLAN READY: OWNER REVIEW REQUIRED.
```

After owner approval, begin P0-W01 in a fresh Codex session using the work-package prompt under `docs/v2/prompts/`.

If Codex usage ends during a package, open the same worktree in a fresh Claude Code session and use the handoff-continuation prompt. Do not make Claude infer the prior conversation.


## 22A. Current implementation-reference rule

Coding agents must verify current official documentation at the time a package is executed. This plan records architecture, not frozen vendor syntax.

The kit's `docs/v2/REFERENCES.md` contains the official documentation baseline used for version 2.1, including Codex project instructions and browser use, Claude Code memory, skills and hooks, OpenAI Agents SDK guidance and MCP security guidance.

---

## 23. Final programme rule

Pantheon v2.1.1 may add a new abstraction only when at least one of the following is true:

- it is required by this target architecture;
- it removes a verified maintainability bottleneck;
- it enables a required external capability;
- it improves owner visibility;
- it closes a real commercial loop;
- it resolves a verified security, recovery or compliance risk.

Otherwise, the work is deferred.

The programme's governing question is:

> Does this change make Pantheon more capable of intelligently creating, operating, learning from and scaling real businesses?

If the answer is no, it is not v2 priority work.

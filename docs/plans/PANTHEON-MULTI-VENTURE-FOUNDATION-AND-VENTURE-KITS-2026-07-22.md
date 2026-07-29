# Pantheon Multi-Venture Foundation And Venture Kits

Date: 2026-07-22
Last reviewed: 2026-07-29
Status: active long-range roadmap; Portfolio Controller and the first registry
boundary are implemented, while Venture Factory, Kit 2, and concurrent venture
lanes remain gated
Owner: Daniel
Technical steward: Jarvis (Codex)

## Goal

Turn Pantheon from a proven single-venture commercial workflow into an AI-native
commercial operating system that can discover, construct, run, measure, improve,
pause, and retire multiple genuinely different online ventures in parallel.

Pantheon must not become a digital-product application with generic labels. It
must provide one reliable commercial kernel and allow each venture to own the
workflow, specialist team, tools, channels, production methods, economics,
rules, records, schedules, and learning appropriate to that business.

The historical digital-product journey is the vertical engineering proof and
`digital_product_v1` is the first registered Venture Kit. It is evidence from
which the reusable boundary is being extracted; it is not the permanent
workflow for every future venture and is not currently authorised for market
launch.

The stopped buyer-intent workflow is retained as pre-venture commercial
evidence. It does not change this roadmap, make Excel or Etsy universal, or
authorize a digital-product-first portfolio. It proved the cost-controlled
Product Builder, Quality Reviewer, and operator boundary through a terminal
non-pass; it did not prove a measured-market boundary or authorize Venture
Factory or concurrent lanes.

## Clarified Destination

Pantheon is intended to be an agentic business builder and runner:

1. Explore lawful online opportunity spaces across business models, markets,
   countries, languages, channels, and customer types.
2. Collect attributable evidence about demand, supply, competition, economics,
   execution difficulty, distribution, and platform constraints.
3. Decide whether an opportunity maps to a supported Venture Kit, needs a new
   kit, or should be rejected.
4. Create an isolated venture with its own commercial case, ledger, files,
   integrations, operating rules, team composition, schedules, and learning.
5. Assemble bounded specialist capabilities for the venture's actual work,
   rather than forcing every business through one fixed cast or pipeline.
6. Run internal work continuously and bring Daniel only consequential choices,
   protected actions, material risks, and exceptions.
7. Measure real commercial outcomes, diagnose weak results before killing a
   venture, and apply verified learning locally or across the portfolio.
8. Allocate limited money, model usage, tool capacity, and operator attention to
   the work with the strongest evidence-adjusted expected return.

## Owner-Absent Boundary

Pantheon's destination is owner-absent, brand-operated execution. Daniel supplies
strategy, guidance, and exact approvals for protected actions rather than
routine calling, emailing, publishing, advertising, fulfilment, or monitoring.
The public brand need not depend on Daniel's face or personal voice, but it must
be truthful and may not use anonymity, deception, or identity evasion.

Platform identity, KYC, OAuth, MFA, legal acceptance, and other owner-only
controls may still require Daniel when the service or law requires it. Future
voice, email, marketplace, publishing, advertising, customer, and fulfilment
adapters must expose dry-run and health/status paths and record exact approvals,
credentials, costs, receipts, attribution, timeouts, and unknown outcomes before
live use.

This operating destination does not widen current authority. Decision 0009 and
the completed commercial-truth plan kept the schema-26 release session
preparation-only with A$0 external spend.

## Honest Starting Position

Pantheon's deterministic kernel is substantially reusable. Operational records
already carry venture ownership, worker context is venture-scoped, and the
approval, cost, receipt, monitoring, recovery, evidence, and security systems
are not inherently tied to one sales model.

The current execution layer is deliberately narrow and is not yet a
multi-venture platform:

- the database permits one active venture;
- the execution design permits at most one active Full Journey, while terminal
  history must remain non-actionable;
- journey stages are a fixed digital-product sequence;
- `digital_product_v1` is the only implemented Venture Kit;
- the first kit's historical production path assumes locally rendered digital
  files and a Gumroad-ready store, while the generic kernel must not;
- the Phase 1 team and handoffs are fixed;
- Portfolio Controller now compares opportunities in a separate pre-venture
  workspace, but Venture Factory cannot yet create a supported venture from an
  approved case;
- platform adapters, credentials, budgets, schedules, and operational health are
  not yet isolated into concurrent venture lanes.

This is a valid vertical proof, not a failed architecture. The next stage must
extract the general boundary from observed behavior instead of either copying
the digital workflow or inventing a large abstract framework before use.

## Non-Negotiable Design Principles

- **One kernel, many ventures.** Never clone the Pantheon runtime, database, or
  dashboard for each business.
- **Commercial evidence before activity.** A venture exists to serve a buyer,
  solve a problem, distribute an offer, and produce positive cash contribution.
- **Configuration where stable, code where real.** Workflow graphs, contracts,
  KPIs, policies, and team composition should be versioned definitions. Genuine
  production engines and platform integrations remain tested code adapters.
- **Venture isolation by default.** Money, customers, files, credentials,
  approvals, tasks, tools, memory, analytics, and failures cannot silently cross
  venture boundaries.
- **Dynamic does not mean unbounded.** Pantheon composes workers from approved
  capabilities and contracts. A model cannot invent authority, tools, spend, or
  persistent roles.
- **Events advance work; schedules recover it.** Verified business events should
  wake the relevant venture lane. Periodic polling remains a recovery mechanism,
  not the commercial brain.
- **Outcome learning, not prompt accumulation.** Learning requires a hypothesis,
  action, observed result, diagnosis, and supported change.
- **Human simplicity.** Daniel sees portfolio position, important work, money,
  risk, and the next decision. Technical execution remains available on demand.
- **No premature infrastructure theatre.** Do not add distributed services,
  recursive agents, a general-purpose workflow language, or cloud deployment
  until three local venture lanes prove the need.

## Target Architecture

### 1. Commercial Kernel

The shared kernel continues to own:

- durable state and migrations;
- venture, workflow, task, event, and attempt identity;
- approvals, autonomy, cost limits, and protected actions;
- evidence provenance and commercial results;
- artifact integrity, recovery, monitoring, and audit history;
- operator sessions, dashboard truth, and security boundaries;
- model routing, provider receipts, evaluations, and unknown outcomes.

Business-model assumptions must leave this layer. The kernel should know how to
run verified work safely, not how an Etsy POD listing or a Gumroad workbook is
made.

### 2. Portfolio Controller

Add a portfolio layer above individual ventures. It owns:

- broad market exploration before a venture exists;
- comparable opportunity records across business models;
- supportability, capital, risk, operator-time, and expected-return assessment;
- the decision to create, defer, revisit, scale, pause, or retire a venture;
- portfolio-level limits and allocation recommendations;
- visibility across ventures without merging their operating state.

The Portfolio Controller does not manufacture products or run campaigns. It
creates bounded work for Venture Factory or an existing venture.

### 3. Venture Factory

Venture Factory turns an accepted opportunity into a recoverable venture
instance. Creation must record:

- venture identity, owner, business model, jurisdiction, audience, language,
  geography, and public brand constraints;
- chosen Venture Kit and exact version;
- buyer, problem, offer hypothesis, distribution hypothesis, economics, initial
  budget, evidence gaps, and first stop/revise rule;
- required integrations and account dependencies;
- initial team composition and autonomy levels;
- separate artifact, schedule, ledger, memory, and event namespaces.

Creating a venture must not activate publishing, account creation, spend, or
customer contact.

### 4. Venture Kit Registry

A Venture Kit is a versioned commercial operating blueprint. The registry must
validate a kit before it can create live work. `digital_product_v1` becomes the
first formal kit.

Each kit declares:

- supported business models and eligibility rules;
- required discovery, demand, competition, and economics evidence;
- workflow graph, stage contracts, dependencies, correction limits, and terminal
  states;
- capability requirements and recommended specialist composition;
- task input and structured output schemas;
- allowed tools, integrations, side effects, and approval class per stage;
- product, service, catalogue, listing, fulfilment, and quality contracts;
- channel-selection and marketing planning rules;
- venture-specific KPI definitions and attribution requirements;
- launch, continue, revise, scale, pause, and kill criteria;
- customer-service, refund, records, privacy, and compliance requirements;
- required dashboards, operator decisions, and final publication package.

Kit definitions should initially use ordinary versioned JavaScript objects plus
JSON-schema validation. Do not build a new visual workflow language or custom DSL
until multiple proven kits expose a genuine need.

### 5. Venture Runtime Lanes

Every active venture receives an independent lane containing:

- event stream and runnable queue;
- concurrency and rate limits;
- monthly and action-level budgets;
- reservations, incurred estimates, unknown outcomes, and reconciled costs;
- integration health and venture-scoped credentials or account references;
- current workflow graph and resumable stage state;
- artifacts, deliverables, customer records, and commercial evidence;
- monitor findings, blocked work, and escalation priority.

The first release supports at most three active lanes. A failing or paused lane
must not stop healthy ventures, consume their approvals, or inherit their budget.
Shared providers still require a global capacity and monthly-spend ceiling.

### 6. Capability And Team Assembly

Separate commercial roles from model routes and tools:

- a **capability** is a bounded skill with an input contract, output contract,
  tools, context classes, evaluation, limits, and authority;
- a **specialist worker** is a configured use of one or more capabilities for a
  venture assignment;
- a **manager** may select only registered capabilities allowed by the active
  kit and venture policy;
- Luna, Terra, and Sol remain model routes chosen per assignment, not worker
  identities or authority levels;
- temporary specialists may later be instantiated from approved templates and
  closed after their work, but cannot create unrestricted recursive teams.

The Phase 1 fixed roster remains while Kit 1 proves itself. Generalisation first
allows a kit to activate a subset and supply venture-specific instructions.
Truly dynamic temporary roles follow only after team assembly, receipts,
evaluation, and cross-venture isolation pass deterministic tests.

### 7. Tool And Integration Registry

Every integration exposes:

- venture and capability eligibility;
- credential/account reference without exposing its secret;
- read, draft, protected-write, or forbidden operation classes;
- dry-run and health checks;
- cost and rate-limit behavior;
- idempotency, receipt, timeout, and unknown-outcome handling;
- data-access and retention rules;
- operator action required for OAuth, KYC, MFA, CAPTCHA, agreements, or money.

Kits select tools from the registry. They never embed reusable credentials or
allow an agent to discover and call arbitrary services without runtime policy.

OpenAI-specific execution, connector, sandbox, commerce, and transport
capabilities are tracked with explicit adoption triggers in
`docs/architecture/PANTHEON-OPENAI-CAPABILITY-ADOPTION-ROADMAP.md`. A new API or
beta feature is not automatically a registered Pantheon capability.

### 8. Evidence, Memory, And Learning

Maintain three distinct scopes:

- **Task evidence:** exact sources and records supplied to one assignment.
- **Venture memory:** products, customers, channels, experiments, economics,
  failures, and operating knowledge specific to one business.
- **Portfolio knowledge:** supported lessons that may inform other ventures,
  including applicability conditions, confidence, source ventures, sample size,
  and contrary evidence.

Cross-venture learning must be promoted deliberately. One good Pinterest result
must not silently become a universal rule. Raw customer or confidential records
never become portfolio memory.

### 9. Portfolio Economics

Keep net cash contribution in AUD as financial truth. Add:

- venture-level profit, cash, runway, model/tool spend, advertising, fulfilment,
  refunds, fees, tax records, and operator time;
- portfolio totals that reconcile exactly to venture ledgers;
- expected-return and confidence ranges, never invented certainty;
- capital-allocation recommendations with downside and evidence;
- global and venture-level budget enforcement;
- explicit funding proposals rather than autonomous money movement.

### 10. Operator Experience

The desktop cockpit evolves into:

- **Portfolio:** active ventures, cash contribution, risk, momentum, capital,
  blocked work, and the best next money move;
- **Important Work:** one ordered decision and exception queue across ventures;
- **Venture Workspace:** venture-specific position, workflow, team, products,
  channels, customers, finances, experiments, and learning;
- **AI Work:** genuine running assignments grouped by venture and team;
- **System:** shared providers, schedules, budgets, recovery, security, and
  engineering health.

Daniel must be able to pause a venture, cap spending, review a recommendation,
approve one protected action, and see the consequence without interpreting
internal orchestration language.

## Implementation Phases

### 2026-07-27 Progress

Pantheon has now:

- completed the Full Journey engineering proof without treating its product as
  commercial validation;
- registered `digital_product_v1` behind an explicit non-universal
  `VentureKitRegistry`;
- implemented Portfolio Controller v1 above venture creation;
- compared ten hypotheses and six finalists through two bounded live evidence
  rounds; and
- selected no investment because no case cleared every commercial gate.

At the 2026-07-27 checkpoint, the next step was not a second kit or concurrent
lane. It was stronger evidence for one parked case or a new submitted
opportunity, followed by Venture Factory only when an investment case genuinely
passed. The current 2026-07-29 gate below supersedes that checkpoint.

### 2026-07-29 Commercial Truth And Re-entry Gate

The first buyer-intent attempt reached its terminal non-pass branch. It proved a
bounded Product Builder, Quality Reviewer, protected approval, and release path,
but created no buyer-test pack, publication, buyer contact, order, revenue, or
actual net cash contribution.

The completed schema-26 gate is recorded in
`docs/plans/PANTHEON-COMMERCIAL-TRUTH-AND-OWNER-ABSENT-KIT-READINESS-2026-07-29.md`.
It established a canonical compatibility-verified release, reconciled runtime
and owner truth, implemented attributable buyer-and-cash evidence, proved
recovery and the owner journey, and retained a separate low-touch kit
hypothesis at `research_more` / `revise`. Etsy, Gumroad, A$29, and the exact
offer and test rules remain unproven.

The next gate is whether to add narrow, auditable pre-venture research authority
and, if authorised, complete bounded diligence. Venture Factory, Kit 2,
concurrent lanes, customer contact, publication, advertising, account action,
legal acceptance, and external spend remain separately gated.

### Phase 0 - Historical Vertical Proof (engineering complete; first buyer attempt closed without commercial proof)

The original planned actions were:

- Finish the isolated Luna-only Full Journey rehearsal.
- Inspect every output and reach `Ready to publish` without external action.
- Run the clean production-intent journey if the approved combined cap permits.
- Publish only through Daniel's separate protected action.
- Start the real buyer test and collect outcomes.

**Gate:** one coherent production path works end to end. That engineering gate
passed. The first buyer-intent attempt then closed at its terminal quality
non-pass before publication or buyer measurement. Real buyer, revenue, and
positive actual-contribution proof remains unmet. Any new attempt requires a
separate decision, offer, evidence plan, and protected test.

### Phase 1 - Extract Digital Product Kit V1 (registry boundary implemented)

- Identify every digital-product and Gumroad assumption in the journey,
  production, opportunity, dashboard, and agent contracts.
- Move workflow stages, eligibility, team requirements, schemas, tools, KPIs,
  quality rules, and publication-package rules behind the validated kit contract.
- Keep behavior and current proof records unchanged.
- Make the generic journey executor load a kit version rather than import a
  digital-product sequence.

**Gate:** registration, eligibility, and safety checks pass. Loading the entire
journey graph from the kit rather than the fixed executor remains pending and
should occur only when a selected opportunity needs this kit.

### Phase 2 - Add Portfolio Controller And Venture Factory (Portfolio complete; Factory pending)

- Move broad cross-model discovery above venture creation.
- Add candidate-to-kit matching and unsupported-opportunity retention.
- Create inactive venture instances from approved opportunities.
- Add venture-specific namespaces, policy, integration requirements, and initial
  commercial cases.

**Gate:** Pantheon can now propose and reject opportunities without editing seed
data or starting an external action. Instantiating an approved supported venture
through Venture Factory remains pending because no case has passed.

### Phase 3 - Prove A Structurally Different Second Kit

Choose a second kit that challenges the abstraction, likely POD or affiliate
commerce rather than another downloadable template. Implement only the adapters
and production logic genuinely required by that model.

**Gate:** Kit 2 can be installed and run through protected readiness without
changing the database kernel, approval engine, cost ledger, monitor, or generic
journey executor. If those components require business-specific branches, fix
the kit boundary before adding more kits.

### Phase 4 - Introduce Three Concurrent Venture Lanes

- Replace the one-active-venture index with an explicit portfolio activation and
  capacity policy through a versioned migration.
- Make claims, schedules, budgets, monitors, artifacts, integration references,
  dashboards, and events independently venture-scoped.
- Add fair global provider capacity and cost backstops.
- Test simultaneous progress, pause, restart, failure, approval, and unknown
  outcome across three ventures.

**Gate:** ventures A, B, and C can progress independently with zero cross-talk,
double-spend, shared approval, artifact collision, or hidden portfolio exposure.

### Phase 5 - Earn Dynamic Team Composition

- Let kits and managers assemble approved specialists per assignment.
- Add temporary worker-instance identity and lifecycle only if fixed-role
  activation is insufficient.
- Require task receipts, evaluation, monitor visibility, and automatic cleanup.
- Preserve Daniel's protected-action boundaries and capability-specific autonomy.

**Gate:** a manager can assemble the smallest appropriate team without creating
authority, costs, context access, or persistent roles outside runtime policy.

### Phase 6 - Scale Operations, Then Infrastructure

- Activate second and third real ventures under observed resource limits.
- Add venture-specific store, advertising, accounting, fulfilment, customer, and
  analytics integrations as commercial need proves them.
- Consider cloud workers, remote/mobile control, or distributed queues only when
  local three-lane reliability and economics justify the operational burden.

## Acceptance Tests For The Foundation

The multi-venture foundation is not complete until Pantheon can prove all of the
following:

- create a venture from a portfolio opportunity and exact kit version;
- install a new kit without changing kernel modules;
- run two materially different workflow graphs;
- assign different worker teams and tool policies per venture;
- stop one venture while other lanes continue;
- enforce global and venture budgets simultaneously;
- prevent cross-venture approvals, context, files, customers, costs, and events;
- restart and resume each lane from durable state;
- aggregate portfolio finances without losing venture attribution;
- promote a supported learning with provenance and reject an unsupported one;
- show Daniel one clear portfolio queue and a complete venture drill-down;
- retain external-action protection independently for every venture;
- recover the whole portfolio and each venture from coherent backups.

## Anti-Goals

Do not:

- duplicate the repository or database per venture;
- encode every future business into one enormous conditional pipeline;
- make model conversations the source of business state;
- let managers freely invent agents, tools, credentials, or authority;
- treat a workflow definition as proof that its platform adapter works;
- generalise the kernel around imagined ventures before Kit 1 completes;
- build a marketplace of dozens of kits before Kit 2 validates the boundary;
- unlock uncontrolled parallel paid work merely because lanes exist;
- introduce cloud complexity before local operation and commercial results.

## Future Goal Statement

Only after one operating venture reaches three independent paying buyers and
positive actual net cash contribution in AUD, the current release remains
compatibility-proved, and Daniel explicitly approves portfolio expansion should
the next major implementation goal be:

> Build and prove Pantheon's Multi-Venture Foundation by extracting the current
> digital-product journey into a validated `digital_product_v1` Venture Kit,
> adding portfolio-level opportunity selection and a Venture Factory, proving a
> structurally different second kit without kernel changes, then enabling three
> isolated venture lanes with separate workflows, teams, tools, budgets, records,
> schedules, artifacts, learning, monitoring, and protected actions.

The goal is complete only when Pantheon can add and run a second business type
without mass file duplication or business-specific changes to the commercial
kernel.

## Superseded Scheduling Decision - 2026-07-22

Finish the current vertical proof first. Begin Phases 1 and 2 while the first
published offer is completing its 14-day or 50-qualified-view market test. This
uses waiting time productively without postponing real commercial evidence or
allowing the first venture to define the permanent architecture by accident.

## Current Scheduling Gate - 2026-07-29

Do not use the historical 14-day or 50-view instruction. The first attempt never
reached a published market test, and its A$29.95, Etsy, 100-visit, and 30-day
terms do not transfer to another offer.

The commercial-truth and owner-absent kit-readiness plan is complete. Decide
whether to add narrow, auditable pre-venture research authority and, if
authorised, complete bounded diligence. Only if the new hypothesis later clears
its commercial and system-readiness gates should Pantheon prepare one separate
protected external-test proposal using current channel evidence, exact
attribution, an approved cohort and deadline, actual AUD economics, and
diagnose/revise/stop rules. Do not schedule Venture Factory, Kit 2, or
concurrent lanes merely to fill a measurement window.

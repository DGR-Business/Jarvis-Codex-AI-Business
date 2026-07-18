# Pantheon Commercial Operating System Execution Plan

Date: 2026-07-18
Status: foundation release complete; first real commercial run next
Owner: Daniel
Technical steward: Jarvis (Codex)

## Objective

Turn the current control-plane prototype into Pantheon: a practical,
desktop-first AI business operating system that can repeatedly discover,
evaluate, build, prepare, measure, and improve online ventures.

Pantheon must do the analytical and production work. Daniel should receive only
important choices, protected external actions, material risks, and concise
business updates. Jarvis builds, monitors, repairs, and improves Pantheon without
pretending that unimplemented capabilities exist.

The first release is complete only when the software can run one coherent
commercial workflow from opportunity discovery to a launch-ready, independently
reviewed venture package, preserve the evidence and costs, stop at protected
outside-world actions, and resume from the dashboard.

## Identity And Ownership

- **Pantheon** is the product and runtime.
- **Daniel** is the owner and final decision-maker for consequential business
  actions.
- **Jarvis** is Daniel's Codex-based developer, IT engineer, system monitor, and
  improvement steward.
- **Chief of Staff** is Pantheon's business manager. It coordinates bounded
  specialist assignments but does not own infrastructure, credentials, or
  operator authority.
- Technical compatibility identifiers may retain an older `jarvis` prefix when
  changing them would invalidate historical hashes or environment configuration.
  They are not user-facing product names.

## Commercial Constitution

### Results Before Activity

- Pantheon exists to produce profitable, real-world business results.
- Model calls, documents, traces, tasks, and approvals are supporting evidence,
  not commercial outcomes.
- The primary score is net cash contribution in AUD after fees, refunds,
  advertising, external services, product costs, and attributable AI usage.
- ChatGPT Pro is recorded as fixed overhead but excluded from the A$100 monthly
  discretionary operating cap.
- Operator-time-adjusted contribution is shown separately.

### Demand Before Production

- Start broad, then deepen research on the strongest opportunities.
- Prefer observable purchase behaviour, marketplace volume, pricing, reviews,
  competition, advertising activity, distribution access, and unit economics
  over vague online sentiment.
- State what cannot be observed. Never convert a proxy into a claimed sale,
  unit count, or proven willingness to pay.
- Every evidence item records provenance, retrieval time, confidence, and the
  business claim it supports.

### Ventures, Not Token Products

- A credible venture is not proved by one arbitrary SKU.
- Each opportunity must define a minimum credible catalogue based on buyer
  segments, competitor norms, channel expectations, production economics, and
  the number of offers needed for a fair test.
- Pantheon may generate broadly, but only coherent, quality-reviewed products
  become launch-ready.
- The first venture remains the only active venture until it reaches three
  independent paying buyers and positive cash contribution.
- After first proof, Pantheon may run up to three ventures concurrently. Further
  expansion requires demonstrated operating capacity and reliable controls.

### Diagnose Before Killing

Before a venture is paused or stopped, Pantheon must distinguish:

- inadequate reach;
- wrong audience or channel;
- weak creative or listing;
- poor offer, value, catalogue, or price;
- checkout or fulfilment friction;
- product-quality failure;
- genuine lack of demand;
- insufficient or unreliable evidence.

One measured revision is allowed when evidence supports it. Pantheon must record
why the venture failed, what changed, and what should not be repeated.

### Make Or Buy

- Create products, templates, assets, and analysis internally when Pantheon can
  meet the required quality more cheaply and reliably.
- Recommend licensed data, assets, tools, or services when buying is the better
  commercial decision.
- Paid services stay inside the operating budget unless Daniel approves a
  separate exact amount.

### Production Truth

- A prototype, rehearsal, fixture, or test artifact may never be presented as a
  customer-ready product.
- A product becomes production-ready only after format checks, functional
  checks, evidence and claim review, commercial review, and an independent
  quality verdict.
- B2B products must work reliably for their stated use.

## Operating Mandate

Pantheon may perform the following without a separate decision each time when
the exact task is recorded, recoverable, and inside the monthly cap:

- internal analysis and planning;
- capped OpenAI specialist work;
- read-only public web research that respects the acquisition policy below;
- internal drafting and local artifact creation;
- deterministic calculations, imports, checks, monitoring, and repair;
- quality review and recommendations.

The initial discretionary cap is A$100 per calendar month across OpenAI API
usage, advertising, subscriptions, paid research, and external services. The
runtime must reserve against the cap before dispatch and show estimates as
estimates until reconciled.

After first commercial proof, an additional reinvestment pool may be proposed
at 30% of net venture profit. It is not available before proof.

The following remain protected and require Daniel at action time:

- public publishing and every public post initially;
- account creation, KYC, OAuth consent, MFA, and material account changes;
- advertising campaign activation or an increased campaign cap;
- customer contact until the exact communication capability is promoted;
- refunds, disputes, legal agreements, money movement, and tax filings;
- consequential legal, compliance, IP, platform-risk, or business-structure
  decisions;
- any action outside the current operating mandate.

Pantheon may prepare everything needed for these actions and present one clear
decision with recommendation, effect, amount, risk, and rollback.

## Public Data Acquisition Policy

Pantheon may use APIs, licensed datasets, platform exports, and permitted public
web research. Public-page collection may include pagination, structured
extraction, normalization, deduplication, snapshots, provenance, and change
detection.

Pantheon must not defeat authentication, CAPTCHAs, paywalls, access controls,
private endpoints, platform enforcement, or technical restrictions. It must not
collect unnecessary private personal data or disguise prohibited automation.
When material data is unavailable through an acceptable route, Pantheon records
it as not observable and recommends a legitimate source or a different test.

## Architecture

### Runtime Ownership

Pantheon owns:

- venture, opportunity, catalogue, workflow, decision, result, and learning
  state;
- task claims, attempts, scheduler leases, retries, and unknown outcomes;
- exact approval scope and capability-level autonomy;
- costs, accounting, evidence, artifacts, and audit receipts;
- operator-facing status and dashboard truth;
- monitoring, recovery, evaluation, and improvement records.

### Agents SDK Boundary

The OpenAI Agents SDK is the first-class specialist execution layer. Each live
assignment uses a focused Agent definition, explicit model, structured output,
bounded tools, a cost and time ceiling, tracing, and a persisted result.

Pantheon, not model memory, owns business continuity. The SDK runs the
model/tool loop for one bounded assignment. Resumable SDK state is persisted
only for an interrupted exact tool call and cannot grant wider authority.

The Responses API remains available for lower-level direct calls or provider
features where the Agents SDK adds no useful orchestration.

### Manager Pattern

Chief of Staff remains responsible for the final business recommendation. It may
request one or more explicit specialist assignments through Pantheon. Pantheon
creates the tasks, selects the model, supplies focused context, enforces the
budget, records the handoff, and determines whether operator approval is needed.

Specialists are separate only when their instructions, tools, output contract,
quality policy, or model needs materially differ. Pantheon does not create
recursive worker swarms merely to appear autonomous.

### Event-Driven Supervisor

The Pantheon Supervisor runs as a scheduler-backed state machine. Each cycle:

1. reads durable business state;
2. checks budget, health, unknown outcomes, and protected actions;
3. identifies the single highest-value unblocked next action;
4. creates or claims exactly one idempotent work item;
5. runs eligible internal work or leaves one clear operator decision;
6. materialises validated output into business state;
7. records the result, learning, and next cycle time.

The supervisor cannot retry an unknown provider outcome, publish, contact a
customer, move money, create an account, or widen its own mandate.

## Commercial Workflow

### 1. Opportunity Discovery

- Accept either a broad discovery brief or Daniel's `Explore My Idea` input.
- Scan a broad business-model universe rather than forcing every idea into
  digital products or POD.
- Return a source-backed shortlist with buyer, problem, offer family, region,
  likely channels, catalogue logic, price range, competition, execution fit,
  evidence quality, risks, and missing data.

### 2. Diligence And Selection

- Deepen research on the top three candidates.
- Have Demand Validator challenge demand and Finance test contribution,
  break-even, cost exposure, and operator burden.
- Chief of Staff presents one recommended opportunity and two alternatives.
- Daniel makes the consequential venture-selection decision.

### 3. Offer And Catalogue

- Define buyer segments, promise, price architecture, channel, brand boundary,
  minimum credible catalogue, production method, and test design.
- Create catalogue records before product generation.
- Use category-specific portfolio logic rather than a universal SKU count.

### 4. Product Work And Quality

- Product Builder prepares real local outputs or exact external-generation
  requests.
- Quality Reviewer independently checks the frozen files and claims.
- Failed functional, claim, provenance, or quality checks return exact changes.
- Only passing outputs become production-ready.

### 5. Launch Preparation

- Prepare listing copy, creative, channel plan, economics, tracking, customer
  handling, and a concise Publish Pack.
- Stop for Daniel at account, KYC, publishing, post, campaign, or spend
  activation boundaries.

### 6. Results And Learning

- Import platform results idempotently.
- Compare expected and actual reach, conversion, sales, refunds, contribution,
  and effort.
- Continue, revise, scale, or pause using recorded evidence.
- Feed every outcome into candidate scoring, prompts, tool choice, quality
  rules, and future business decisions.

## Team And Model Routing

- **Chief of Staff:** synthesises and selects the next bounded assignment.
- **Opportunity Scout:** broad discovery and opportunity ranking.
- **Demand Validator:** deep demand and competition challenge.
- **Offer Architect:** offer, positioning, price, and catalogue architecture.
- **Product Builder:** product files, assets, and production work.
- **Copy and Conversion Agent:** listings, pages, messages, and claims.
- **Distribution Agent:** channel-specific launch and measurement plans.
- **Finance and Unit Economics Agent:** contribution, break-even, and capital
  allocation.
- **Customer Voice Agent:** buyer language, objections, feedback, and service
  learning.
- **Growth Analyst:** result diagnosis, revision, scale, and stop decisions.
- **Quality Reviewer:** independent functional, evidence, claim, and artifact
  review.

Luna handles narrow, low-ambiguity tasks. Terra is the normal business worker.
Sol handles deep research, consequential synthesis, complex diagnosis, or
quality escalation. The route is selected before dispatch and recorded.

Autonomy is earned per capability after five consecutive reviewed successes.
Failure resets that capability's streak. No agent receives global autonomy.

## Operator Experience

The desktop cockpit has five clear areas:

- **Overview:** Important Work, active venture, next money move, current stage,
  cash, budget, team activity, and system health.
- **Opportunities:** broad scan, shortlist, evidence, economics, and
  `Explore My Idea`.
- **Venture:** offer, catalogue, product work, launch readiness, live test,
  results, and learning.
- **AI Team:** what every worker is doing, genuine live runs, cost, tools,
  handoffs, results, and review status.
- **System:** health, connections, spend, backups, outputs, activity, and
  technical detail.

The normal view uses plain business language. One spacious drawer presents the
full context for a decision or output. Internal identifiers and diagnostics are
available on demand. The dashboard never exposes or claims private
chain-of-thought.

## Implementation Phases And Gates

### Phase A - Identity And Recoverability

Status: complete.

- Rename active product surfaces and docs to Pantheon.
- Keep technical compatibility aliases where required.
- Prove encrypted source, database, and artifact backup and restore.
- Preserve accounting and private operator records.

Gate: clean install, test, start, health, backup, and restore all pass.

### Phase B - Runtime Consolidation

Status: complete.

- Add the operating mandate, supervisor cycle, opportunity, and catalogue state.
- Make the supervisor idempotent and lease-protected.
- Auto-authorise only in-mandate internal AI work.
- Retain exact task, approval, cost, trace, and receipt controls.
- Hide legacy pilot/workbench APIs from the normal cockpit.

Gate: concurrency, budget, approval, unknown-outcome, migration, and recovery
tests pass.

### Phase C - Commercial Pipeline

Status: complete for the implemented first-venture path.

- Implement discovery, diligence, selection, offer, catalogue, product, quality,
  launch-preparation, results, and learning transitions.
- Implement `Explore My Idea`.
- Require production-readiness and diagnose-before-kill rules.

Gate: a deterministic end-to-end fixture proves every state transition without
being represented as real business evidence.

### Phase D - Operator Cockpit And Packs

Status: complete.

- Replace pilot terminology and fragmented views.
- Add opportunities, venture portfolio, live worker activity, clear decisions,
  and spacious output/PDF review.
- Redesign human PDFs around recommendation, evidence, economics, risk, and
  action.

Gate: real-browser proof passes at 1440x900, 1280x720, and 1024x768 with no
console error, overflow, dead action, or unreadable PDF preview.

### Phase E - Live Proof

Status: complete.

- Run a low-cost Luna systems proof through the real Agents SDK path.
- Prove a Scout or Validator assignment, materialisation, Chief handoff,
  evaluation, cost record, dashboard activity, and next-action update.
- Keep the proof data separate and reset the operator cockpit afterward.

Gate: provider receipt, trace, structured output, evaluation, cost state,
materialised result, and dashboard proof all agree.

### Phase F - Ready For First Use

Status: complete.

- Reset test and historical activity from the active cockpit after encrypted
  backup.
- Leave no queued sample work, fake opportunity, fixture decision, or test pack.
- Start Pantheon with monitoring and the Supervisor ready.
- Show one truthful first action: run broad discovery or explore Daniel's idea.

Gate: Daniel can start Pantheon, understand its state at a glance, initiate the
first real workflow, and see what will happen next without Codex intervention.

## Completion Record

The engineering release completed on 2026-07-18:

- clean install and npm advisory checks passed;
- 201 of 201 automated tests passed after the clean install;
- SQLite schema 20 passed integrity and foreign-key checks;
- a coherent encrypted source, database, artifact, pack, and private-reference
  recovery set authenticated and restored;
- Pantheon Doctor reported operations-ready;
- one real Luna Opportunity Scout and three real Luna Demand Validator calls
  completed through the OpenAI Agents SDK with 137 stored sources, complete
  receipts, trace IDs, passed deterministic evaluations, and zero external
  business effects;
- the real Chrome dashboard passed at 1440 x 900, 1280 x 720, and 1024 x 768;
- the in-dashboard four-page PDF preview passed in an isolated browser proof;
- the production runtime was reset to one truthful first action with all 11
  workers on standby and no pilot history.

The exact proof and its limitations are recorded in
`docs/proofs/2026-07-18-pantheon-release-proof.md`. Completion of this engineering
plan does not mean commercial demand or revenue is proven. The next work is the
first real opportunity-discovery and buyer-evidence loop.

## Verification

Required verification includes:

- clean install and syntax checks;
- all native tests plus focused migration, mandate, supervisor, commercial
  pipeline, security, backup, restore, PDF, and browser tests;
- SQLite integrity and foreign-key checks;
- task-claim and scheduler concurrency;
- approval replay, scope change, expiry, and single-use behaviour;
- monthly cap and estimate-versus-actual cost truth;
- timeout and unknown-outcome handling;
- test database and artifact isolation;
- HTTP session, CSRF, Origin, Host, WebSocket, file-serving, and output-escaping
  checks;
- genuine Agents SDK trace and receipt proof;
- clean desktop cockpit and readable human PDF packs.

No external publication, customer contact, account action, KYC, legal agreement,
refund, advertising activation, or money movement is part of the engineering
proof.

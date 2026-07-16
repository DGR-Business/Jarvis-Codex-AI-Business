# Foundation-to-First-Revenue Execution Plan

Date: 2026-07-14
Status: active execution directive
Owner: Daniel
Maintainer: Codex

## Objective

Prove one digital-product venture before the system expands. Jarvis performs
the analysis and preparation. Daniel receives concise recommendations,
consequential decisions, and material exception alerts.

Success requires:

- one active digital-product venture;
- one real OpenAI Agents SDK Demand Validator proven through controlled review;
- one Gumroad product tested with real buyers;
- at least three independent paying customers and positive cash contribution;
- normal operator involvement at or below eight hours weekly, with up to 16
  hours only during an explicitly approved intensive week;
- no second venture, channel sprawl, or elaborate capability before the first
  commercial loop proves itself.

## Phase 1 - Recoverable Clean Baseline

- Use encrypted source, database, and artifact backups before destructive
  cleanup.
- Use the Node SQLite backup API plus AES-256-GCM encryption.
- Default backup destination:
  `C:\Users\radul\OneDrive\Jarvis-Codex-Backups`, configurable through an
  environment variable.
- Retain seven daily and four weekly backups and prove full restoration into a
  temporary location.
- Establish a clean tracked baseline in a private GitHub repository.
- Keep personal legal, tax, identity, and KYC records in the ignored private
  operator area. Track only redacted references.
- Keep paused POD work, design experiments, Claude-era material, superseded
  plans, and stale logs under `archive/historical/`.
- Remove reproducible dependencies, nested Git data, obsolete databases,
  temporary outputs, and duplicate deliverables only after restore proof.
- Keep fixtures separate from ignored runtime artifacts and require Node 24.

Gate: source and runtime state restore successfully, and a clean source copy
installs, tests, and starts.

## Phase 2 - Runtime Truth And Safety

- Apply versioned migrations without replacing the operator database.
- Isolate test database and artifact roots from real deliverables.
- Render one deterministic canonical version of each output from state.
- Atomically claim tasks and record attempts so simultaneous ticks cannot call a
  provider twice.
- Bind approval to venture, workflow, task, worker, provider, model, fixture,
  tools, parameters, limits, cost cap, and external effects.
- Make approvals single-use, expiring, and invalid after scope changes.
- Distinguish reserved, incurred estimate, unknown, reconciled, and released
  cost. Never label an estimate as actual spend.
- Treat provider timeouts as unknown outcomes requiring review.
- Resume setup-blocked work safely when credentials become available.
- Require local session, CSRF, Origin, and WebSocket validation for mutations.
- Deduplicate monitoring findings and separate fixtures from business evidence.

Gate: concurrency, approval, cost, recovery, security, backup, and artifact
isolation tests pass.

## Phase 3 - Commercial Operating Model

- Every operational record belongs to the active venture.
- Venture stages are Candidate, Validating, Selling, Fulfilling, Scaling, and
  Paused.
- The Venture Case is the commercial source of truth: buyer, problem, offer,
  price, channel, evidence, economics, active test, metric, deadline, kill rule,
  next money move, decision, and learning.
- Test states are Candidate, Ready, Running, Completed, and Cancelled. Running
  requires a confirmed real-world start.
- Evidence provenance is fixture, operator observation, source link, platform
  import, or receipt.
- Cash contribution is revenue less Gumroad fees, refunds, external spend, and
  product/tool costs. Operator-time-adjusted contribution is separate.
- Work is compressed into Evidence Brief, Test Pack, Publish Pack, and Decision
  Pack.
- All 11 workers remain visible in Command, Evidence, Venture, and
  Control/Learning groups.
- Autonomy is earned per exact capability, never per agent globally.
- Internal analysis and drafting may be promoted after five consecutive
  successful reviewed runs.
- Paid read-only research also needs Daniel's explicit promotion and fixed caps.
- Publishing, customer contact, public strategy, and spend remain
  recommendation-plus-approval actions.
- Legal agreements, account creation, disputes, and money movement remain hard
  stops.
- A failed reviewed run resets the capability streak and creates Important
  Work.

## Phase 4 - Cockpit Redux

The desktop-first cockpit has five sections:

- Command Center: Important Work, venture position, next money move, current
  test, team pulse, cash, spend cap, and health.
- Decisions: consequential approvals and worker handoffs, with Reviews,
  Suggestions, and History separated.
- Business Tests: Plan, Ready, Running, and Results with one evidence/results
  detail surface.
- AI Team: all workers grouped compactly, with technical detail on demand.
- System: Health, Queue, Spend, Connections, Outputs, and Activity.

Focused APIs back each section. Commands require `venture_id` and explicit
`plan_only` or `run_protected` mode. Approval mutations require the expected
scope hash. The normal interface uses ordinary business language; technical
state remains available in System and SQLite.

## Phase 5 - Agents SDK Proof

- Jarvis owns business state, approvals, costs, persistence, and dashboard
  truth. The OpenAI Agents SDK owns the specialist worker loop.
- First worker: Demand Validator only.
- First live run: no tools, no handoffs, one turn, maximum 1,200 output tokens,
  and maximum approved cost of A$1.
- Protected baseline and SDK worker receive the same versioned evidence fixture;
  the SDK worker never receives the baseline answer.
- Required output covers evidence, counterevidence, assumptions, price/channel
  hypothesis, smallest test, metric, kill rule, confidence, and risks.
- Review source validity, unsupported claims, reasoning, commercial usefulness,
  scope, and cost. Daniel supplies the usefulness verdict. No model judge is
  used initially.
- Run one reviewed pilot followed by up to four distinct separately approved
  fixtures. Five consecutive passes make only reasoning over supplied evidence
  eligible for Daniel's promotion.
- Add read-only web search later as a separate capability with an A$2 cap and
  its own five-run review sequence.
- The Responses API remains a lower-level provider path and may not silently
  substitute for the Agents SDK acceptance run.

Official implementation references:

- <https://developers.openai.com/api/docs/guides/agents>
- <https://developers.openai.com/api/docs/guides/agent-evals>
- <https://openai.github.io/openai-agents-js/guides/running-agents/>

## Phase 6 - First Gumroad Revenue Loop

- Rank three digital-product opportunities and present one concise selection
  decision.
- Build the smallest useful product, files, listing copy, economics, risk
  review, and publishing checklist.
- Use Gumroad Direct for checkout and fulfilment.
- Daniel may privately complete required KYC. The public brand remains faceless
  and voiceless.
- Daniel performs initial account creation and publishing after reviewing the
  complete Publish Pack.
- Start with at most three compliant organic posts across no more than two
  evidence-selected channels. No cold spam or automatic public posting.
- Run for 14 days or 50 qualified Gumroad product views.
- Continue on three independent paid buyers and positive cash contribution.
  Revise when meaningful interest exists but conversion is weak. Stop after 50
  qualified views and zero sales unless strong buyer evidence justifies one
  revision.
- If organic reach remains insufficient after 14 days, offer Daniel one optional
  A$25 paid test. Never initiate spend automatically.
- Import Gumroad CSV results idempotently by purchase ID, retaining only
  required commercial fields and hashed buyer identifiers.
- Defer Higgsfield, ElevenLabs, and other paid media tools until three sales
  prove demand, unless evidence shows media quality is the conversion blocker.

Recheck these official Gumroad references immediately before launch:

- <https://gumroad.com/help/article/66-gumroads-fees>
- <https://gumroad.com/help/article/121-sales-tax-on-gumroad>
- <https://gumroad.com/help/article/74-the-analytics-dashboard>

## Limits

- A$1 maximum for the first no-tool AI pilot.
- A$2 maximum for a later approved read-only search run.
- A$25 maximum for one optional approved market test.
- A$100 total monthly pre-revenue spend cap.
- One venture and one real-world test at a time.
- No model connection, Gumroad account creation, publishing, spend, or customer
  contact without Daniel's confirmation at the time of action.

## Current Delivery State

- Phase 1: complete. Cleanup, permanent backup-key storage, fresh encrypted source/
  database/artifact backups, authenticated restore, current-output recovery,
  clean install, 81-test, healthy-start, PDF-preview, and desktop browser proof
  are complete. The baseline is history-free so legacy private metadata cannot
  be pushed. The private GitHub `main` branch contains the clean baseline, and
  a fresh checkout from that remote passed install, all tests, healthy startup,
  truthful empty-state, and real-browser verification on 2026-07-16.
- Phase 2: implemented through migration 10 and covered by automated tests.
- Phase 3: implemented for one active digital-product venture.
- Phase 4: implemented and real-browser verified at 1440x900, 1280x720,
  1024x768, and a stable 390x844 mobile fallback.
- Phase 5: the first oversized-contract attempt is preserved as a known
  technical failure. One separately approved corrected attempt then completed
  successfully with valid structured output, no tools, no handoffs and no
  external effects. Runtime eval scored 100 and all deterministic pilot checks
  passed. OpenAI usage confirms A$0.05 aggregate cost across the two calls. All
  86 tests pass, a complete encrypted post-pilot checkpoint has passed
  authenticated database/source/artifact restore, and live mode is off.
  Daniel's usefulness verdict remains the gate before this capability earns the
  first success in its five-run sequence.
- Phase 6: Gumroad import, privacy handling, launch gate, limits, and metrics are
  ready; opportunity selection, product creation, account action, publishing,
  and buyer test remain unperformed.

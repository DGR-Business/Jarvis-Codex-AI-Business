# Pantheon OpenAI Capability Adoption Roadmap

Date: 2026-07-28
Status: active future-capability register
Owner: Daniel
Technical steward: Jarvis (Codex)

## Purpose

This register preserves useful OpenAI capabilities without turning each new API
or beta feature into immediate Pantheon scope.

A capability moves from this register into an implementation plan only when:

- a real venture, operator problem, quality gap, or measured bottleneck needs
  it;
- the commercial benefit and simpler alternatives have been compared;
- its data, cost, approval, failure, recovery, and audit behavior are known;
- Pantheon can expose it through a bounded capability or Venture Kit contract;
  and
- the applicable release trigger below is satisfied.

Pantheon remains the control plane. No item in this register grants authority.

## Adoption Register

| Capability | Potential Pantheon use | Why it is deferred | Adoption trigger | Required gate |
| --- | --- | --- | --- | --- |
| Sandbox Agents | Product Builder, Quality Reviewer, Developer, financial-model or document work that genuinely needs a filesystem and resumable workspace. | Beta surface; adds a second execution environment and resource lifecycle. Most current workers need evidence analysis, not a workspace. | An approved investment case requires files or software that the deterministic factory cannot produce or inspect reliably. | Hosted or Docker isolation; no default network; no secrets in prompt or workspace; exact input/output manifest; resource cap; output hashes; open/render validation; teardown and recovery proof. |
| Hosted shell | Narrow calculations, document conversion, spreadsheet validation, or media processing. | Arbitrary shell increases execution risk and is unnecessary for ordinary recommendations. | A bounded artifact task needs occasional commands but not a persistent sandbox. | Disposable container; allowlisted packages and commands where practical; no host mounts or reusable credentials; complete command and artifact receipts. |
| OpenAI Skills in shell or sandbox | Versioned procedures for producing and validating spreadsheets, documents, storefront packs, or venture-specific artifacts. | A skill is procedural guidance, not authoritative policy. There is no approved sandbox artifact workflow yet. | The first sandbox or hosted-shell artifact capability passes its release gate. | Reviewed skill contents and dependencies; pinned version; provenance; artifact evals. Commercial Constitution and hard policy stay in runtime/system instructions. |
| Official MCP connectors | Read-only or protected access to a venture-specific service such as email, files, calendars, CRM, accounting, or commerce. | No current venture requires a connector, and broad connector exposure creates prompt-injection and data-exfiltration risk. | A selected Venture Kit identifies one exact service and operation that is materially better than a direct API or operator export. | Official or fully reviewed server; exact `allowed_tools`; venture-scoped OAuth; health and dry-run; data class; approval at external effect; receipt and revocation path. |
| Custom remote MCP | Vendor or Pantheon capability not covered by an official connector. | Highest MCP trust and maintenance burden. | A necessary vendor offers no suitable API adapter or official connector and the commercial value justifies ownership. | Server identity and schema pinning; tool allowlist; authentication; prompt-injection tests; output validation; change monitoring; failure isolation. |
| Tool search | Load only relevant tools when a Venture Kit has a large capability set. | Pantheon currently exposes only a few explicit capabilities; dynamic discovery would add opacity without meaningful token savings. | A worker namespace approaches ten tools or measured tool-schema tokens materially affect cost, latency, or tool choice. | Client-executed search against Pantheon's authorised Tool Registry; no discovery of unapproved tools; deterministic search audit and tool-choice evals. |
| Server-side Responses Multi-agent | Parallel exploration of independent evidence, comparisons, or implementation reviews inside one bounded request. | Beta; higher token use; no `max_tool_calls`; unsuitable for ordered work with shared mutable business state. | A measured sequential stage is dominated by independent research branches and the API exposes sufficient caps and trace controls. | One bounded no-side-effect pilot; concurrency and total exposure cap; independent source checks; no shared writes; comparison against ordinary workers. |
| Agents-as-tools | Chief or another manager synthesizes bounded specialist findings inside one run. | Existing persisted stages are clearer for consequential commercial work. | A single stage genuinely benefits from one manager retaining the final answer while calling a small number of read-only specialists. | Explicit specialist contracts; tool-call cap; no approval inheritance; trace/eval comparison against separate stages. |
| SDK sessions | Multi-turn customer support, operator conversation, or a persistent bounded manager dialogue. | Current workers are jobs, not conversations; Pantheon database state is the correct business memory. | A proven workflow requires conversational continuity across turns. | Choose exactly one session strategy; venture and customer isolation; retention/deletion; replay and approval-resume tests; never use session memory as financial or approval truth. |
| OpenAI Conversations or previous-response continuation | Lightweight server-managed continuity for a narrow interaction. | Risks duplicate context if combined with Pantheon replay and is unnecessary for one-turn workers. | A specific conversation has measured context-replay cost or latency. | One state strategy per conversation; exact linkage to Pantheon records; retention and failure semantics. |
| Computer use | Operate a third-party site that has no adequate API, export, or approved integration. | UI automation is brittle and exposed to prompt injection, changed pages, CAPTCHAs, credentials, and consequential actions. | A commercially necessary protected action cannot reasonably be completed through an API or operator upload. | Isolated browser; screenshot-first; domain and action allowlist; treat page content as untrusted; action-time confirmation; no bypass of access controls; replayable screenshots and outcome receipt. |
| OpenAI Commerce product feed | Make an owned product catalogue discoverable in ChatGPT shopping experiences. | Product-feed onboarding is currently limited to approved partners, and Pantheon has no proven owned catalogue. | A venture has a stable catalogue, measured sales, truthful product data, durable public URLs, and partner access. | Channel-neutral product and variant records; availability and price sync; policy review; attribution; feed validation and reconciliation. |
| Agentic Checkout | Allow ChatGPT to initiate checkout against a merchant-owned commerce stack. | Requires authoritative merchant checkout, payment, order, tax, fulfilment, webhook, signature, and idempotency infrastructure. Pantheon currently relies on external channels. | A proven venture operates its own store and payment stack and in-ChatGPT checkout has measurable channel value. | Authenticated signed endpoints; idempotency; authoritative totals and order state; webhook replay; PSP and tax reconciliation; protected financial actions; conformance tests. |
| File Search or hosted vector stores | Retrieve larger document collections for venture or portfolio work. | Pantheon's SQLite FTS5 retrieval already passes the current 20-case target and keeps records local and attributable. | FTS5 falls below 90% on a representative expanded retrieval evaluation or cannot meet measured latency/scale needs. | Side-by-side retrieval evaluation; citation and deletion behavior; data-class policy; cost and lock-in review. |
| Broader image, audio, or video generation | Product assets, advertising creative, previews, translations, or faceless media. | Capabilities should follow an approved offer and channel, not exist as demonstrations. | An investable venture and creative brief show that the medium is necessary for product or conversion quality. | Truthful claim and likeness rules; exact asset brief; cost cap; provenance; independent visual/audio QA; channel compliance. |
| WebSocket Responses transport | Reduce repeated round-trip latency during tool-heavy runs. | Current worker calls are mostly short and one-turn; persistent transport adds lifecycle complexity. | Measured multi-turn tool latency materially harms an approved workflow. | Connection ownership; reconnect and unknown-outcome handling; usage reconciliation; no duplicate tool execution. |
| Flex processing beyond evaluations | Lower cost for asynchronous research, enrichment, or maintenance. | Slower service and occasional unavailability are wrong for interactive or consequential work. | Eval-only use proves reliable, and a retry-safe non-interactive workload has meaningful volume. | Explicit service tier; no automatic paid retry after ambiguous dispatch; cost comparison; ordinary-language delayed status. |
| Batch API | High-volume offline evaluations or enrichment. | Pantheon has no volume that justifies a separate asynchronous provider path. | A stable dataset is large enough for material savings and does not require interactive tools or approvals. | Idempotent input manifest; result reconciliation; partial-failure handling; exact cost allocation. |
| Hosted trace graders and Evals API | Scale behavioral evaluation across representative production traces. | The first assurance dataset and rubrics need human calibration before hosted automation can be trusted. | Pantheon's local assurance suite is stable and manual review volume becomes a bottleneck. | Dataset/version parity; grader calibration; held-out results; cost cap; no autonomy from grader score alone. |
| Automated prompt optimization | Propose prompt or harness changes from traces and evaluations. | Optimization before trustworthy evals overfits noise and can weaken safety or commercial judgement. | The assurance suite predicts reviewed quality over several harness revisions. | Candidate branch only; held-out regression; Jarvis review; no automatic merge, deployment, authority, or policy change. |
| Automated Codex improvement handoff | Convert recurring trace failures into a developer-ready change proposal. | Useful only after failure classification and evaluation are dependable. | At least three recurring supported harness-level failures exist. | Evidence-linked proposal; scope and risk; focused tests; human/Jarvis code review. |
| Dynamic temporary specialists | A manager instantiates a venture-specific specialist from approved capabilities and closes it after work. | Fixed workers and contracts have not yet proved commercial results or cross-venture isolation. | Fixed-team work passes assurance, Venture Factory exists, and at least two structurally different kits need different compositions. | Approved templates only; capability, context, budget, and lifetime bounds; no recursive authority; cross-venture isolation tests. |
| Remote or cloud Pantheon runtime | Continue schedules and monitoring while the local PC is off. | Requires different identity, secrets, networking, deployment, recovery, and security boundaries. | Local Pantheon proves real commercial operation and continuous availability has measured value. | TLS; strong identity; secret manager; scoped credentials; remote shutdown; backups; monitoring; penetration test. |
| Mobile companion or ChatGPT App | Review Important Work, approve exact actions, and see portfolio status remotely. | The desktop workflow and remote security model must be stable first. It does not replace Pantheon's runtime. | Desktop operation is proven and remote control is approved. | Minimal read/decision surface; strong authentication; device loss and session expiry; CSRF/origin protections; audit and revocation. |

## Channel-Neutral Product Contract

When the next Venture Kit needs products, define one channel-neutral product
record before adding an OpenAI Commerce adapter. It should include:

- stable product and variant IDs;
- literal title and truthful description;
- exact included files or fulfilment;
- media and preview provenance;
- price, currency, fees, availability, and geography;
- seller, policy, support, and refund references;
- channel listing IDs and URLs; and
- attribution and outcome fields.

Etsy, Gumroad, Shopify, an owned site, OpenAI Commerce, and future channels then
become adapters over the same verified commercial record.

## Review Cadence

Jarvis reviews this register:

- when an investment case passes;
- when a Venture Kit identifies a missing capability;
- after a material provider or OpenAI API change;
- after three paid buyers and positive contribution;
- before remote, dynamic-team, or second-venture work; and
- at least quarterly while Pantheon is active.

Review means update the evidence, trigger, or status. It does not mean implement
every available capability.

# Jarvis v2 — Rebuild Blueprint
**Date:** 2026-07-03 (v2.2 — Foundation Charter added) · **Supersedes:** MASTER-PLAN.md v1.1
**Mandate (operator, 2026-07-02):** Full autopilot + guardrails · ROI-justified spend ·
all business models in scope · rebuild first, then relaunch ventures.

---

## 0. Foundation Charter (operator-set parameters, 2026-07-03 — the constitution)

**Mission.** An AI system that oversees and runs multiple online business ventures in
parallel — R&D, production, marketing, metrics, accounting/finance, compliance ops — with
the operator as owner/approver, not worker. Simple where possible; paid services adopted
when they pull weight, scaled with proven results. Never boxed into one model: the venture
pipeline evaluates ANY business idea against a standard feasibility framework.

**Pilot parameters (Claude Pro pilot — prove it, then scale):**
| Parameter | Setting |
|---|---|
| Success bar | **A$500+/month PROFIT sustained** → triggers Max upgrade + spend scaling |
| Pilot tool envelope | **A$50–150/month total**, each item operator-approved (Stage 1) |
| Venture pacing | **Staggered:** POD now → digital products (~2-3 wks) → promotion layer |
| Kill rule | **8 weeks** without traction → niche/family killed, effort reallocated |
| Operator time | **15–30 min/day, interactive** in-session review (mocks, spend, direction) |
| Identity | **Fully faceless** — every venture has its own brand persona; no real name/face |
| Compute | **Pro-only until revenue.** No API credits yet; design within session limits |
| Model routing | **Powerful models for foundation/strategy/critical QC** (worth hitting limits); cheap models reserved for bulk production tasks once pipelines are proven |
| IP posture | **Moderate:** generic styling, recognisable inspiration OK — but NEVER brand names, logos, badges; trademark screen per design family; takedown-response playbook; residual grey-zone risk accepted by operator |
| Legal status | **ABN not yet registered** — Human-Only task, must complete before first sale; compliance one-pager to be prepared (hobby-vs-business, GST at $75k, professional review flagged) |

**Existing paid assets (use before buying anything):** ChatGPT Plus (GPT image gen),
Gemini AI Pro (Veo video gen + image gen — covers early promotion-clip needs without
Higgsfield), Pinterest account, Claude Pro. EverBee status unknown — confirm or cancel
(cost hygiene). Operator open to new subscriptions with meaningful impact, inside envelope.

**Idea verdicts (operator's four, explored and challenged):**
1. **POD designs** — validated; Gelato→Etsy rail live. Watch: lowest margin of the four,
   taste risk (mitigated by Stage-1 human gate + low-subjectivity families), IP screens.
2. **Digital products** — strongest automation economics (no COGS, no fulfillment,
   near-100% margin); saturated market means research-driven niching is the whole game.
3. **Affiliate/UGC/clipping** — challenged and reshaped: standalone play is weak in AU
   today (no TikTok Shop AU; Creator Rewards bans AI content). Adopted as
   **promotion-first**: faceless Pinterest/IG brand accounts drive free traffic to our own
   listings; affiliate links layer onto those audiences once they exist.
4. **Other automatable ventures** — pipeline stays open; quarterly opportunity scan
   proposes candidates (Whop AI-native products, stock assets, micro-tools, etc.) through
   the same feasibility framework. No boxing in.

---

## 1. Design principles (learned the hard way)

1. **No human in the execution path.** The operator sets direction, vetoes, and does
   one-time account setups. Everything else runs without waiting.
2. **Safety via guardrails, not gates.** Hard limits + audit trail + rollback replace
   per-action approval.
3. **Token-frugal by default.** Single-context work; subagents only when isolation pays.
   The 25-agent review that died on plan limits is the cautionary tale.
4. **Cloud for schedules, local for builds.** Recurring ops run on Claude cloud Routines
   (PC can be off). Heavy build sessions stay local.
5. **Everything in git.** Every autonomous change is a commit — rollback + tamper-evident
   history for a legally accountable system (Australian Consumer Law liability is the
   operator's).
6. **Findings become tasks, not documents.** Anything flagged gets a tracked task and a
   routine that nags until closed.

## 2. Autonomy model v2.1 — STAGED (operator revision 2026-07-03)

Autonomy is earned, not granted. Three stages; promotion criteria are explicit and
data-driven. At every stage: research/design/drafting/internal work is fully autonomous.

**Stage 1 — Proving (NOW):**
- Every listing: operator sees final mock listing + product photos/assets and approves
  BEFORE publish. This doubles as the human-eye QC gate (anti-slop).
- Every rejection logged with reason → rule added to design briefs ("taste memory").
- Nearly all spend decisions: operator approves first (any new subscription, any credits
  purchase; only trivially small pre-agreed costs like a single listing fee are automatic).
- Daily digest regardless.

**Stage 2 — Trusted families (promotion when: ≥20 listings approved AND ≥90% first-pass
approval rate over the trailing 20):**
- Auto-publish within PROVEN design families (styles/niches with an approval track record);
  new families still gated.
- 24h veto-window replaces pre-approval for proven-family listings and price changes.
- Spend ≤ $20 AUD auto with digest log; larger spends still pre-approved.

**Stage 3 — Full autopilot (promotion when: Stage 2 runs ≥4 weeks with no operator
reversal and revenue is flowing):**
- Publish/price/promote autonomously with 24h veto-window.
- Financial decisions autonomous below threshold; defer only when high-value or important.

**Hard-Stop at every stage (never autonomous):** moving money, legal agreements, account
creation, supplier contracts, customer disputes, compliance determinations, cross-venture
pricing coordination (ACCC risk).

Standing guardrails regardless of level:
- Append-only `logs/external-actions.log` for every external action (kept from v1)
- Git commit per external action batch (what/why in message)
- Etsy AI-content disclosure applied per 2026 policy on every listing
- No CAPTCHAs bypassed, no ToS-violating browser automation; API-first always
- Kill switch: operator says "pause autopilot" → system reverts to v1 approve-mode

## 3. Target architecture

```
Operator (phone/email)
   ▲ daily digest + veto links        ▼ direction, vetoes, one-time setups
────────────────────────────────────────────────────────
CLOUD: Claude Routines (Pro plan, claude.ai Tasks)
   • Daily ops pulse (listings, orders, next actions)
   • Weekly: finance rollup + system health + task-nag
────────────────────────────────────────────────────────
LOCAL: Claude Code sessions (build + execute)
   • Product pipeline: research → design (image API) → copy → QC → PUBLISH (Etsy API)
   • POD fulfillment via Gelato/Printify API
   • Git-versioned workspace, hooks (kept from v1)
────────────────────────────────────────────────────────
STATE: git repo · memory/ summaries · decision-log · finance/
```

**Delivery model v2:** Gmail digest (already connected) replaces the for-review inbox as
the default channel. for-review/ survives only as the Hard-Stop exception queue.
Dashboard: retire the network server (security finding #3) unless rebuilt with
localhost-binding + auth; the digest + claude.ai mobile covers oversight.

## 4. Venture strategy (v2.1 — post channel research 2026-07-03)

**Etsy API correction:** operator confirms Etsy denied our API application. Publishing
rails that replace it (both official/ToS-safe — see
holding-company/reports/RESEARCH-channels-platforms-2026-07-03.md):
- **POD:** Gelato supplier-push into the connected Etsy shop (DONE: operator connected
  Gelato→Etsy 2026-07-03). Product creation drivable via Gelato's public API.
- **Digital downloads:** approved partner listing tools (Vela / Evlista / Listadum /
  BulkListingPro) — they hold their own Etsy API access. Test Evlista free tier first.
- Browser automation of Etsy: last resort only (account-ban risk).

**Track A — venture-01: POD (revive, first revenue).** Gelato rail is live today. Design
strategy per operator QC directive: bold/simple/striking, low-subjectivity families
(aesthetic car prints, minimalist typography, architecture/botanical line art) that
mass-produce reliably — NOT taste-heavy niche illustration. Nurse + pilates packs
(finished, QC-passed) publish first via Gelato after operator mock approval.

**Track B — venture-02: Digital products.** Planners, templates, trackers, wall art via
partner-tool rail. No COGS, no fulfillment. Add Whop as zero-cost second channel for
AI-native products (prompt packs/GPTs — allowed there, banned on Etsy).

**Track C — Promotion (support, then venture).** Short AI video clips (Higgsfield — has
MCP, Jarvis-drivable; ~$0.60–9 per usable clip) promoting our own listings on
Pinterest/Instagram. No monetization-policy exposure. A standalone UGC/TikTok-affiliate
venture is deferred: TikTok Shop not yet in Australia; Creator Rewards bans AI content;
watch-item on the weekly routine.

**Deferred:** Shopify (A$56/mo, brings zero traffic — revisit when a design family has
proven Etsy sales). TikTok Shop AU (not launched).

Shared pipeline: niche research (POS ≥ 60 stands) → design via image API (benchmark at
build time; $0.01–0.20/image) → copy + QC (incl. explicit slop-check) → operator mock
approval (Stage 1) → publish via rail → weekly performance review feeding kill/scale.

## 5. Build phases

**Phase 0 — Operator setup (mostly DONE 2026-07-03):**
1. ~~Etsy API~~ — CONFIRMED DENIED by Etsy (operator). Replaced by Gelato supplier-push +
   partner listing tools (see §4). Remove Etsy MCP server from .mcp.json in Phase 1.
2. ✅ Gelato account created and connected to Etsy shop (operator, 2026-07-03).
3. ✅ Autonomy: STAGED model adopted (§2) — Stage 1 = operator approves final mocks +
   nearly all spend. Digest via Gmail. Remaining confirm: Stage-3 spend threshold (later).
4. On claude.ai: confirm Tasks/routines available on current plan.
5. When digital track starts: sign up Evlista/Vela (free tier) and connect to Etsy shop.

**Phase 1 — Foundation (first build session):**
- `git init`, commit workspace, secrets audit (.gitignore already exists)
- Rewrite CLAUDE.md around autonomy model v2; delete dead instructions (Drive-sync)
- Tighten settings.json permissions; retire or secure dashboard server
- Config: single `config/guardrails.md` replaces the unbuilt 8-file plan

**Phase 2 — Autonomy engine (sessions 2-3):**
- Digest generator + veto tracking; external-actions logging extended
- Cloud routines created: daily pulse, weekly finance/health/task-nag
- Agents updated for autopilot delivery (add publisher duties; retire delivery-to-inbox)
- Task queue: audit findings 1-10 become tracked items

**Phase 3 — Revenue (sessions 3+):**
- Publish nurse + pilates packs via Etsy API (first autonomous listings)
- Launch venture-02 with first digital product batch (research-selected)
- Weekly performance loop live; ROI spend proposals begin (EverBee re-validation, image API credits)

## 6. Cost posture
Current: Claude plan + EverBee. New spend proposed per-item with ROI case (Hard-Stop above
$50 AUD). Expected additions: image-gen API credits (~$5-20/mo at launch volume),
Gelato COGS per sale (funded by revenue). Max-plan upgrade only when plan limits block
revenue work ≥2×/day — it's an ROI decision, not an aspiration.

## 7. Open verifications (do at build time, cheap)
- Etsy personal-app approval status for existing key; reapply if needed
- Image model benchmark (text-render vs artistic) before first design batch
- Realistic digital-download revenue ramp vs the $500-1k/3-6mo blog claims — validate
  against EverBee live data before setting targets
- claude.ai Tasks availability on operator's plan tier

## Sources (key)
- Managed Agents / scheduled deployments: platform.claude.com/docs/en/managed-agents/overview
- Routines on Pro+: mindstudio.ai/blog/claude-code-routines-scheduled-agents; tessl.io (routines announcement)
- Etsy API v3: developers.etsy.com/documentation; insightagent.app Etsy API guide (24-48h approval)
- Etsy AI policy 2026: etsy.com/seller-handbook/article/1275449912004; etsy.com/legal/creativity
- Digital products market: outfy.com, litcommerce.com, shopify.com/blog/sell-printables-etsy, merchtitans.com
- POD suppliers: printify.com/knowledge-hub/printify-vs-gelato-2026-strategic-guide; gelato.com/au/gelato-vs-printify
- Image APIs: digitalapplied.com AI image pricing comparison 2026; atlascloud.ai API guides

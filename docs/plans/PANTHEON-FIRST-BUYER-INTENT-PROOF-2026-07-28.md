# Pantheon First Buyer-Intent Proof

Date: 2026-07-28
Status: paused at needs_attention after developer audit
Owner: Daniel
Technical steward: Jarvis (Codex)

## Goal

Turn Pantheon's strongest parked commercial case into one genuine,
measurement-ready buyer-intent test without pretending the venture is
investable or building a speculative catalogue.

The goal ends when:

- one usable validation workbook and its truthful previews pass independent
  quality review;
- one clear test pack explains the buyer, offer, channel, price, measurement,
  pass, revise, inconclusive, and stop rules;
- Daniel can inspect the sample and approve, request changes, or deny the
  external test from one Business Tests drawer;
- the exact account, KYC, listing publication, customer contact, and spend
  actions remain protected; and
- Pantheon records a real result later without confusing reach failure with
  demand failure.

This phase does not create a full catalogue, activate an Etsy account, publish
a listing, contact a buyer, run ads, or claim commercial validation.

## Audit Hold

The 2026-07-28 developer audit found that one Quality Reviewer call ran under
the monthly internal mandate even though its exact decision packet required
Daniel's approval. No external action occurred, but the run invalidates this
workflow as a clean authorization proof.

Five incurred worker estimates total A$0.63. The latest reviewer returned
`revise` with two copy corrections, so the workflow remains
`needs_attention`. The plan may resume only after the audit branch and private
CI pass and Daniel explicitly authorizes the one remaining bounded correction.
No fourth-review override, silent paid retry, or model fallback is permitted.

## Commercial Case

The retained case is the Social Media Manager Client-Control and Profitability
System.

- Buyer: freelance social media managers serving two or more retained clients.
- Problem: intake, approvals, scope changes, delivery proof, and per-client
  profitability are fragmented across messages, generic templates, and
  separate tools.
- Validation offer: one editable Excel workbook linking those records, with
  sample data, a setup guide, and previews derived from the actual workbook.
- Test price: A$29.95.
- Primary channel: one Etsy Australia digital listing.
- Channel reason: Pantheon's current evidence shows attributable adjacent
  marketplace purchase signals, visible competing listings, and measurable
  listing statistics. Etsy is a test channel, not a permanent platform
  commitment.
- Missing proof: willingness to pay for the exact integrated Excel offer,
  format acceptance, acquisition cost, support and refund load, production
  effort, and realised all-in contribution.

The investment case remains parked. A validation asset is evidence-gathering
infrastructure, not a production or scale decision.

## Exact Test

Use a single active listing so Etsy shop visits can be attributed to this test
without mixing traffic from other products.

- Exposure: up to 100 Etsy Shop Stats visits or 30 calendar days.
- Qualified exposure: Etsy-reported visits while the validation listing is the
  only active listing, excluding Daniel or Jarvis test visits and accepting
  Etsy's final bot filtering.
- Primary outcome: completed independent paid orders.
- Secondary signals: listing favourites and genuine buyer enquiries. These may
  justify revision but cannot pass the investment gate.
- Pass: at least 3 independent paid orders from no more than 100 qualified
  visits, no format- or clarity-driven refund, and at least A$10 actual net cash
  contribution per completed order after platform fees, refunds, listing
  costs, attributed AI/tool costs, and other attributable cash costs.
- Revise: 1-2 orders, or at least 5 genuine favourites or enquiries with a
  coherent objection that can be tested by changing one variable.
- Inconclusive: fewer than 100 qualified visits after 30 days. Diagnose title,
  tags, preview, search placement, and channel reach before judging demand.
- Stop: 100 qualified visits produce zero orders and fewer than 5 genuine
  interest signals; repeated buyers reject Excel as the required format; a
  format or clarity defect causes a refund; or actual net cash contribution is
  non-positive.

The qualification question for voluntarily received buyer feedback is:

> Is the linked client-control workflow useful enough to buy at A$29.95, and if
> not, is the blocker the Excel format, the promised outcome, the price, or a
> missing function?

Pantheon must not send that question automatically.

## Architecture

Add a reusable pre-venture `BuyerIntentValidation` contract. Venture-specific
facts remain in a versioned validation specification. Generic runtime code may
not assume Etsy, Excel, this buyer, or this price.

Preparation will:

1. validate the exact commercial decision hash and opportunity;
2. create an idempotent validation workflow, brief, exact candidate, and ready
   experiment under the Portfolio workspace;
3. create one validation-sample catalogue plan rather than a full catalogue;
4. queue one bounded Luna Product Builder run;
5. render, open, hash, and retain the workbook, guide, manifest, bundle, and
   previews using Pantheon's local deterministic product factory;
6. queue one bounded Terra Quality Reviewer run against the exact retained
   files and previews;
7. stop after one product correction if the corrected sample still fails; and
8. convert a quality-passed sample into one execution pack and Chief of Staff
   decision rather than entering the full launch-copy pipeline.

Pantheon remains authoritative for state, approvals, costs, files, attempts,
and results. Agents design and review the bounded sample; they cannot publish
or change the investment decision.

## Cost And Authority

- Combined Product Builder and Quality Reviewer exposure: maximum A$3.
- Listing-related external spend: maximum A$1, only after a separate operator
  decision.
- Etsy setup fees, subscriptions, advertising, Offsite Ads decisions, account
  creation, KYC, legal terms, and any charge outside the listing allowance
  require a new exact decision.
- Platform transaction and processing fees are recorded from actual receipts
  or exports after a sale. Estimates are never shown as settled cost.
- No model fallback, automatic paid retry, or silent public action is allowed.

## Operator Experience

Business Tests will show:

- the one active validation test;
- the exact buyer, sample, price, channel, and exposure;
- the sample workbook, setup guide, truthful previews, and downloadable bundle;
- what passing, revision, inconclusive reach, and stopping mean;
- the internal AI work and estimated AUD cost; and
- one decision: approve this exact market test, request changes, or deny it.

Approving the test pack records authority for this exact design. It does not
create an Etsy account, accept terms, pay a setup fee, publish, contact a buyer,
or start advertising.

## Verification

- Decision-hash, idempotency, stale-case, wrong-opportunity, duplicate-click,
  sample-file, formula, preview, quality-failure, correction-limit, external
  action, and result-classification tests pass.
- Existing commercial and production tests remain green.
- The complete isolated Node suite, lint, dependency audit, Doctor, encrypted
  recovery, and private GitHub CI pass.
- A real browser at 1440x900, 1280x720, and 1024x768 can open Business Tests,
  inspect every sample output, understand the measurement rules, and reach the
  one decision without console errors or horizontal overflow.
- The bounded live Product Builder and Quality Reviewer calls return known
  outcomes under A$3, or Pantheon stops truthfully with no external action.

## Next Gate

After Daniel separately completes any required Etsy account and KYC action,
Pantheon may prepare the exact listing publication action. The investment case
reopens only after the recorded cohort meets the pass rule.

# 0008 - Buyer Intent Before A Full Catalogue

Date: 2026-07-28
Status: accepted

## Context

Pantheon has one parked case that passed 9 of 10 commercial requirements. Its
remaining failure is economics: adjacent demand and provisional fee-only
contribution exist, but willingness to pay for the exact Excel offer, format
acceptance, acquisition cost, support load, refunds, build effort, and realised
contribution do not.

Building a complete catalogue would spend time before resolving that
decision-critical gap. Doing nothing would preserve cash but leave the
strongest current case untested.

## Decision

Build one genuine functional validation sample and prepare one
measurement-ready buyer-intent test before authorising a full catalogue.

Pantheon will:

- keep the investment case parked;
- use one bounded Product Builder run and one independent Quality Reviewer run;
- render and verify the exact customer files locally;
- expose one concise operator decision;
- keep account work, publication, contact, and external spend separate; and
- reopen investment only after attributable paid orders and actual
  contribution meet the recorded rule.

The runtime mechanism is reusable. Etsy, Excel, the buyer, price, and product
fields belong to a versioned validation specification rather than Pantheon's
generic kernel.

## Options Considered

### Build the full digital-product catalogue

Rejected. The missing evidence concerns the exact offer and format. More
products do not resolve that uncertainty and create sunk-cost pressure.

### Run a survey or collect search interest only

Rejected as the primary gate. Stated preference and search activity may improve
copy but cannot replace a paid buyer-intent signal.

### Publish a placeholder or mockup without a working file

Rejected. Pantheon must not test willingness to pay for something it cannot
truthfully deliver.

### Prepare one functional sample and measured listing test

Accepted. It is the smallest action that can test buyer intent, delivery
format, listing conversion, refunds, support, and real contribution together.

## Consequences

- The sample is production-quality enough to fulfil initial orders but is not
  represented as the eventual full product range.
- A reach failure remains distinct from a demand failure.
- Favourites and enquiries can justify revision but cannot pass the investment
  gate.
- One quality correction is permitted; a second material failure stops the
  sample.
- A passed cohort may justify a complete Venture Kit and catalogue. It does not
  prove repeatable product-market fit or authorise scale automatically.

## Review Trigger

Review this decision after:

- the first 100 qualified visits or 30-day cohort;
- three independent paid orders;
- any format- or clarity-driven refund;
- actual contribution is reconciled;
- Etsy cannot provide the required attribution or materially changes its
  seller rules; or
- another channel becomes demonstrably cheaper and more measurable.

# Gumroad Launch Gate

Last checked: 2026-07-14

## Purpose

Gumroad Direct is the first checkout and fulfilment route for the sole active
digital-product venture. Daniel may complete private identity and payout checks,
but the public product, brand, images, audio and video must remain faceless and
voiceless.

## Current Platform Facts

- Direct-link sales currently use Gumroad's published transaction fee plus
  payment processing. Discover sales use a higher platform fee. Recheck the
  live fee page immediately before pricing and publishing:
  https://gumroad.com/help/article/66-gumroads-fees
- Gumroad currently acts as Merchant of Record for applicable indirect taxes.
  Recheck the tax-handling page before launch:
  https://gumroad.com/help/article/121-sales-tax-on-gumroad
- The sales dashboard supports CSV export with purchase, item, date, price, fee,
  net, referrer, refund and dispute fields. Recheck the export help page before
  the first import:
  https://gumroad.com/help/article/74-the-analytics-dashboard

Jarvis does not estimate platform fees as actual spend. The results importer
uses the fee and net values in the platform export and keeps their status as
platform-reported commercial evidence.

## Publish Pack Must Contain

- final product files and a plain-language contents check;
- buyer, problem, offer, price and contribution assumptions;
- listing title, description, preview assets and claim review;
- Gumroad Direct URL and fulfilment settings to be created by Daniel;
- at most three proposed organic posts across at most two evidence-selected
  channels;
- the 14-day or 50-qualified-view measurement rule;
- the three-independent-buyer and positive-cash-contribution success rule;
- the zero-sale stop rule and the optional A$25 paid-test decision;
- a private KYC reminder that contains no identity document or personal detail.

## Hard Stops

Jarvis must not create the Gumroad account, submit identity checks, publish the
product, contact customers, post publicly or initiate spend without Daniel's
action-time confirmation. A previewed Publish Pack does not count as approval
for any of those actions.

## Results Import

The first measurement path is an operator-selected Gumroad CSV. Imports are
idempotent by Purchase ID. Jarvis retains only the commercial fields needed for
revenue, fees, refunds, contribution and channel learning. Buyer email is HMAC
hashed with `JARVIS_PRIVACY_HASH_KEY`; names, raw email, review text and raw CSV
are not retained.

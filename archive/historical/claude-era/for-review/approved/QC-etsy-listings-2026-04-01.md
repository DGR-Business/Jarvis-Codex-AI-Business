# Quality Check Report — Etsy Listing Copy
**File reviewed:** `C:\ai-workspace\ventures\venture-01-pod-store\outputs\COPY-etsy-listings-2026-04-01.md`
**Date:** 2026-04-02
**Reviewer:** Quality-checker agent
**Venture:** venture-01-pod-store (POD Store — Nurse Humour Apparel and Drinkware)

---

## Pre-Check: Etsy AI Disclosure Rule

**IMPORTANT — applies to all three listings.**
Per `docs/operating-procedures.md`, Etsy requires AI-generated designs to be disclosed in listings (rule active since June 2025). The BRIEF confirms this venture uses AI-assisted design workflow. None of the three listing descriptions contain an AI disclosure statement. This must be resolved before any listing goes live — missing disclosure risks listing removal.

Recommended fix: add a single line to each description, e.g.:
"Design created with AI assistance."
Placement: end of description, after the care/sizing notes.

---

## Listing 1 — Night Shift Nurse Crewneck Sweatshirt

```
VERDICT: CONDITIONAL PASS
```

### BLOCKING ISSUES (must fix before publish)

- **Etsy AI disclosure** → Missing AI-generated design disclosure (see pre-check above) → Add disclosure line to description

- **Prohibited phrase check — "RN" in title** → "RN" appears in the title as an all-uppercase abbreviation. Etsy's no-ALL-CAPS rule targets promotional emphasis words (e.g. "AMAZING", "FREE"), and "RN" is a standard credential abbreviation. However, Etsy's automated listing review tools can flag any all-caps string. This is low risk but not zero risk. → Decision point for operator: leave as-is (common practice among top Etsy POD sellers in this niche) or expand to "Registered Nurse" to eliminate any flag risk. Not an auto-fail — operator to decide.

- **Price not justified in copy** → The sweatshirt is listed at $70 AUD (per BRIEF). The description does not address price at any point. For a $70 item, buyers who arrive without a strong intent to buy will hesitate. The copy is good, but it does not give a reason to feel the price is reasonable. → Suggested fix: Add one line after the "What you're getting" block, e.g.: "At $70, this is a proper garment — not a thin novelty shirt that goes to the charity bin after two washes. Gildan 18000 is one of the most-worn blanks in the industry for a reason."

### NON-BLOCKING NOTES (recommended improvements)

- **Gifting occasions** → The description mentions "Makes a genuinely good gift for a night shift nurse" but does not name specific occasions. Nurses Week (first week of May), Christmas, and Secret Santa are high-traffic Etsy search moments. → Suggested fix: Add to bullet points or description: "Popular for Nurses Week (first week of May), Christmas, Secret Santa."

- **"dark humor nurse" tag (Listing 1, tag 8)** → Uses American English "humor" while the description uses Australian English "humour" (tag 7: "nurse humour"). Mixed spelling within the same listing's tags looks inconsistent. → Operator to decide on a consistent approach. If targeting US buyers primarily, standardise to "humor" throughout tags. If targeting mixed, keeping both increases search coverage — this is actually a common Etsy strategy. Flag for decision, not an auto-fix.

- **Tag: "funny RN shirt" (tag 12)** → The product is a sweatshirt, not a shirt. Buyers searching "funny RN shirt" and landing on a sweatshirt listing may feel misled, even though the title is accurate. Low legal risk but could increase bounce rate. → Consider replacing with "nurse crewneck gift" or similar on-product tag.

### LEGAL FLAGS (require human review)

- None beyond the AI disclosure issue noted above.

### PLATFORM RULES VERIFICATION

| Rule | Result |
|------|--------|
| Title ≤ 140 characters | PASS — 90 characters |
| No ALL CAPS words | BORDERLINE — "RN" is a credential abbreviation, see blocking issues |
| 13 tags exactly | PASS — 13 tags confirmed |
| All tags ≤ 20 characters | PASS — longest tag "funny nurse crewneck" is 19 characters |
| No prohibited phrases ("POD", "print on demand", "AI-generated", "dropship") | PASS — none found |
| No medical claims | PASS |

### OVERALL ASSESSMENT
The copy is strong. It has a clear voice, genuine humour angle specific to night-shift nurses, and accurate garment specs. The $70 price point is not addressed and should be — this is the one gap that could cost conversions. Conditional pass pending AI disclosure addition and operator decision on price justification copy.

---

## Listing 2 — Sarcastic Nurse Coffee Mug (11oz)

```
VERDICT: CONDITIONAL PASS
```

### BLOCKING ISSUES (must fix before publish)

- **Etsy AI disclosure** → Missing AI-generated design disclosure (see pre-check above) → Add disclosure line to description

- **"Needle Licence" spelling — decision required** → The title and description use Australian English "Licence". The Etsy marketplace is predominantly US buyers. A US buyer searching for this product will type "needle license" — the listing will not surface for that search term. More importantly, if a US buyer sees "Licence" in the title, some may read it as a typo and lose confidence in the seller. This is not just a style preference — it has direct SEO and trust implications. → Operator must decide: (a) use "License" throughout for US market reach, (b) use "Licence" if targeting Australian buyers primarily, or (c) include both spellings across title, description, and tags to cover both markets (note: this looks odd in a single title but can work in description body). This decision should be logged in `holding-company/decision-log.md` as it affects all future mug listings.

- **"Ships in protective packaging" bullet point** → The bullet states "Ships in protective packaging — designed to arrive intact." This is a fulfilment claim. In a POD model, the operator does not control packaging — the fulfilment partner does. If a mug arrives broken and the buyer references this claim, there is an ACL exposure risk (false representation about the product/service, s29). → Remove or replace with: "Fulfilled by a professional print and ship partner — mugs are packaged for safe delivery." This shifts the claim to the partner and is accurate.

### NON-BLOCKING NOTES (recommended improvements)

- **Petrol station reference** → "Anyone can give a nurse a generic 'you've got this' mug from a petrol station." This is Australian phrasing ("petrol station" vs US "gas station"). Charming for an Australian or UK buyer; slightly odd for a US buyer. Low risk — most US buyers will understand it — but worth noting if the store skews US.

- **"$33" price anchor** → "...and this is $33" — this assumes USD pricing. If the store lists in AUD, this will be wrong. If in USD, confirm this is the intended price before the listing goes live. Do not publish with an incorrect price anchor in the copy.

- **Tag "nurse humor mug" (tag 7)** → Uses American "humor". The description uses Australian "licence". Mixed language signals within a single listing. Again: operator to decide on a consistent approach for the store.

### LEGAL FLAGS (require human review)

- **"Ships in protective packaging" claim** → As noted in blocking issues — this is an ACL s29 concern (false representation about services) in a POD context. Operator to review and amend before publish.

- **"Coffee: Because Stabbing People is Frowned Upon"** → This is well-established nurse dark humour and widely understood as a joke. It is not a threat. No legal flag raised — noting it was assessed and cleared.

### PLATFORM RULES VERIFICATION

| Rule | Result |
|------|--------|
| Title ≤ 140 characters | PASS — 92 characters |
| No ALL CAPS words | BORDERLINE — "RN" credential abbreviation, same as Listing 1 |
| 13 tags exactly | PASS — 13 tags confirmed |
| All tags ≤ 20 characters | PASS — longest tag "sarcastic nurse gift" is 19 characters |
| No prohibited phrases | PASS — none found |
| No medical claims | PASS |

### OVERALL ASSESSMENT
The mug copy is the best-written of the three listings. The humour explanation ("That's what makes it a nurse joke and not just a general cranky-person joke") is exactly right — it treats the buyer as intelligent and explains the specificity of the product. Two items need resolution before publish: the AI disclosure, and the shipping claim which creates ACL exposure. The "Needle Licence/License" spelling is a genuine business decision the operator must make and log.

---

## Listing 3 — NICU Nurse T-Shirt (Comfort Colors 1717)

```
VERDICT: CONDITIONAL PASS
```

### BLOCKING ISSUES (must fix before publish)

- **Etsy AI disclosure** → Missing AI-generated design disclosure (see pre-check above) → Add disclosure line to description

- **"NICU" in title — ALL CAPS flag** → "NICU" (Neonatal Intensive Care Unit) is a standard medical unit abbreviation used universally in healthcare. Like "RN", it is not promotional emphasis. However, Etsy's automated systems may flag it. The operator should be aware this is a possible (not certain) friction point. In practice, thousands of Etsy listings use "NICU" in titles without issue — this is low risk. → Decision point: leave as-is (recommended — "NICU" is the buyer's search term and removing it would damage SEO) or spell out as "Neonatal ICU Nurse Shirt" (loses the direct match). Recommend leaving as-is, but operator to make the call.

- **Price not addressed — $45 tee** → At $45, this is a premium price point for a t-shirt. The copy does explain why Comfort Colors 1717 is the right blank (garment-dyed, pre-shrunk, broken-in feel), which partially justifies price through quality cues. However, the copy never directly names the price or frames value. → Suggested fix: one line after the "What you're getting" block: "At $45, you're paying for the blank as much as the print — Comfort Colors is the preferred choice of independent sellers for a reason."

### NON-BLOCKING NOTES (recommended improvements)

- **Gifting occasions** → Nurses Week is mentioned in the tags but not in the description body. NICU nurses are a specific sub-group — gift buyers searching for NICU nurse gifts are highly motivated. → Suggested fix: add "Makes a thoughtful gift for Nurses Week (first week of May), NICU nurse graduations, or Secret Santa" to the description.

- **"Comfort Colors nurse" tag** → This is a valid search term (buyers who specifically want Comfort Colors do search for it). However, "Comfort Colors" is a trademarked brand name. Using a brand trademark in Etsy tags is generally permitted under Etsy's policy (nominating the product accurately), but operators should be aware this could theoretically be challenged if Comfort Colors objects. Current Etsy practice across the platform treats this as acceptable. Low risk — noting for awareness.

- **"NICU sweatshirt" tag (tag 12)** → The product is a t-shirt, not a sweatshirt. Same issue as Listing 1's "funny RN shirt" tag. A buyer searching "NICU sweatshirt" who lands on a tee listing may feel misled. → Replace with "NICU nurse tshirt" or "NICU gift nurse" to stay on-product.

- **Description opens with a long paragraph** → The opening paragraph (NICU nurses occupy a specific corner...) is 65 words before the buyer gets any product information. On mobile (most Etsy traffic), this may push key information below the fold. The writing is good, but consider shortening the opener to 2–3 sentences and moving the product name or phrase earlier. Non-blocking — the copy is not bad, just slightly slow to hook.

### LEGAL FLAGS (require human review)

- None.

### PLATFORM RULES VERIFICATION

| Rule | Result |
|------|--------|
| Title ≤ 140 characters | PASS — 94 characters |
| No ALL CAPS words | BORDERLINE — "NICU" is a standard medical abbreviation, see blocking issues |
| 13 tags exactly | PASS — 13 tags confirmed |
| All tags ≤ 20 characters | PASS — longest tag "neonatal nurse tee" is 18 characters, "Comfort Colors nurse" is 19 characters |
| No prohibited phrases | PASS — none found |
| No medical claims | PASS |

### OVERALL ASSESSMENT
The NICU listing is well-targeted and the Comfort Colors product details are handled correctly. The voice is genuine and the humour angle is specific to NICU rather than generic nurse copy. The "NICU sweatshirt" tag is a mismatch that should be fixed before publish. Price justification is partially handled but could be stronger. Conditional pass pending AI disclosure and tag fix.

---

## Cross-Listing Issues

The following issues apply to the batch as a whole:

1. **AI disclosure missing from all three listings** — this is the single most urgent issue. It is a platform rule violation that risks listing removal. All three listings must include disclosure before going live.

2. **"Ships in protective packaging" claim (Listing 2 only)** — ACL exposure in a POD context. Fix before publish.

3. **Spelling consistency: "humour/humor" and "licence/license"** — the store needs a documented position on Australian vs American English. This is a strategic decision, not a copy error. Once decided, it should be applied consistently across all future listings. Suggested entry for `decision-log.md`: "English variant for Etsy copy — AUS or US?"

4. **No unverifiable superlatives found** — no "best on Etsy", "number one", "clinically proven", or similar claims detected across all three listings. Good.

5. **No copyrighted phrases detected** — all three product phrases appear original. No song lyrics, no trademarked slogans identified.

6. **No prohibited Etsy phrases detected** — "AI-generated", "print on demand", "POD", and "dropship" do not appear in any listing copy.

---

## Overall Pipeline Verdict

```
REVISIONS NEEDED
```

All three listings are well-written and would not embarrass the brand. The voice is consistent, the humour is specific to nurses (not generic), garment specs are present and accurate, and gifting use cases are partially covered. The copy does not sound AI-generated.

However, all three listings are missing mandatory Etsy AI disclosure (platform rule, not optional), Listing 2 contains an ACL-risky shipping claim, and the "Needle Licence/License" spelling requires a documented operator decision before the mug listing can be finalised. These are not cosmetic issues — they must be resolved before any listing goes live.

Once the AI disclosure is added and the Listing 2 shipping claim is fixed, all three listings could reach PASS with minor adjustments. The fixes are small. This batch is close.

**Operator actions required:**
1. Decide on AI disclosure wording and add to all three listings
2. Fix Listing 2 bullet point: remove or rewrite the "Ships in protective packaging" claim
3. Decide: "Needle Licence" vs "Needle License" — log the decision in `holding-company/decision-log.md`
4. Decide: "RN" and "NICU" in titles — leave as-is (recommended) or expand
5. Optional but recommended: add price justification copy to Listings 1 and 3

---
*Report generated by quality-checker agent | 2026-04-02*

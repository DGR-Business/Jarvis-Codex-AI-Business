---
name: market-research
description: Comprehensive POD market research workflow — from trend discovery to product opportunity scoring
type: workflow
---

# Market Research Skill

## When to Use
- Before entering any new niche
- When evaluating product ideas from IDEAS.md
- During scheduled strategic pulse (weekly)
- When operator requests market analysis

## 5-Phase Workflow

### Phase 1: Trend Discovery (Auto)
1. WebSearch for "Etsy trending niches [current month] [current year]"
2. WebSearch for "print on demand bestsellers [current year]"
3. WebSearch for "POD niche ideas Reddit" (recent posts)
4. Check Google Trends for candidate keywords
5. Save raw findings to `ventures/[venture]/research/trend-scan-[date].md`

### Phase 2: Niche Validation (Auto)
For each candidate niche (max 5):
1. WebSearch for "[niche] Etsy" — count results, note price range
2. WebSearch for "[niche] print on demand" — check supplier availability
3. Check Google Trends for search trajectory (rising/stable/declining)
4. Rate demand as HIGH/MEDIUM/LOW
5. Rate competition as HIGH/MEDIUM/LOW

### Phase 3: Product Opportunity Scoring (Auto)
Apply POS matrix from researcher agent methodology.
Only proceed with niches scoring 60+/100.

### Phase 3.5: IP / Trademark Screen (MANDATORY — config/guardrails.md)
Search key phrases + style descriptors against USPTO TESS and IP Australia.
Record IP risk level (LOW/MODERATE/HIGH) in the report. HIGH = do not recommend.

### Phase 4: Competitive Deep-Dive (Auto + Browser)
**Free tool stack (2026-07-03 — no paid subs; propose paid only when a free-tier limit
actually blocks a decision, with ROI case + exit condition):**
1. **eRank free tier** (erank.com — best free option: keyword research, listing audits,
   rank data) — primary keyword/SEO source, via Claude-in-Chrome
2. **EverBee free plan** (20 searches/month — product revenue intelligence) — spend the
   20 on the highest-stakes revenue validations only
3. **Alura free** (5 searches/day per tool) — cross-check
4. Manual Etsy browsing via Claude-in-Chrome: reviews, favorites, listing age, tags,
   bestseller badges (read-only)
Then: document top 5 competitors per niche, identify positioning gaps.

### Phase 5: Margin Analysis (Auto)
For each product type in top niches:
1. Use LIVE Gelato base costs (our connected provider — dashboard/catalog), not generic ranges
2. Calculate: sell price - base cost - Etsy fees (6.5% transaction + 3% + $0.25 payment + $0.20 listing) - shipping
3. GST: we are NOT registered (sole trader below threshold) — no GST on our prices;
   Etsy remits marketplace GST itself where applicable
4. Rank products by margin %

## Output
Save complete research report using researcher agent's standard template to:
1. `ventures/[venture]/outputs/RESEARCH-market-[niche]-[date].md`
2. `for-review/RESEARCH-market-[niche]-[date].md`
3. Update `for-review/review-status.json`

## Quality Gate
Research reports go through quality-checker agent before delivery.

# EverBee Replacement / Supplement Research
**Date:** 2026-04-03 | **Status:** For operator review

---

## Executive Summary

EverBee has no public API and no MCP server. Three viable paths exist:

1. **Best zero-cost:** Claude-in-Chrome reads EverBee's DOM overlays directly from Etsy pages — gives identical data for $0 extra
2. **Best API:** EcomScrapy (EtsyHunt's API) — historical revenue + sales estimates at $3.99-$19.99/mo
3. **Best free proxy:** Etsy API v3 (free) — favorites, views, listing age as proxy signals

---

## Option 1: Claude-in-Chrome + EverBee DOM Bridge (RECOMMENDED — $0)

**How it works:**
- EverBee injects revenue/sales overlays onto Etsy search pages as DOM elements
- Claude-in-Chrome's `javascript_tool` can execute JS to read those injected elements
- Gives identical EverBee data inside the agent pipeline

**Setup required:**
1. Navigate to Etsy search page with EverBee active in Chrome
2. Right-click an EverBee overlay → Inspect → note class names / data attributes
3. Document the DOM selectors for the researcher agent prompt

**Caveats:**
- Chrome must be open with EverBee installed
- EverBee DOM structure could change on extension updates
- Build a discovery step that re-identifies elements if selectors fail

---

## Option 2: EcomScrapy API (EtsyHunt) — $3.99-$19.99/mo

- **Data:** 45M+ listings, historical revenue + sales estimates, 20+ filters, daily updates
- **Integration:** REST API — callable from Python/Node or wrappable as MCP tool
- **Cost:** Free plan available. Basic $3.99/mo, Pro $19.99/mo
- **Vs EverBee:** Closest programmatic replacement. Same core metrics.
- **Link:** ehunt.ai/ecomscrapy-etsyhunt-en

---

## Option 3: Etsy API v3 (FREE)

**Available without OAuth (public read-only):**
- `num_favorers` (favorites per listing)
- `views` (lifetime views)
- Listing creation date, price, quantity
- Shop details (name, review count, total sales)
- Search across all active listings
- Tags, categories, images

**Not available:** Revenue estimates, sales per listing, search volume

**Rate limits:** 10 req/sec, 10,000 req/day free

**Proxy signals:** High favorites + recent listing date = strong demand. Combined with review velocity, builds reasonable competition proxy.

---

## Option 4: Firecrawl MCP (FREE tier)

- Scrape public Etsy pages for visible data: title, price, reviews, favorites, sales count, listing date
- Free tier: 500 pages/month
- Cannot provide revenue estimates

---

## Option 5: Apify Etsy Scraper (FREE tier)

- $5/month in free credits = ~1,000 listings scraped
- Extracts: name, URL, images, seller info, price, favorites, reviews, listing date
- No revenue estimates

---

## Options NOT Viable

| Tool | Why |
|------|-----|
| EverBee API | Does not exist |
| EverBee MCP | Does not exist |
| eRank API | Does not exist |
| Marmalead API | Does not exist |
| Sale Samurai API | Does not exist |
| Alura API | Waitlist only, pricing unknown |

---

## Recommended Architecture

**Tier 1 (Now — $0):** Claude-in-Chrome + EverBee DOM bridge
**Tier 2 (Now — $0):** Register free Etsy API v3 key for structured public data
**Tier 3 (If needed — $3.99/mo):** EcomScrapy for headless automation without Chrome

---

## Next Steps

1. Inspect EverBee DOM elements on one Etsy search page (5 min manual task)
2. Register free Etsy API v3 key at developers.etsy.com
3. Test Claude-in-Chrome extraction in a live session
4. If Chrome bridge works reliably → document in researcher agent prompt

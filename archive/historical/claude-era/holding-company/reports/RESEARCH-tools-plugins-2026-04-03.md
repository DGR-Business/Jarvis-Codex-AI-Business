# Tool & Integration Research Report
## AI Business OS — Claude Code Stack Expansion
**Date:** 2026-04-03 | **Status:** For operator review

---

## Top Recommendations (All Free)

| Priority | Tool | What It Does | Install Command | Impact |
|----------|------|-------------|-----------------|--------|
| 1 | Brave Search MCP | Real-time web search for all agents | `npx @modelcontextprotocol/server-brave-search` | HIGH |
| 2 | Firecrawl MCP | Web scraping, structured extraction | `npx -y firecrawl-mcp` | HIGH |
| 3 | MCP Memory Server | Persistent knowledge graph across sessions | `npx @modelcontextprotocol/server-memory` | HIGH |
| 4 | Jina Reader MCP | Clean page-to-markdown conversion | Jina AI Remote MCP | HIGH |
| 5 | Replicate MCP | Image generation (FLUX models, $0.003/img) | `npx -y replicate-mcp@alpha` | HIGH |
| 6 | Nano Banana MCP | Gemini image gen (500 free/day, 4K native) | `npx -y @ycse/nanobanana-mcp` | HIGH |
| 7 | SQLite MCP | Structured data for research accumulation | `npx @modelcontextprotocol/server-sqlite` | MED-HIGH |
| 8 | Gemini CLI | Token overflow — 1000 free req/day | `npm install -g @google/gemini-cli` | MED-HIGH |
| 9 | Real-ESRGAN CLI | Automated image upscaling (local) | Binary download | HIGH |
| 10 | Printify MCP | POD automation — design to listing | GitHub install | HIGH |

---

## Category 1 — Web Scrapers & Content Fetchers

### Brave Search MCP
- **What:** Real-time web search (web, news, images) via Brave Search API
- **Cost:** FREE — 2,000 queries/month, no credit card
- **Install:** `npx @modelcontextprotocol/server-brave-search` + free API key from brave.com/search/api
- **Why:** Gives all 9 agents real-time data without burning Claude Pro's built-in search

### Firecrawl MCP
- **What:** Turns any website into clean LLM-ready Markdown or structured JSON
- **Cost:** FREE tier — 500 pages/month, no credit card
- **Install:** `npx -y firecrawl-mcp` + free API key from firecrawl.dev
- **Why:** Essential for researcher agent pulling Etsy competitor data at scale

### Jina Reader MCP
- **What:** Prepend `https://r.jina.ai/` to any URL for clean markdown. MCP wraps this.
- **Cost:** FREE — 10M token credits on signup, 500 req/minute
- **Install:** Jina AI Remote MCP from github.com/jina-ai/MCP
- **Why:** Quick single-page reads (competitor listings, supplier pages)

### Playwright MCP (Microsoft)
- **What:** Full browser automation via accessibility tree — navigate, click, fill, screenshot
- **Cost:** FREE (open source)
- **Install:** `claude mcp add playwright npx @playwright/mcp@latest`
- **Why:** Access Etsy-authenticated pages, complex JS sites. Token-heavy — use sparingly.

### Crawl4AI
- **What:** Open-source Python web crawler for AI pipelines
- **Cost:** FREE (Apache 2.0)
- **Install:** `pip install crawl4ai`
- **Why:** Better than Firecrawl for large-scale batch crawls

---

## Category 2 — Token Optimisers

### Custom Compaction Prompt
- **What:** Override default context compaction in settings.json to preserve critical content
- **Cost:** Free config change
- **Action:** Add `compactCustomSummaryPrompt` to settings.json

### /compact Discipline
- **What:** Manually trigger compaction at ~70% context before automatic 95% trigger
- **Action:** Run `/compact` before switching major tasks in long sessions

### Gemini CLI as Overflow
- **What:** Google's terminal AI — 1,000 free req/day, 1M token context
- **Cost:** FREE
- **Install:** `npm install -g @google/gemini-cli`
- **Use for:** Long-context research that would exhaust Claude Pro budget

### Ollama (Local LLM)
- **What:** Run open-source LLMs on RTX 3080 Ti. Zero ongoing cost.
- **Cost:** FREE (electricity only)
- **Install:** ollama.com Windows installer
- **Models:** qwen2.5-coder:7b (fast), qwen3-coder:14b (better quality)
- **Use for:** Bulk text processing, simple drafting. Not customer-facing content.

---

## Category 3 — Knowledge & Intelligence Expanders

### MCP Memory Server (Knowledge Graph)
- **What:** Persistent entity/relationship memory across sessions. Local JSON storage.
- **Cost:** FREE (MIT, official Anthropic)
- **Install:** `npx @modelcontextprotocol/server-memory`
- **Why:** Complements session-summary files with searchable relational memory

### SQLite MCP
- **What:** Direct SQL database access from Claude. Store structured research data.
- **Cost:** FREE (official Anthropic)
- **Install:** `npx @modelcontextprotocol/server-sqlite --db-path /path/to/db.sqlite`
- **Why:** As research accumulates, SQLite > flat markdown files for querying

### Chroma Vector Database (Phase 2+)
- **What:** Local RAG — semantic search over your documents
- **Cost:** FREE (Apache 2.0)
- **Install:** `pip install chromadb` or Docker
- **When:** Once you have 50+ research outputs

---

## Category 4 — Image Tools (RTX 3080 Ti)

### ComfyUI + FLUX.2
- **What:** Local AI image generation. Production-grade. Zero per-image cost.
- **Cost:** FREE (open source + electricity)
- **Install:** comfy.org Windows installer + FLUX model download (several GB)
- **Why:** Generate POD designs locally. FLUX.2 is best-in-class open model.

### Upscayl / Real-ESRGAN CLI
- **What:** AI image upscaling. Upscayl = GUI, Real-ESRGAN = automatable CLI.
- **Cost:** FREE
- **Why:** POD requires 3000-5400px images. Generate at 1024px, upscale for print.

### rembg
- **What:** Background removal via CLI
- **Cost:** FREE
- **Install:** `pip install rembg`
- **Use:** Sticker designs, transparent PNG products

---

## Category 5 — SEO & E-Commerce

### eRank (Free Plan)
- **What:** Etsy SEO — keyword research, trending tags, listing analysis
- **Cost:** FREE (10 searches/day). Paid from $5.99/month.
- **Access:** Browser-based at erank.com

### EtsyHunt (Free Plan)
- **What:** Product research — 62M+ listings, keyword mining, competitor analysis
- **Cost:** FREE (10 searches/day). Paid from $3.99/month.
- **Access:** Browser-based at etsyhunt.com

### Printify MCP
- **What:** Direct MCP to Printify — create products, upload designs, manage shops
- **Cost:** FREE (Printify free tier)
- **Install:** github.com/TSavo/printify-mcp
- **Why:** Closes the loop: research → design → upload → publish, all in Claude Code

---

## Install Priority for This Week

1. **Brave Search MCP** (15 min) — immediate research quality boost
2. **Firecrawl MCP** (15 min) — web scraping for market research
3. **MCP Memory Server** (20 min) — persistent knowledge from day one
4. **Replicate MCP** (15 min) — image generation capability
5. **Nano Banana MCP** (15 min) — free Gemini image generation

All require API key registration (free) + one-line MCP config addition.

---

## Sources
- Brave Search API: brave.com/search/api
- Firecrawl: firecrawl.dev, github.com/firecrawl/firecrawl-mcp-server
- MCP Official Servers: github.com/modelcontextprotocol/servers
- Replicate MCP: replicate.com/docs/reference/mcp
- Gemini CLI: npm @google/gemini-cli
- Printify MCP: github.com/TSavo/printify-mcp
- ComfyUI: comfy.org
- Upscayl: github.com/upscayl/upscayl
- eRank: erank.com
- EtsyHunt: etsyhunt.com

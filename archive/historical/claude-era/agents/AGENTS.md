# Agent Team — v2 (2026-07-03)

Live definitions load from `.claude/agents/`. This file is the index + delegation doctrine.

## Doctrine
- **Jarvis (main session) is the CEO/orchestrator.** Strategy, prioritisation, publishing,
  operator interaction, and finance bookkeeping happen in the main loop — not in subagents.
- **Spawn a subagent only when isolation pays:** a research dump that would flood context,
  or an adversarial review that must be independent of the author. Token frugality is
  charter law — never fan out multiple agents when one context can do the job.
- **Model choice:** production agents run Sonnet (bulk-capable, cheap). QC and audits
  inherit the session model (judgment work deserves the strongest available brain).
- **Handoffs are files:** agents read/write `ventures/[v]/outputs/`; contracts below.
- Agents never publish, never spend, never touch external platforms with write actions —
  those are main-loop + operator territory (config/guardrails.md).

## Active roster (6)

| Agent | Model | Role | Must read first |
|---|---|---|---|
| researcher | sonnet | Niche discovery, POS scoring, IP/trademark screen (Phase 3.5), competitor mapping | taste-memory.md (feasibility scoring) |
| designer | sonnet | POD + digital product assets via ChatGPT/Gemini + native files; Gelato print specs | taste-memory.md + guardrails IP rules (mandatory) |
| writer | sonnet | Listings/copy — US English for Etsy, faceless brand voice, AI disclosure | venture BRIEF.md |
| quality-checker | inherit | Adversarial gate: facts, ACL, brand voice, slop-check (§6), IP screen (§7). Verdict gates the operator mock review | taste-memory.md |
| analyst | sonnet | Unit economics (Gelato live costs), P&L, envelope tracking, GST-threshold watch | finance/costs.md |
| compliance-researcher | sonnet | On-call: AU tax/entity/regulatory research → professional review. Rarely dispatched | entity-research.md |
| system-reviewer | inherit | Quarterly/system audits — single-context, NO multi-agent fan-outs | blueprint §0 |

**Retired:** business-advisor → `agents/_retired/` (2026-07-03). Strategy is the main
loop's job — the operator is interactive daily, and an Opus subagent per "pulse" costs
tokens without adding judgment the main session lacks. Revisit as a scheduled cloud
"chief of staff" when Managed Agents adoption triggers (see below).

**Planned (Phase 3, when promotion track starts):** `marketer` — Pinterest/IG content
calendars, pin/reel briefs, posting schedules for faceless brand accounts.

## Product pipeline (v2 — replaces the PDF-brief flow)

```
Jarvis: pick family from research queue (POS ≥ 60, IP risk ≤ MODERATE)
  → researcher: validate niche + IP screen          [skip if research fresh <30 days]
  → analyst: unit economics @ live Gelato costs     [skip if product type already modelled]
  → designer: assets (reads taste-memory first)
  → writer: listing copy (US English, faceless)
  → quality-checker: verdict incl. slop-check + IP  [FAIL → one rework pass → escalate]
  → Jarvis: assemble MOCK PACK (design + mockup + title/tags/price + IP risk note)
  → OPERATOR: interactive approval (Stage 1)        [rejection → taste-memory.md + reason]
  → Jarvis + operator: create product in Gelato → push to Etsy → log external action + commit
```

Failure paths: researcher invalidates → stop, report. Negative margins → pause, operator
decides. Designer misses 3× → flag family as taste-risk, move on. QC FAIL 2× → escalate.

## Contracts (what each stage must leave behind)
- researcher → `outputs/RESEARCH-[family]-[date].md` (POS table, IP risk level, winning style)
- analyst → margin block inside the research file or `outputs/FINANCIAL-[family].md`
- designer → `outputs/designs/[family]/` + manifest.md (file, product, dims, prompt, attempts)
- writer → `outputs/COPY-[family]-[date].md`
- quality-checker → verdict appended to the copy/manifest file
- Jarvis → `outputs/MOCK-PACK-[family]-[date].md` for the operator session

## Adding an agent
Create `.claude/agents/[name].md` (frontmatter: name, description, model) + row here +
a "must read first" contract. Every agent ends with a "What You Never Do" section that
includes: no publishing, no spending, no accounts, nothing outside C:\ai-workspace\.

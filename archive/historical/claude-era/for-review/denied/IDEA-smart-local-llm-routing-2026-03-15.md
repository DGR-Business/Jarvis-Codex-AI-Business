# IDEA-004: Smart Local LLM Routing

## Original Idea
> Rethink the current 3-mode routing system (cloud-only / hybrid / local-only) to maximise value from a Claude Pro subscription (~$31 AUD/month) and an RTX 3080 Ti running Ollama with Qwen 3.5. Instead of simple mode switching, implement intelligent task-level routing that sends each task to the cheapest model capable of handling it. Consider dedicated AI roles (operations manager, business advisor) and clarify the real capabilities divide between Claude Code and Cowork to eliminate overlap and wasted quota.

## Status: planned
## Priority: high
## Scope: SYSTEM
## Date Submitted: 2026-03-15
## Date Reviewed: 2026-03-15

---

## Feasibility Research

### Current State Analysis

**What exists now:**

The system has three static modes defined in `config/routing.md`:
- **Mode 1 (Active):** Cloud-only. All tasks go to Opus 4.6, Sonnet 4.6, or Haiku 4.5 based on complexity tier. Burns subscription quota for everything, including tasks a local model could handle.
- **Mode 2 (Planned):** Hybrid. Local model only used for "offline/sensitive" work — a narrow use case that underutilises the hardware.
- **Mode 3 (Available):** Local-only fallback. Everything to Qwen 3.5 via Ollama. Too blunt — many tasks genuinely need cloud intelligence.

**Key limitations of the current approach:**
1. **No per-task routing.** The operator manually switches entire modes. There is no mechanism to route individual tasks to the optimal model.
2. **Quota waste.** Claude Pro usage limits are shared across Claude Chat, Cowork, and Claude Code. Five-hour rolling limits plus weekly caps mean heavy Cowork sessions can starve Claude Code of quota and vice versa.
3. **Cowork burns quota fast.** Cowork takes hidden screenshots and processes images behind the scenes, consuming significantly more tokens per task than equivalent Claude Code operations.
4. **Local model underused.** Qwen 3.5 9B is benchmarked but only designated for "offline/sensitive" — a fraction of what it could handle.
5. **No role specialisation.** All tasks funnel through generic Claude interactions with no persistent persona context for different domains (operations, finance, strategy).

**Hardware reality:**
- RTX 3080 Ti: 12GB VRAM
- Qwen 3.5 9B: ~9.7GB VRAM, ~60s per task, good quality
- Qwen 3.5 35B-A3B: ~11.6GB VRAM, ~175s per task, slightly better quality but leaves only 433MB VRAM free (risky for system stability)

---

### Proposed Architecture

Replace the 3-mode system with a **4-tier task routing architecture** that evaluates each task individually and routes it to the cheapest capable model.

```
┌─────────────────────────────────────────────────┐
│              TASK CLASSIFICATION                 │
│  (complexity, domain, quality requirement,       │
│   time sensitivity, tool requirements)           │
└──────────┬──────────┬──────────┬────────────────┘
           │          │          │
     ┌─────▼──┐  ┌────▼───┐ ┌──▼──────────┐  ┌──────────────┐
     │ Tier A │  │ Tier B │ │   Tier C     │  │   Tier D     │
     │ LOCAL  │  │ HYBRID │ │ CLOUD-LIGHT  │  │ CLOUD-HEAVY  │
     │Qwen 9B │  │CC+Qwen │ │CC + Sonnet   │  │CC + Opus     │
     │via CC  │  │draft→  │ │  or Cowork   │  │  or Cowork   │
     │        │  │refine  │ │              │  │              │
     └────────┘  └────────┘ └──────────────┘  └──────────────┘
```

**Tier A — Local (Qwen 3.5 9B via Claude Code)**
Zero subscription cost. For bulk, repetitive, or low-stakes tasks.

**Tier B — Hybrid (Local draft, Cloud refine)**
Minimal subscription cost. Local model does 80% of the work; cloud model polishes.

**Tier C — Cloud-Light (Sonnet 4.6 via Claude Code or Cowork)**
Moderate subscription cost. For tasks needing cloud intelligence but not maximum reasoning.

**Tier D — Cloud-Heavy (Opus 4.6 via Claude Code)**
Maximum subscription cost. Reserved for architecture, complex reasoning, multi-step planning.

---

### Component A: Claude Code vs Cowork — Capability Mapping

**Research findings:**

| Capability | Claude Code | Cowork |
|---|---|---|
| **Interface** | Terminal / VS Code | Claude Desktop app (visual) |
| **Sandbox** | None — runs bash directly on system | Sandboxed VM |
| **File access** | Direct filesystem (any path) | Selected folder only |
| **Bash/terminal** | Full access, arbitrary commands | No direct terminal |
| **Git** | Full git operations | No git |
| **Web search** | Built-in tool | Via Brave Search MCP |
| **Agent spawning** | Sub-agents (Plan/Explore/Task) | No sub-agents |
| **MCP servers** | Full support — Gmail, Drive, Calendar, and all connectors | Full support — Gmail, Drive, Calendar, and all connectors |
| **Local models** | Yes, via Ollama (ANTHROPIC_BASE_URL) | No — cloud only |
| **Quota usage** | Efficient (text-only) | Heavy (hidden screenshots/image processing) |
| **Hooks** | Deterministic pre/post automation | No hooks |
| **Best for** | System building, automation, code, bulk tasks | Email, calendar, document workflows |

**Critical insight:** Claude Code supports the same MCP connectors as Cowork (Gmail, Calendar, Drive, etc.) and is strictly more capable in every other dimension — direct filesystem access, bash, git, sub-agents, hooks, local model routing, and lower quota consumption. There is no capability gap.

**Recommendation:** Claude Code is the primary interface for all tasks. Cowork is an optional fallback for operators who prefer a visual/chat interface. Route everything through Claude Code — it supports all MCPs, uses less quota per task, and supports local model routing.

Sources:
- [Forte Labs — The Difference Between Claude Code and Cowork](https://fortelabs.com/blog/the-difference-between-claude-code-and-cowork/)
- [Medium — Claude vs Claude Code vs Cowork](https://medium.com/@yunusemresalcan/claude-vs-claude-code-vs-cowork-which-one-do-you-actually-need-66d3952a2eb4)
- [NoCode MBA — Claude Desktop App Explained Simply](https://www.nocode.mba/articles/claude-desktop-chat-vs-cowork-vs-code)
- [Every.to — Vibe Check: Claude Cowork Is Claude Code for the Rest of Us](https://every.to/vibe-check/vibe-check-claude-cowork-is-claude-code-for-the-rest-of-us)

---

### Component B: Claude Code + Ollama Integration

**Research findings:**

Since Ollama v0.14.0, native Anthropic Messages API compatibility exists. This means Claude Code can use local Ollama models with minimal configuration:

```bash
# Option 1: Environment variables
export ANTHROPIC_BASE_URL=http://localhost:11434
export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_API_KEY=""

# Option 2: Quick launch (latest Ollama)
ollama launch claude
```

**Key requirements:**
- Minimum 64,000 token context window (Qwen 3.5 supports 256K)
- Ollama v0.14.0+ required
- Set `CLAUDE_CODE_ATTRIBUTION_HEADER=0` to avoid KV cache invalidation
- Start context at 25K+ tokens, increase as needed for complex tasks

**What works with local models via Claude Code:**
- All file read/write operations
- Bash command execution
- Web search (tool calls work if model supports function calling)
- Agent spawning of sub-agents
- Git operations

**What does NOT work well with local models:**
- Complex multi-step reasoning chains (cascade failures in agentic workflows)
- Tasks requiring very large context windows with high accuracy
- Debugging complex legacy codebases
- Tasks where the model needs to invent novel approaches

**Practical limitation:** Claude Code's full tool suite is available regardless of backend model, but the quality of tool use depends on the model's capability. Qwen 3.5 9B has strong function-calling benchmarks (the larger 122B-A10B variant scores 72.2 on BFCL-V4), but the 9B model will make more errors in complex tool chains than Opus or Sonnet.

Sources:
- [Ollama Docs — Claude Code Integration](https://docs.ollama.com/integrations/claude-code)
- [Ollama Blog — Claude Code with Anthropic API compatibility](https://ollama.com/blog/claude)
- [DataCamp — Using Claude Code With Ollama Local Models](https://www.datacamp.com/tutorial/using-claude-code-with-ollama-local-models)
- [Towards Data Science — Run Claude Code for Free with Local Models](https://towardsdatascience.com/run-claude-code-for-free-with-local-and-cloud-models-from-ollama/)

---

### Component C: What Local Models Can and Cannot Do

**Research findings on Qwen 3.5 capabilities:**

**Strong performance (suitable for Tier A local routing):**
- Text summarization and rewriting
- Document classification and tagging
- Template-based content generation (product descriptions, social posts, email drafts)
- Data extraction and formatting (CSV, JSON, structured data)
- Translation across 201 languages
- Instruction following (scores 76.5 on IFBench — beats GPT-5.2)
- Basic code generation and boilerplate
- File organisation and renaming
- Simple analysis and reporting from structured data
- First drafts of any written content

**Moderate performance (suitable for Tier B hybrid routing):**
- SEO-optimised content (draft locally, refine with cloud)
- Business plans and strategy documents (structure locally, sharpen with cloud)
- Complex code modifications (draft locally, review and fix with cloud)
- Market research synthesis (gather and summarise locally, analyse with cloud)
- Multi-step file operations with conditional logic

**Weak performance (must stay on cloud — Tier C/D):**
- Multi-step agentic reasoning with branching decisions
- Debugging complex or unfamiliar codebases
- Novel architecture design
- Nuanced business strategy requiring broad world knowledge
- Tasks requiring high factual accuracy on obscure topics (hallucination risk)
- Long reasoning chains where early errors cascade
- Creative work requiring originality beyond training patterns

**Honest assessment for this system:** Qwen 3.5 9B is genuinely impressive for a local model. It matches or beats GPT-OSS-120B (13x its size) on academic benchmarks. But benchmarks are not real-world performance. In practice, expect:
- ~80-90% quality of Sonnet 4.6 on structured/templated tasks
- ~60-70% quality of Sonnet 4.6 on creative/analytical tasks
- ~40-50% quality of Opus 4.6 on complex reasoning tasks
- Tool use errors will occur more frequently, especially in multi-step chains

Sources:
- [VentureBeat — Alibaba's Qwen3.5-9B beats OpenAI's gpt-oss-120B](https://venturebeat.com/technology/alibabas-small-open-source-qwen3-5-9b-beats-openais-gpt-oss-120b-and-can-run)
- [Qwen3.5-9B on Hugging Face](https://huggingface.co/Qwen/Qwen3.5-9B)
- [XDA Developers — Qwen3.5-9B tops benchmarks, but that's not how you should pick a model](https://www.xda-developers.com/qwen-3-5-9b-tops-ai-benchmarks-not-how-pick-model/)
- [Techie007 — Qwen 3.5 Complete Guide](https://techie007.substack.com/p/qwen-35-the-complete-guide-benchmarks)

---

### Component D: Task Routing Intelligence

**Research findings on LLM routing approaches:**

Three main approaches exist in the research literature:

1. **Static routing:** Rules-based classification of tasks to models. Simple to implement, no overhead, but inflexible. Example: "all product descriptions go to local, all strategy docs go to Opus."

2. **Cascade routing:** Start with the cheapest model. If a confidence check fails, escalate to the next tier. Can reduce costs by 4x (Select-then-Route framework). Requires a way to evaluate output quality automatically.

3. **Difficulty-aware routing:** A classifier estimates task difficulty before routing. More sophisticated but requires training a difficulty estimator.

**For this system, static routing is the right starting point.** The overhead of cascade or difficulty-aware routing requires either a trained classifier model or automated quality evaluation — both complex to build and maintain for a solo operator. Static routing with a well-designed task taxonomy gives 80% of the benefit with 20% of the complexity.

**Proposed task classification for static routing:**

| Task Type | Tier | Model | Rationale |
|---|---|---|---|
| Product descriptions (template) | A | Qwen 9B local | Repetitive, structured, high instruction-following |
| Social media posts | A | Qwen 9B local | Short-form, template-driven |
| File organisation | A | Qwen 9B local | Simple tool use |
| Data formatting (CSV/JSON) | A | Qwen 9B local | Structured transformation |
| Email drafts | A | Qwen 9B local | Template-based, reviewed before sending |
| First draft — any document | A | Qwen 9B local | Draft quality acceptable; cloud refines |
| SEO content (draft + polish) | B | Qwen draft → Sonnet refine | Need cloud for competitive SEO quality |
| Business plans | B | Qwen draft → Opus refine | Structure locally, sharpen strategy with cloud |
| Code with testing | B | Qwen draft → Sonnet review | Catch tool-use errors with cloud review |
| Market research analysis | C | Sonnet via Claude Code | Needs web search + synthesis |
| Niche validation | C | Sonnet via Claude Code | Needs current data + judgment |
| System architecture | D | Opus via Claude Code | Complex multi-step reasoning |
| Strategic decisions | D | Opus via Claude Code | Needs broad world knowledge |
| Debugging complex issues | D | Opus via Claude Code | Error cascade risk too high for local |
| Email sending | C | Sonnet via Claude Code (Gmail MCP) | Claude Code supports Gmail MCP directly |
| Calendar management | C | Sonnet via Claude Code (Calendar MCP) | Claude Code supports Calendar MCP directly |
| Drive file management | C | Sonnet via Claude Code (Drive MCP) | Claude Code supports Drive MCP directly |

Sources:
- [ETH Zurich — A Unified Approach to Routing and Cascading for LLMs](https://arxiv.org/abs/2410.10347)
- [ACL Anthology — Select-then-Route: Taxonomy guided Routing](https://aclanthology.org/2025.emnlp-industry.28/)
- [Requesty Blog — Intelligent LLM Routing in Enterprise AI](https://www.requesty.ai/blog/intelligent-llm-routing-in-enterprise-ai-uptime-cost-efficiency-and-model)
- [PromptLayer — Dynamic Multi-Agent Orchestration Learns Task Routing](https://blog.promptlayer.com/multi-agent-evolving-orchestration/)

---

### Component E: Dedicated AI Roles / Personas

**Research findings:**

Persona-based agents provide domain specialisation through system prompts that define role, boundaries, knowledge base, and communication style. Multi-agent systems where specialised agents collaborate on complex tasks are well-established in frameworks like LangGraph, CrewAI, and Microsoft Agent Framework.

**Proposed roles for this system:**

**1. Operations Manager (local — Qwen 9B)**
- Role: Daily task execution, file management, content generation, scheduling
- Runs on: Local model for routine work, cloud for complex decisions
- System prompt: Focuses on efficiency, checklists, standard operating procedures
- Personality: Concise, action-oriented, follows templates strictly

**2. Business Advisor (cloud — Opus 4.6)**
- Role: Strategy, financial analysis, market positioning, risk assessment
- Runs on: Cloud only (requires broad world knowledge and nuanced reasoning)
- System prompt: Focuses on business fundamentals, competitive analysis, financial modelling
- Personality: Analytical, challenges assumptions, quantifies recommendations

**3. Creative Director (cloud — Sonnet 4.6)**
- Role: Brand voice, copywriting, design briefs, content strategy
- Runs on: Cloud only (requires creative intelligence beyond local model capability)
- System prompt: Focuses on brand consistency, audience engagement, storytelling
- Personality: Creative but disciplined, always ties back to business objectives

**4. Quality Controller (cloud — Sonnet 4.6)**
- Role: Review pass on all customer-facing output (already required by quality gates)
- Runs on: Cloud (needs to catch subtle errors local model might introduce)
- System prompt: Checks factual accuracy, brand consistency, AI-sounding language, legal issues
- Personality: Critical, detail-oriented, flag-and-fix

**Implementation approach:** These are not separate systems or agents — they are system prompt templates stored in `/agents/` that get loaded depending on the task type. The routing table determines both the model AND the persona for each task.

**Honest caveat:** Personas on local models are limited by the model's underlying capability. A "Business Advisor" persona on Qwen 9B will sound like a business advisor but won't have the depth of judgment that Opus brings. The persona adds structure and consistency, not intelligence. Reserve advisory roles for cloud models.

Sources:
- [RAIA AI — Exploring Three Types of AI Agents](https://www.raiaai.com/blogs/exploring-three-types-of-ai-agents-personal-persona-and-tools-based)
- [Medium — Building AI Agents with Personas, Goals, and Dynamic Memory](https://medium.com/@leviexraspk/building-ai-agents-with-personas-goals-and-dynamic-memory-6253acacdc0a)
- [HBR — To Thrive in the AI Era, Companies Need Agent Managers](https://hbr.org/2026/02/to-thrive-in-the-ai-era-companies-need-agent-managers)
- [Jenova AI — AI Role Creation Agent](https://www.jenova.ai/en/resources/ai-role-creation-agent)

---

### Component F: Quota Optimisation Strategy

**Current quota constraints (Claude Pro, ~$31 AUD/month):**
- Five-hour rolling usage limit (resets every 5 hours)
- Weekly usage limit across all models
- Shared across Claude Chat, Cowork, and Claude Code
- Extra usage available at additional cost
- March 2026 promotion: 2x usage during off-peak hours (outside 8am-2pm ET)

**Estimated quota savings from smart routing:**

| Scenario | Tasks/Week | Cloud Tasks (current) | Cloud Tasks (with routing) | Reduction |
|---|---|---|---|---|
| POD Store content | 50 product descriptions | 50 | 5 (review only) | 90% |
| Research tasks | 10 research sessions | 10 | 7 (3 local drafts) | 30% |
| System maintenance | 15 file/code tasks | 15 | 12 (3 local) | 20% |
| Strategy/planning | 5 sessions | 5 | 5 (all cloud) | 0% |
| **Total** | **80 tasks** | **80 cloud** | **29 cloud** | **~64%** |

This is a rough estimate, but the principle is clear: bulk content generation is the biggest quota drain and the easiest to offload to local. A 50-65% reduction in cloud usage is realistic for a content-heavy business like POD.

Sources:
- [Claude Help Center — Using Claude Code with Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [Claude Help Center — Extra usage for paid plans](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans)
- [Portkey — Everything We Know About Claude Code Limits](https://portkey.ai/blog/claude-code-limits/)

---

## Recommendation

**Status: PLANNED — implement in Phase 2 as a priority system upgrade.**

This idea is highly feasible and directly addresses the core constraint of the system: a $31 AUD/month subscription trying to run an entire business operating system. The research confirms:

1. **Claude Code + Ollama integration works.** Ollama v0.14+ has native Anthropic API compatibility. The setup is three environment variables.

2. **Qwen 3.5 9B is good enough for bulk tasks.** Instruction following that beats GPT-5.2, functional tool use, 60-second response times. Not good enough for complex reasoning, but that is exactly the point of routing.

3. **Static routing is the right starting point.** Cascade and difficulty-aware routing are academically interesting but over-engineered for a solo operator. A task classification table that maps task types to tiers is simple, maintainable, and delivers most of the benefit.

4. **Claude Code should be the primary interface, not Cowork.** Claude Code uses less quota, supports local models, has more tools, and supports all the same MCP connectors (Gmail, Calendar, Drive, etc.). There is no capability Cowork has that Claude Code lacks.

5. **Personas add value but are not magic.** They provide structure and consistency, especially for the Operations Manager role on local. But personas cannot make a 9B model think like Opus.

6. **Estimated 50-65% reduction in cloud usage is achievable**, primarily by offloading bulk content generation to local.

**Risks:**
- Local model quality may require more human review passes, partially offsetting time savings
- Switching between local and cloud Claude Code sessions adds friction (environment variable changes)
- Qwen 3.5 tool-use errors in agentic chains may cause wasted time on failed tasks
- 12GB VRAM leaves little headroom — running other GPU-intensive tasks concurrently is not possible

---

## Implementation Plan

### Phase 1: Foundation (Effort: 1-2 sessions)
1. Update Ollama to v0.14+ if not already current
2. Create switching scripts in `/hooks/`:
   - `switch-to-local.sh` — sets ANTHROPIC_BASE_URL to Ollama, loads Qwen 9B
   - `switch-to-cloud.sh` — restores cloud environment variables
3. Test Claude Code + Qwen 3.5 9B on representative tasks:
   - Product description generation (5 items)
   - File organisation (rename/move batch)
   - Template-based email draft
   - Simple code generation
4. Document results in a benchmark file

### Phase 2: Routing Table (Effort: 1 session)
5. Create `config/task-routing.md` with the full task classification table
6. Create agent personas in `/agents/`:
   - `operations-manager.md` — for local routine tasks
   - `business-advisor.md` — for cloud strategy tasks
   - `creative-director.md` — for cloud content tasks
   - `quality-controller.md` — for cloud review passes
7. Update `config/routing.md` to replace 3-mode system with 4-tier system

### Phase 3: Workflow Integration (Effort: 1-2 sessions)
8. Create a task intake template that classifies each task by tier
9. Build a pre-task hook that suggests the appropriate tier based on task description
10. Update CLAUDE.md with routing instructions for both Claude Code and Cowork
11. Add routing decisions to the audit log

### Phase 4: Optimisation (Ongoing)
12. Track actual quota usage before and after routing changes
13. Refine the routing table based on observed local model quality
14. Evaluate whether Qwen 3.5 35B-A3B is worth the speed penalty for specific task types
15. Consider upgrading GPU in future if local model usage proves highly valuable

### Estimated Effort
- **Total setup:** 3-5 sessions (spread across 1-2 weeks)
- **Ongoing overhead:** Minimal — routing table lookups become habitual
- **Break-even:** Immediate — first session of local product descriptions saves cloud quota

### Dependencies / Blockers
- Ollama must be v0.14.0+ for Anthropic API compatibility (check current version)
- Claude Code environment variable switching needs testing for reliability
- No blocker on the persona system — these are just markdown files with system prompts
- POD Store venture should be at Stage 1 (Building) to generate real content for testing

---

## Status History
- 2026-03-15: new — idea submitted
- 2026-03-15: reviewing — web research conducted across 6 research areas
- 2026-03-15: planned — feasibility confirmed, implementation plan drafted

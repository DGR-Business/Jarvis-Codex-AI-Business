# System Audit — 2026-03-20

**Auditor:** system-reviewer agent (Sonnet 4.6)
**Scope:** Full system — infrastructure, AI stack, business operations
**Date:** 2026-03-20
**Workspace:** C:\ai-workspace\

---

## Executive Summary

The Jarvis AI Business OS is a well-designed, architecturally sound system that is approximately 7 weeks into its build. The foundation is strong: the workspace structure is mostly complete, hooks are functional and cover the critical lifecycle events, agent definitions are well-scoped with clear role boundaries, and the autonomy/approval model is appropriately calibrated for Australian legal compliance. The session continuity pattern (session logs + current-state.md) is working as designed. The venture launch pipeline (Advisor → Researcher → Analyst → Designer → Writer → Quality-Checker → PDF brief) is thoughtfully architected for the POD use case. The primary concern at this stage is that the system is still pre-revenue and pre-launch: the POD venture is blocked on Etsy developer app approval, no listings exist, and the holding-company BRIEF has not been filled in. There are also several structural gaps — the config/ folder is missing six of the eight files specified in the Master Plan, activity.log is absent despite being referenced in CLAUDE.md, and the Etsy API key is stored in plaintext in .mcp.json in violation of the system's own security policy. The ideas pipeline is well-maintained with five ideas tracked and substantively reviewed. Web research confirms the core technology choices are sound for 2026, and the POD market remains viable with the caveat that Etsy's June 2025 originality update requires demonstrably original designs. Overall health: YELLOW — solid bones, several gaps to close before the first venture launches.

---

## What's Working Well

- **Hook coverage:** All four critical lifecycle events are covered (SessionStart, Stop, PreToolUse, PostToolUse) with matching registrations in .claude/settings.json. The safety-check.sh PreToolUse hook correctly blocks writes outside the workspace boundary.
- **Agent definition quality:** All eight agents have well-structured system prompts with clear role boundaries, explicit "What You Never Do" sections, Australian legal context, and correct delivery routing instructions. Role separation between business-advisor/researcher/analyst is particularly clean.
- **Venture launch pipeline:** The pipeline in AGENTS.md (Advisor → Researcher → Analyst → Designer → Writer → Quality-Checker → PDF brief → Operator) is complete with skip logic and failure paths, a meaningful operational asset.
- **Autonomy model:** The four-level system (Auto/Notify/Approve/Human-Only) is well-calibrated for a solo Australian operator and correctly reflects ACL legal exposure. The audit trail format in external-actions.log is correct.
- **Decision log:** decision-log.md is actively maintained (9 entries, 2026-03-13 through 2026-03-20) and documents the key system simplification decisions clearly.
- **Ideas pipeline:** The ideas system is genuinely useful — five ideas reviewed with substantive feasibility research, implementation plans, and accurate status tracking. IDEA-002 (auto-improvement) is particularly thorough.
- **Dashboard architecture:** The Node.js server with WebSocket push and file-watcher on for-review/ is a strong design. Real-time event streaming via the dashboard-hook.sh is correctly wired.
- **Session continuity:** Four session logs exist spanning 2026-03-13 to 2026-03-20, and the most recent (2026-03-20-1400.md) is detailed and complete with operator actions needed clearly listed.
- **Security config:** security.md references CVE-2025-53110 (EscapeRoute), prompt injection risks, and algorithmic collusion — demonstrating awareness of the current threat landscape.
- **Delivery routing:** config/delivery.md is clear, with a well-defined type-prefix table and review-status lifecycle values. The dual-path (for-review/ pipeline vs review-inbox/ ad-hoc) is a clean separation.
- **Financial tracking baseline:** costs.md, revenue.md, and monthly/2026-03.md are all present and correctly initialised with the Claude Pro subscription as the first cost.

---

## Issues Found

| Location | Domain | Issue | Severity | Recommended Fix |
|---|---|---|---|---|
| `.mcp.json` | Infra/Security | Etsy API key (`29pwj872rqhfjoyyhvx4ltaf`) stored in plaintext in a workspace file, violating security.md policy. Shared Secret field is a placeholder but the API key is a real credential. | HIGH | Move ETSY_API_KEY to a Windows environment variable. Remove from .mcp.json. Reference via `${ETSY_API_KEY}` in the env block. Operator must also regenerate the Shared Secret (as flagged in current-state.md). |
| `config/` | Infra | Six of eight config files from Master Plan are absent: routing.md, approval-gates.md, failure-playbooks.md, active-ventures.md, quality-gates.md, workflow-tests.md. Only delivery.md and security.md exist. | HIGH | Create the six missing config files. routing.md is especially important now that IDEA-004 (smart local routing) is deferred — a written policy prevents future confusion. approval-gates.md should formalise what is currently only in CLAUDE.md. |
| `logs/activity.log` | Infra | CLAUDE.md standing instruction #7 requires appending to logs/activity.log during task execution (format: TIMESTAMP \| EVENT-TYPE \| Description). This file does not exist. The dashboard relies on this log for live activity display. | HIGH | Create logs/activity.log with a header line. Agents must write to this file per standing instruction #7. Without it, the dashboard live feed shows no historical activity. |
| `holding-company/BRIEF.md` | Ops | The holding company BRIEF is entirely unfilled — portfolio strategy, operator goals, and risk tolerance all read "(To be defined by operator)". This is referenced by the business-advisor agent on every strategic pulse. | MEDIUM | Operator to complete: portfolio strategy, personal goals, risk tolerance, budget constraints, time available per week, and any niches/markets to avoid. |
| `holding-company/operations/` | Infra | Directory did not exist prior to this audit (has now been created). The system-reviewer and audit-synthesizer are configured to save canonical audit reports here, but the path was missing. | MEDIUM | Directory now created. Confirm audit-synthesizer also finds it. |
| `config/routing.md` | AI Stack | No routing configuration exists. IDEA-004 (smart local routing) was deferred to cloud-only strategy, but no written routing policy replaces the three-mode system that was superseded. The current model assignment is only in agent frontmatter (opus for business-advisor, sonnet for others). | MEDIUM | Create config/routing.md documenting: which agent uses which model, when to use Haiku 4.5 for high-volume tasks, and conditions for future local model re-enablement. |
| `dashboard/dashboard-aurora.html` | Infra | The dashboard HTML contains static/hardcoded venture and financial data rather than being regenerated from live workspace state. No scheduled task exists to rebuild it. The `LAST_UPDATED` field was manually set to 2026-03-20. | MEDIUM | Create a scheduled task or session-end step to regenerate the HTML from current workspace data (venture BRIEFs, review-status.json, finance files). Alternatively, expand the Node.js server to serve live workspace data via API endpoints. |
| `.mcp.json` scope | Infra/Security | .mcp.json at workspace root is project-scoped, meaning the Etsy MCP credentials are accessible to any Claude Code session opened in this workspace. Per the security decision log, this is acceptable, but it has not been documented as a deliberate choice. | MEDIUM | Document in security.md that .mcp.json is project-scoped by design, and that its contents must never include plaintext secrets (use environment variable references only). |
| `config/approval-gates.md` | Infra | The autonomy level rules exist in CLAUDE.md but have not been extracted into the dedicated config/approval-gates.md file specified in the Master Plan. This makes the rules harder for agents to reference independently. | LOW | Extract autonomy level rules from CLAUDE.md into config/approval-gates.md. CLAUDE.md can link to it rather than duplicating. |
| `for-review/` directory | Ops | The for-review/ directory exists and has an approved/ subdirectory, but no PDF briefs have been produced yet. The pipeline cannot be tested end-to-end until a niche launch produces output. | LOW | This is expected at Stage 0. No action needed now — resolved when the first niche launches. |
| `ventures/venture-01-pod-store/tasks/` | Ops | The tasks/ directory is empty. No sprint or task files have been created for the venture. This is an expected gap at Stage 0, but once niche launch begins, task tracking will be needed. | LOW | Create a tasks/sprint-01.md when launching the first niche. |
| `session-end.sh` hook | Infra | The session-end hook checks for the existence of a session log for today (exit 2 = block if none). However, exit code 2 in Claude Code hooks signals "block and show message" — meaning Claude Code is blocked from stopping if no session log was written. This is the intended design, but it creates a potential issue: if Claude writes a session log but the filename uses a time suffix (e.g., 1400), the glob pattern `session-log-${TODAY}*.md` should match. Verify this pattern works reliably on Windows/bash under Git Bash. | LOW | Test the hook by running `bash hooks/session-end.sh` on a day where a session log exists and one where it does not. Confirm exit codes are correct under Windows Git Bash. |
| `agents/AGENTS.md` | AI Stack | AGENTS.md lists `superpowers:code-reviewer` as an active agent, but no superpowers plugin appears to be installed (no evidence in settings.json or skills/). If this plugin is not installed, the code-reviewer entry is misleading. | LOW | Confirm whether the superpowers plugin is installed. If not, move `superpowers:code-reviewer` to a "Planned Agents" section or remove it. |
| `ideas/IDEAS.md` | Ops | The IDEAS.md file still contains all four original operator ideas in full text, even though they have all been processed into ideas/reviewed/. The standing instruction says "You can delete ideas from here after they appear in the tracker." IDEAS.md is now serving as a persistent store rather than an inbox. | LOW | Clear IDEAS.md of processed ideas, leaving only the header/instructions. This keeps the inbox clean and reduces session-start hook output. |

---

## Infrastructure Assessment

**Rating: YELLOW**

### Config Completeness

The workspace structure is largely correct, but config/ is significantly incomplete. Of the eight files specified in Master Plan Section 3.1, only two are present (delivery.md, security.md). The six missing files are:

1. `routing.md` — model routing policy
2. `approval-gates.md` — tiered autonomy rules (exists only in CLAUDE.md)
3. `failure-playbooks.md` — error handling procedures (exists only in CLAUDE.md)
4. `active-ventures.md` — venture registry
5. `quality-gates.md` — output review rules (exists only in CLAUDE.md)
6. `workflow-tests.md` — representative test cases

The information in these files does exist — it is consolidated in CLAUDE.md following the March 2026 simplification decision (documented in decision-log.md). However, not having dedicated config files means agents cannot reference specific config documents and the workflow test suite cannot be run independently.

Assessment: the March 2026 consolidation into CLAUDE.md was a pragmatic choice that makes sense for a solo operator. The missing files are "nice to have" rather than blocking, with the exception of routing.md — there is currently no documented model routing policy outside agent frontmatter.

### Hook Reliability

All four hooks are present and correctly registered in .claude/settings.json:

- `session-start.sh` — reads latest session log and IDEAS.md, outputs to stdout (passes context to Claude). Well-designed. Correctly handles missing files.
- `session-end.sh` — blocks stop if no session log written today. Correct use of exit 2. Minor risk: filename glob matching on Windows needs validation.
- `safety-check.sh` — reads Write/Edit tool input via stdin, normalises path, blocks if outside workspace. Correctly handles the jq binary path with fallback. Covers both `c:/ai-workspace/` and `/c/ai-workspace/` path forms.
- `dashboard-hook.sh` — POSTs events to Node.js dashboard server. Auto-starts server if not running. Correctly handles all four event types. Uses jq safely for JSON construction.

The hook coverage is good. One missing hook type worth noting: there is no `PostToolUse` hook that writes to activity.log. The CLAUDE.md standing instruction #7 asks agents to do this manually, but a deterministic hook would be more reliable.

### Security Posture

The system has well-documented security principles (security.md references CVE-2025-53110, prompt injection, algorithmic collusion). However, there is one critical violation: the Etsy API key is stored in plaintext in .mcp.json at line 8. This is a direct violation of security.md's policy ("API keys: NEVER stored in config files, markdown, or logs"). The current-state.md already flags that the Shared Secret must be regenerated, but the API key itself is also exposed.

Web research (March 2026) confirms that MCP server credential exposure is a primary attack vector, with over 30 CVEs filed in January–February 2026 targeting MCP infrastructure. The principle of least privilege and runtime secret injection are the correct mitigations — both of which are documented in security.md but not yet applied to the Etsy MCP configuration.

The safety-check.sh hook does not check Bash commands — it only checks Write and Edit tool inputs. A malicious or mistaken Bash command could still write outside the workspace. This is an accepted gap (consistent with the design) but worth noting.

### Session Continuity

The session memory system is functioning correctly. Four session logs are present spanning the system's 7-week history:

- `session-log-2026-03-13-1200.md` — bootstrap
- `session-log-2026-03-16-1036.md` — system simplification
- `session-log-2026-03-19-1200.md` — (not read in full but present)
- `session-log-2026-03-20-1400.md` — agent expansion + pipeline + Etsy API

The most recent log (2026-03-20-1400.md) is thorough and actionable. The session-start hook loads this automatically. The venture current-state.md is maintained in parallel and provides a condensed rolling view.

The MEMORY.md auto-memory file correctly references the key project milestones (Phase 1 complete, Phase 2 ready).

### Dashboard Status

The dashboard infrastructure is technically sound but has a data staleness problem. The dashboard-aurora.html contains hardcoded static data for ventures, financial summary, and alerts. The Node.js server serves this static HTML and adds real-time event streaming via WebSocket — but the static HTML data does not update automatically.

The server correctly serves live data from `GET /api/for-review`, which reads the actual for-review/ directories. The WebSocket live feed works via dashboard-hook.sh. However, the venture status, financial summary, and alert panels are static.

No scheduled task exists to regenerate dashboard.html. This is a known gap from the Master Plan (Section 7.3 specifies a scheduled Cowork task), but Cowork has been superseded as the primary interface. A Claude Code scheduled task or cron-based regeneration is needed.

---

## AI Stack Assessment

**Rating: GREEN (with caveats)**

### Agent Definition Quality

All eight agents are well-constructed. Strengths across the set:

1. **Clear role boundaries** — each agent has a "What You Never Do" section and role boundary statements (e.g., business-advisor's "You are the WHAT and WHY agent" with explicit call-outs for what belongs to researcher, analyst, designer, and writer).

2. **Correct model assignments** — business-advisor uses Opus (appropriate for strategic reasoning), all others use Sonnet. This is consistent with the pricing data from web research (Opus at $5/$25 per million tokens, Sonnet at $3/$15 — appropriate given the volume differential between advisory and operational tasks).

3. **Australian context embedded** — all agents reference Australian Consumer Law, AUD currency, and AU legal constraints appropriately.

4. **Delivery routing instructions** — each agent specifies exactly where to save outputs (venture outputs/ and review-inbox/ with correct prefix), and most reference review-status.json updates.

5. **Designer agent is well-architected** — the dynamic AI tool routing (navigate to platform rather than hardcoding model names), upscaling guidance with free tool recommendations, and detailed product dimension specifications make this a production-ready agent definition.

**Caveats:**

- The `analyst` agent assumes GST registration ("assume unless stated otherwise") but the operator has not confirmed this — this should be verified before any financial outputs go to the operator.
- The `researcher` agent outputs to `review-inbox/` with a `RESEARCH-` prefix, but config/delivery.md does not list `RESEARCH-` as a type prefix. Minor inconsistency.
- The `system-reviewer` agent (this agent) is correctly scoped and has comprehensive web research mandates.

### Missing Agent Roles

Comparing the current roster against common solo operator needs and the Master Plan:

- **Scheduler/Automation agent:** No dedicated agent for managing scheduled tasks, setting up cron jobs, or recurring operations. Currently handled ad-hoc by Jarvis. As ventures scale, this becomes a gap.
- **Legal/Compliance agent:** The Master Plan's Core Agent Roles (Section 10.2) includes a "Legal / Compliance" agent. This is absent. The quality-checker covers ACL compliance checks but there is no dedicated agent for deeper compliance questions (IP, trademark, platform ToS review). This is a Tier 4 (Human-Only) domain for final decisions, but a research-level compliance agent would be valuable for flagging issues before they reach human review.
- **Customer service agent:** Not currently needed (no sales yet), but will be needed at Stage 2.
- **SEO/keyword research agent:** No dedicated keyword research agent. Currently the researcher handles this, but POD success is heavily SEO-dependent and a specialist agent would produce better Etsy-specific output (keyword density, long-tail discovery, seasonal trends).

### MCP Readiness

Current MCPs: only the Etsy MCP is configured (and it is blocked pending developer app approval + credential remediation).

Web research confirms the Google Workspace MCP Server is the highest-value next install for a solo operator — it covers Gmail, Google Calendar, Google Drive, Docs, and Sheets in a single authenticated MCP. Composio offers a single MCP covering 250+ platforms but at higher complexity and a cloud dependency.

The phase2-mcp-setup.md guide is well-written (non-technical, step-by-step) and covers the core MCPs correctly.

### Orchestration Patterns

The hub-and-spoke pattern (Jarvis dispatches named sub-agents) is the correct pattern for this use case. Web research (March 2026) confirms this is the recommended pattern for Claude Code projects, with Agent Teams reserved for cases where sub-agents need to communicate directly.

The venture launch pipeline is a well-designed sequential workflow with appropriate skip logic. One gap: there is no built-in retry or quality escalation path if a sub-agent produces poor output on the first pass. The quality-checker FAIL → "1 rework pass, then escalate" is documented in AGENTS.md but not enforced mechanically — it relies on the orchestrating session following the documented pattern.

---

## Operations Assessment

**Rating: YELLOW**

### Venture Setup Quality

Venture-01 (POD Store) is at Stage 0 (Idea/Research) and is correctly set up for that stage:
- BRIEF.md is complete with goals, KPIs, target market, and key decisions
- current-state.md is current (last updated 2026-03-20) with clear blockers and next steps
- The venture's stage in CLAUDE.md ("Idea") matches the actual state

Blockers preventing progression to Stage 1 (Building):
1. Etsy developer app pending approval (external dependency — no action possible)
2. Etsy Shared Secret must be regenerated (operator action required)
3. Etsy seller account not yet created (Human-Only)
4. EverBee Chrome extension not installed

The initial niche research (pet portraits, zippered tote bags, outdoor hobby niches) is noted in current-state.md but the research file (REPORT-pod-niche-research-notes-2026-03-13.md in review-inbox/) is a system test document rather than substantive research. A full niche validation research run has not been completed.

**Assessment of POD market viability (based on web research):**

The POD market remains viable in 2026 (projected CAGR above 25% through 2030 per Marmalead). However, conditions have tightened since 2021-2023. Key factors for this venture:

- Etsy's June 2025 Creativity Standards update requires demonstrably original designs (seller's own prompts). Templates and minimally-modified AI outputs face removal risk. The designer agent's approach (original prompts per brief) is correctly aligned with this requirement.
- Etsy disclosure is now mandatory: sellers must disclose AI use AND disclose the production partner (Printify/Printful/Gelato) on every listing.
- Fee stack matters: $0.20 listing + 6.5% transaction + ~3% payment processing = approximately 10% off the top before production costs. On a $29 t-shirt with ~$17 Printify cost, net is ~$13 before ads.
- Hyper-specific niches ("Goldendoodle mom" not "dog lover") are the proven strategy. The initial niche research identified this correctly.

**Platform recommendation (web research):**

- **Etsy + Printify** is the recommended combination for this venture. Etsy provides traffic (built-in marketplace), Printify provides the best margins at scale (61.84% at 100 orders/month with Premium plan at $29/month).
- **Gelato** is a strong alternative if Australian-based fulfilment matters — Gelato has fulfilment hubs globally including closer to Australia, which reduces international shipping costs and times.
- **Redbubble as secondary:** Redbubble's fee structure has become more punitive (up to 50% of earnings on Standard Tier), making it a lower-priority platform. Listing on Redbubble after Etsy listings are proven is a low-effort add-on.
- **TeePublic** controls base pricing and sale events can reduce margins significantly. Not recommended as a primary platform.

### Delivery Pipeline Completeness

The delivery pipeline is fully specified but untested end-to-end. The architecture (venture outputs/ → review-inbox/ or for-review/ → operator approval → publish) is correct. The review-status.json format is defined and the current file has two entries in the correct format.

The PDF brief compilation step is documented ("Jarvis compiles PDF brief → for-review/") but no mechanism to create PDFs is in place. The `pdf` skill referenced in the designer agent's workflow has not been confirmed as installed. Without a PDF generation capability, the pipeline deliverable to the operator would be a folder of markdown files rather than a compiled brief.

### Financial Tracking

The financial structure is correctly initialised:
- costs.md shows the Claude Pro subscription (~$31 AUD/month) as the only cost
- revenue.md is empty (correct — no revenue yet)
- monthly/2026-03.md shows net -$31 for March 2026

The financial tracking is minimal but appropriate for Stage 0. Areas that will need expansion when active:
- Etsy listing fees (tracked per listing)
- Printify/Gelato production costs (tracked per order)
- GST tracking (AUD sales with Australian customers)
- Currency conversion costs (USD → AUD for platform payouts)

The analyst agent system prompt correctly identifies GST as a flag item requiring professional review.

**Note for operator (not advice):** Australian tax treatment of POD income, GST threshold, and treatment of platform fees as deductible expenses are matters for a qualified accountant, not this system.

### Ideas Pipeline Prioritisation

All five ideas have been reviewed. Current status:

| ID | Idea | Status | Assessment |
|---|---|---|---|
| IDEA-001 | Remote Control | planned | HIGH value — Claude remote-control feature is live and costs $0. Single command. Implement immediately. |
| IDEA-002 | Auto-Improvement | planned | MEDIUM value — comprehensive plan. Defer until Phase 3 is operational. Prerequisite: skill-creator plugin must be installed. |
| IDEA-003 | Human Oversight Dashboard | planned | HIGH value for operator experience — Notion MCP is the recommended path. Implement in Phase 2 alongside Google Workspace MCP. |
| IDEA-004 | Smart Local Routing | deferred | Correctly deferred under cloud-only strategy. Re-evaluate if Pro rate limits become a constraint. |
| IDEA-005 | Etsy API Integration | blocked | Correctly blocked. Will unblock when developer app approved. API key security issue must be resolved first. |

**Recommended implementation order:**
1. IDEA-001 (Remote Control) — one command, zero cost, immediate value
2. IDEA-005 (Etsy API) — unblocks when developer app approved, critical for pipeline automation
3. IDEA-003 (Human Oversight Dashboard via Notion) — operator-facing, can be done in Phase 2
4. IDEA-002 (Auto-Improvement) — Phase 3, after core MCPs are installed

### Quality Gate Effectiveness

The quality-checker agent is well-designed for a solo operator — the PASS/CONDITIONAL PASS/FAIL verdict format with line-by-line notes is practical. The AI language detector (banned phrases list) is a useful operational feature.

The gate is documented but untested in production (no customer-facing content has been produced). The "1 rework pass, then escalate" logic in AGENTS.md is documented but relies on the orchestrating session following the pattern. There is no automated enforcement.

One gap: the quality-checker system prompt does not include Etsy-specific policy checks (AI disclosure requirement, production partner disclosure, policy compliance). These should be added when the venture moves to Stage 1.

---

## Technology & Tool Gaps

Based on web research (March 2026):

### Infrastructure Gaps

1. **No PostToolUse hook for activity logging.** CLAUDE.md standing instruction #7 asks agents to manually write to activity.log, but this is unreliable — agents can forget. A PostToolUse hook that appends tool use events to activity.log would make this deterministic. Hooks with async: true have near-zero performance overhead.

2. **No PostToolUse hook for session log enforcement.** The session-end.sh hook blocks Claude from stopping if no session log was written, but doesn't help if the session terminates abnormally. A PostToolUse hook pattern that periodically checkpoints session state would improve resilience.

3. **Dashboard static data regeneration.** The Master Plan specifies a scheduled task to regenerate dashboard.html. With Cowork superseded, this should be a Claude Code scheduled task or a PostToolUse hook that rebuilds the static data sections from workspace files. Web research confirms this is the standard pattern for file-based AI dashboards.

4. **MCP audit logging.** Web research (Tetrate, MCP Playground) identifies MCP-level audit logging as a best practice in 2026. The current external-actions.log covers Approve-level actions but does not log MCP tool calls. Adding an MCP-level log (which tool was called, with what arguments, result) would improve auditability.

### AI Stack Gaps

5. **Haiku 4.5 not in use.** Web research confirms Haiku 4.5 at $1/$5 per million tokens (3x cheaper than Sonnet, 12x cheaper than for high-volume low-stakes tasks). The current agent set uses either Sonnet or Opus. Tasks like product description formatting, tag generation, and structured data extraction would be well-served by Haiku 4.5, significantly reducing API costs at scale. This is not relevant at Stage 0 but becomes important at Stage 2 when listing volume scales.

6. **No PDF generation capability.** The venture launch pipeline delivers a PDF brief to the operator (AGENTS.md, "Jarvis compiles PDF brief → for-review/"). The designer agent references a `pdf` skill. However, no PDF skill has been confirmed as installed and no PDF generation mechanism exists. The pipeline cannot produce its promised deliverable format.

7. **Recraft MCP not considered.** Recraft is the only major AI image generator that produces native SVG files (editable vector format) — relevant for POD designs that need to scale to 4500x5400px without quality loss. This is a gap in the designer agent's tool routing table (ChatGPT vs Gemini only). Recraft should be added as a third option for vector-style designs.

8. **No keyword research MCP.** Etsy SEO is critical for POD success. No MCP exists for EverBee, Sale Samurai, or Marmalead (dedicated Etsy keyword tools). The researcher agent uses generic WebSearch for keyword research. A dedicated Etsy keyword data source would significantly improve listing quality.

### Business Operations Gaps

9. **No Printify or Gelato MCP.** The designer agent is configured to navigate ChatGPT/Gemini via browser automation but there is no MCP for Printify or Gelato. A Printify MCP would allow the designer agent to push product mockups and create draft products directly, reducing the manual upload step that currently falls to the operator.

10. **Notion MCP not installed.** IDEA-003 (Human Oversight Dashboard) correctly identifies Notion as the operator-facing management layer. Notion's official hosted MCP is production-ready with OAuth and supports full database read/write. Installing this in Phase 2 alongside Google Workspace MCP would give the operator mobile access to venture status, task lists, and review items.

11. **Google Workspace MCP not installed.** Gmail, Calendar, and Drive MCPs are referenced throughout CLAUDE.md and agent definitions but none are installed. The phase2-mcp-setup.md guide exists but Phase 2 has not started. The unified Google Workspace MCP (taylorwilsdon/google_workspace_mcp) covers all three in one installation and is rated as highly reliable in 2026 comparisons.

12. **Composio not evaluated.** Composio provides a single MCP covering 250+ platforms with managed OAuth. For a solo operator who will eventually need Slack, GitHub, Airtable, and social platform connections, Composio would reduce MCP management overhead significantly. Worth evaluating as an alternative to installing individual MCPs.

---

## MCP Priority List

1. **Etsy MCP (already installed, needs unblocking)** — Unblock by: regenerating Shared Secret, moving API key to environment variable, completing OAuth flow after developer app approval. This is the highest-value unblock since it enables the pipeline's publishing step. Estimated value: HIGH — enables automated listing creation.

2. **Google Workspace MCP (taylorwilsdon/google_workspace_mcp)** — Covers Gmail, Calendar, Drive, Docs, Sheets in one install. Required to enable the email delivery routing in CLAUDE.md, Drive deliverable storage, and operator notification features. Single OAuth flow via the unified server. Estimated value: HIGH — unlocks 4 of the 5 planned MCP capabilities.

3. **Notion MCP (official hosted, developers.notion.com)** — Operator-facing management dashboard (IDEA-003). Free on Notion Free plan. Provides mobile access to tasks, venture status, review items. Estimated value: HIGH for operator experience.

4. **Brave Search or Firecrawl MCP** — Web search and scraping capability for the researcher agent. Currently the researcher uses the built-in WebSearch tool which is available in Claude Code sessions — so this is lower priority than originally planned. Firecrawl adds structured content extraction for competitor analysis. Estimated value: MEDIUM — useful but not blocking.

5. **Printify MCP (community, or direct API)** — Enables the designer agent to push designs and create draft products without operator uploading manually. Estimated value: MEDIUM — reduces the operator's manual steps in the pipeline.

6. **Discord MCP (for IDEA-001 Remote Control)** — If the native `claude remote-control` feature is not sufficient for the operator's mobile workflow, a Discord MCP provides a persistent command channel accessible from any device. Estimated value: MEDIUM-LOW — the native remote control feature should be tried first.

---

## Quick Wins

Changes completable in a single session at zero or near-zero cost:

1. **Move Etsy API key to environment variable** — Edit .mcp.json to use `${ETSY_API_KEY}` instead of the plaintext key. Set the env variable in Windows System Properties. Takes 10 minutes. Closes the HIGH security issue.

2. **Create logs/activity.log** — Create the file with a header. Takes 1 minute. Enables the dashboard live activity feed.

3. **Enable native Claude Remote Control (IDEA-001)** — Run `claude remote-control` in terminal, scan QR code on phone. Zero cost, immediate benefit. Takes 5 minutes.

4. **Clean up IDEAS.md** — Remove the four processed ideas from IDEAS.md, leaving only the intake instructions. Reduces session-start hook output and keeps the inbox clean. Takes 2 minutes.

5. **Create config/routing.md** — Document the current model routing (Opus for business-advisor, Sonnet for others, Haiku 4.5 planned for high-volume listing tasks). Takes 15 minutes. Closes a documented gap.

6. **Create config/active-ventures.md** — Single-file venture registry listing venture-01-pod-store with stage, started date, and status. Takes 5 minutes.

7. **Add RESEARCH- prefix to config/delivery.md** — The researcher agent uses `RESEARCH-` as a type prefix but it is not listed in config/delivery.md's type prefix table. Takes 2 minutes to add.

8. **Add Etsy-specific checks to quality-checker agent** — Add AI disclosure requirement check and production partner disclosure check to the quality-checker's review checklist. Takes 10 minutes and is needed before any listings go live.

9. **Operator fills in holding-company/BRIEF.md** — Cannot be done by the system, but this is the most valuable 15 minutes the operator can spend. The business-advisor agent reads this on every strategic pulse.

10. **Test session-end.sh on Windows** — Run `bash hooks/session-end.sh < /dev/null` on a day with and without a session log, verify exit codes are correct under Git Bash on Windows.

---

## Prioritised Recommendations

1. **Remediate the Etsy API key security issue [HIGH, Session 1].** Move the plaintext API key from .mcp.json to a Windows environment variable. Update the env block to reference `${ETSY_API_KEY}`. Operator must also regenerate the Shared Secret from the Etsy developer dashboard (flagged in current-state.md). This closes a HIGH security vulnerability before any credentials are activated.

2. **Install the Google Workspace MCP [HIGH, Session 2].** This single install unlocks Gmail, Drive, Calendar, Docs, and Sheets — enabling the email delivery routing, Drive storage, and operator notification paths that are referenced throughout CLAUDE.md but currently inactive. Follow the phase2-mcp-setup.md guide.

3. **Create logs/activity.log and add a PostToolUse hook for deterministic logging [HIGH, Session 1].** The standing instruction #7 asking agents to manually write to activity.log is unreliable. A PostToolUse hook with `async: true` that appends tool events to activity.log would make the dashboard live feed work correctly and provide a proper audit trail.

4. **Create the six missing config files [MEDIUM, Session 1-2].** routing.md and active-ventures.md are the highest priority. The others (approval-gates.md, failure-playbooks.md, quality-gates.md, workflow-tests.md) can extract from CLAUDE.md content and add value as independently referenceable documents.

5. **Implement IDEA-001 (Remote Control) [MEDIUM, Session 1].** Single command (`claude remote-control`), zero additional cost, enables the operator to check in and give instructions from phone or Mac. Run it, test it, and set it as default via `/config` if useful.

6. **Confirm and install a PDF generation capability [MEDIUM, Session 2].** The venture launch pipeline's promised deliverable is a PDF brief. If the `pdf` skill is not installed, the pipeline output will be markdown files. Install the `pdf` skill from the Anthropic marketplace, test it, and confirm the designer agent can use it.

7. **Add Haiku 4.5 to the routing table [MEDIUM, Session 2].** Once listing production begins at Stage 1-2, route high-volume, low-stakes tasks (tag generation, product description variants, structured data formatting) to Haiku 4.5. At 12x cheaper than Sonnet, this will meaningfully extend the Pro subscription's effective capacity. Document in config/routing.md.

8. **Operator: complete holding-company/BRIEF.md [HIGH operator effort, Session 1].** The business-advisor reads this file on every strategic pulse. Without portfolio strategy, goals, and risk tolerance defined, the advisor is working with incomplete context. Estimated 15-30 minutes of operator input.

9. **Implement Notion MCP for human oversight dashboard (IDEA-003) [MEDIUM, Phase 2].** Once the venture moves to Stage 1 (Building), the operator will need a mobile-friendly management view. Notion Free plan + official hosted MCP is the zero-cost path. The workspace design (ventures database, tasks database, review items database) should be built when installing the MCP.

10. **Add a dashboard regeneration routine [MEDIUM, Phase 2].** The dashboard's static data (venture status, financials, alerts) does not update automatically. Extend the Node.js server to serve live workspace data from API endpoints (reading venture BRIEFs, finance files, session logs), or create a PostToolUse hook that regenerates the static HTML data after each session.

11. **Evaluate Gelato as primary POD fulfilment partner alongside Printify [LOW, Phase 1].** Gelato's global print network includes fulfilment closer to Australian buyers, which may reduce international shipping costs and times for AU customers. At 100 orders/month, Gelato and Printify offer comparable margins (56.67% vs 61.84%). Worth running a unit economics comparison via the analyst agent before committing to a fulfilment partner.

12. **Add Recraft to the designer agent's AI tool routing table [LOW, Phase 1].** Recraft produces native SVG files — the only major AI image generator to do so. For POD designs that need to scale to 4500x5400px without quality loss, vector-native generation is a significant advantage. Add Recraft as a third option alongside ChatGPT and Gemini for vector-style designs.

---

## Sources

- https://code.claude.com/docs/en/best-practices — 2026-03-20 — Claude Code hook best practices and session management
- https://www.eesel.ai/blog/hooks-in-claude-code — 2026-03-20 — Hook event types, performance guidelines, use cases
- https://serenitiesai.com/articles/claude-code-hooks-guide-2026 — 2026-03-20 — Hook automation patterns for 2026
- https://www.practical-devsecops.com/mcp-security-vulnerabilities/ — 2026-03-20 — MCP security vulnerabilities: prompt injection, tool poisoning, mitigations
- https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/ — 2026-03-20 — MCP Sampling attack vectors (Palo Alto Unit 42)
- https://www.heyuan110.com/posts/ai/2026-03-10-mcp-security-2026/ — 2026-03-20 — 30 CVEs in 60 days MCP security overview
- https://mcpplaygroundonline.com/blog/mcp-security-tool-poisoning-owasp-top-10-mcp-scan — 2026-03-20 — OWASP MCP Top 10 and tool poisoning mitigations
- https://code.claude.com/docs/en/sub-agents — 2026-03-20 — Claude Code sub-agent documentation
- https://claudefa.st/blog/guide/agents/sub-agent-best-practices — 2026-03-20 — Sub-agent vs Agent Teams pattern selection
- https://medium.com/data-science-collective/sub-agent-vs-agent-team-in-claude-code-pick-the-right-pattern-in-60-seconds-e856e5b4e5cc — 2026-03-20 — Agent orchestration pattern guide
- https://platform.claude.com/docs/en/about-claude/pricing — 2026-03-20 — Claude model pricing (Opus 4.6, Sonnet 4.6, Haiku 4.5)
- https://www.nxcode.io/resources/news/claude-sonnet-4-6-vs-opus-4-6-complete-comparison-2026 — 2026-03-20 — Opus 4.6 vs Sonnet 4.6 capability comparison
- https://blog.galaxy.ai/compare/claude-haiku-4-5-vs-claude-opus-4-6 — 2026-03-20 — Haiku 4.5 vs Opus 4.6 for business automation use cases
- https://fast.io/resources/best-mcp-servers-productivity/ — 2026-03-20 — Best MCP servers for productivity 2026
- https://github.com/taylorwilsdon/google_workspace_mcp — 2026-03-20 — Unified Google Workspace MCP (Gmail, Calendar, Drive, Docs, Sheets)
- https://blog.marmalead.com/etsy-print-on-demand/ — 2026-03-20 — Etsy POD in 2026: fees, AI policy, what works
- https://www.etsy.com/seller-handbook/article/1275449912004 — 2026-03-20 — Etsy's official stance on AI-created items
- https://globalfeecalculator.com/etsy-fee-australia/ — 2026-03-20 — Etsy fee calculator for Australian sellers (AUD)
- https://www.podbase.com/blogs/gelato-vs-printify — 2026-03-20 — Gelato vs Printify margin comparison
- https://midjourney.fm/blog-Print-on-Demand-Comparison-Midjourney-vs-DALLE-3-vs-Leonardo-vs-Ideogram-36875 — 2026-03-20 — AI design tool comparison for POD (Midjourney, DALL-E 3, Leonardo, Ideogram)
- https://www.gtlaw.com.au/insights/ai-and-the-australian-consumer-law-governments-final-report-finds-framework-fit-for-purpose — 2026-03-20 — Australian Government final report on AI and ACL (October 2025)
- https://prosperlaw.com.au/is-your-ai-marketing-exposing-you-to-liability/ — 2026-03-20 — AI marketing liability under Australian Consumer Law
- https://fast.io/resources/ai-agent-audit-trail/ — 2026-03-20 — AI agent audit trail best practices 2026
- https://tetrate.io/learn/ai/mcp/mcp-audit-logging — 2026-03-20 — MCP audit logging for agent compliance
- https://medium.com/@ianloe/your-ai-agent-needs-an-audit-trail-not-just-a-guardrail-6a41de67ae75 — 2026-03-20 — Audit trail vs guardrail for AI agents
- https://dev.to/neo_one_944288aac0bb5e89b/the-2026-solopreneur-ai-stack-every-tool-you-need-39e2 — 2026-03-20 — 2026 solopreneur AI stack overview
- https://theaihat.com/ai-solopreneur-os/ — 2026-03-20 — AI Solopreneur OS patterns and tools

---

*Canonical version: holding-company/operations/AUDIT-SYSTEM-2026-03-20.md*
*Review copy: review-inbox/AUDIT-SYSTEM-2026-03-20.md*

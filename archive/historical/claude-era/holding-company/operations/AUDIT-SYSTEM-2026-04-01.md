# System Audit — 2026-04-01

**Auditor:** system-reviewer agent (claude-sonnet-4-6)
**Scope:** Full system — infrastructure, AI stack, business operations, web research
**Date:** 2026-04-01
**Workspace:** C:\ai-workspace\
**Previous Audit:** AUDIT-SYSTEM-2026-03-20.md (baseline)

---

## Executive Summary

The Jarvis AI Business OS has made meaningful progress since the March 20 audit. The most critical prior issue — the plaintext Etsy API key in `.mcp.json` — has been resolved (key now correctly uses `${ETSY_API_KEY}` environment variable reference). The agent roster has grown to nine well-scoped agents, the dashboard has been expanded to six themes with live approval actions, the delivery pipeline is documented end-to-end, and session continuity through nine session logs is robust. However, several structural gaps from the last audit remain unclosed: the `config/` folder still contains only two of the eight files specified in the Master Plan (delivery.md and security.md), the scheduled task manifest shows `lastRun: null` for all three tasks indicating they have never fired, the `for-review/review-status.json` contains two stale audit items from March 20 that remain at status `pending`, and the IDEAS.md inbox still contains all four original ideas despite being processed weeks ago. The venture itself remains at Stage 0 with no Etsy seller account and no live listings — the system is build-complete but launch-blocked on operator actions. The most important risk identified in this audit is a discrepancy in CLAUDE.md: it still references `/remote-control` and `--channels` as working features, but the most recent session log (2026-04-01) confirms these do not exist in Claude Code v2.1.87. This creates false expectations for the operator. Overall health: YELLOW — architecture is solid and pre-launch ready, but operator blockers are now the critical path.

---

## What's Working Well

- **Security gap closed:** The `.mcp.json` Etsy credential, flagged as HIGH severity in the March 20 audit, has been fixed. The API key now references `${ETSY_API_KEY}` as a Windows environment variable. This was the most urgent prior finding.
- **Hook coverage is comprehensive:** All six hook events have registrations in `.claude/settings.json` (SessionStart, Stop, PreToolUse with two matchers, PostToolUse with two hooks, SubagentStart, SubagentStop). The activity-log.sh hook was added since March 20, closing the prior activity.log gap.
- **Agent roster quality:** Nine agents are defined with well-structured system prompts, clear role boundaries, explicit "What You Never Do" sections, Australian legal context, and correct delivery routing. The researcher agent's 5-phase POD methodology (Trend Discovery → EverBee → POS Scoring → Competitive Mapping → Margin Analysis) is operationally mature. The compliance-researcher agent is a meaningful addition with correct disclaimer handling.
- **Dashboard architecture:** Six themed dashboards with a Node.js server at port 5050, real-time WebSocket push, and approval action endpoints are a strong design. The `dashboard-hook.sh` auto-starts the server and streams events correctly.
- **Delivery pipeline:** `config/delivery.md` is clear and complete with 17 type prefixes, a defined approval workflow, and Google Drive folder structure documented for when GWS auth is configured.
- **Decision log:** Forty-two decisions logged spanning 2026-03-13 through 2026-03-31 with rationale. This is genuinely useful — decisions like Obsidian MCP removal (2026-03-25) and the consolidation of review-inbox/ into for-review/ (2026-03-26) are well-documented.
- **Ideas pipeline quality:** Five ideas reviewed with substantive feasibility research. IDEA-002 (auto-improvement) and IDEA-004 (smart local routing) contain implementation plans that would remain valid for months. IDEA-005 (Etsy MCP) is correctly blocked with a clear setup plan for when the developer app is approved.
- **Session continuity:** Nine session logs spanning 2026-03-13 to 2026-04-01. The most recent log (2026-04-01) is particularly honest — it correctly identifies that prior research gave inaccurate information about remote access and documents the corrections made.
- **Financial baseline:** costs.md, revenue.md, and monthly/2026-03.md are present and correctly structured. The system acknowledges it is pre-revenue and tracking accurately from day one.
- **Venture launch pipeline:** The seven-stage pipeline defined in AGENTS.md (Advisor → Researcher → Analyst → Designer → Writer → Quality-Checker → PDF Brief → Operator) with skip logic and failure paths is operationally ready. The research-framework.md in the venture adds useful context for the researcher agent.
- **Safety permissions:** `.claude/settings.local.json` has a well-scoped deny list (rm -rf, rmdir, del, format, shutdown, reboot). The safety-check.sh hook correctly normalises Windows paths and checks both `c:/ai-workspace/` and `/c/ai-workspace/` path forms.

---

## Issues Found

| Location | Domain | Issue | Severity | Recommended Fix |
|---|---|---|---|---|
| `CLAUDE.md` (Interface section) | Infra | CLAUDE.md describes `/remote-control` and `--channels` as working remote access features. Session log 2026-04-01 explicitly confirms these do NOT exist in Claude Code v2.1.87. The spec is misleading the operator about current capabilities. | HIGH | Update CLAUDE.md Interface section to match what `docs/remote-access-guide.md` accurately describes: scheduled tasks + Gmail notifications + local dashboard are what works today. Reference the guide for full details. |
| `config/` | Infra | Six of eight Master Plan config files remain absent: routing.md, approval-gates.md, failure-playbooks.md, active-ventures.md, quality-gates.md, workflow-tests.md. This was flagged HIGH in the March 20 audit and is still open. The system simplification decision (2026-03-19) consolidated content into CLAUDE.md, but `routing.md` is still missing and needed — there is no documented model routing policy outside agent frontmatter. | HIGH | Carry over from prior audit: create at minimum `config/routing.md` (which models for which agents, when to use Haiku 4.5, rationale). The others are LOW priority given CLAUDE.md consolidation. |
| `dashboard/scheduled-tasks-manifest.json` | Infra | All three scheduled tasks show `lastRun: null` and `nextRun` dates in March 2026 (past dates). These tasks have never run. The `nextRun` timestamps are stale — they are past dates. There is no evidence in `logs/` that the scheduled task system has fired even once. | HIGH | Verify whether the Claude Code scheduled task engine is actually operational. The tasks are defined in the manifest but show no execution history. If the scheduled task MCP is not configured, the daily strategic pulse and weekly health check are not running. Operator must check VS Code Scheduled section and re-trigger. |
| `for-review/review-status.json` | Ops | Two items from March 20 (AUDIT-SYSTEM-2026-03-20.md and AUDIT-SYNTHESIS-2026-03-20.md) remain at status `pending`. These are 12-day-old audit reports that the operator has presumably already read given sessions have continued. Also: the approved IDEA-smart-local-llm-routing item (approved 2026-03-16) is still in the file with status `approved` rather than being archived or cleared. The JSON currently has no items for March 25–31 activity. | MEDIUM | Mark the March 20 audit items as `reviewed` or `dismissed`. Establish a review-status.json hygiene pattern: items older than 14 days at `pending` should be auto-transitioned to `expired`. Consider adding missing items from March sessions. |
| `ideas/IDEAS.md` | Ops | All four original operator ideas from March 2026 are still present in full text in IDEAS.md. They were all processed into `ideas/reviewed/` weeks ago. The standing instruction and IDEAS.md header both say "You can delete ideas from here after they appear in the tracker." This was flagged LOW in the March 20 audit and is still open. | MEDIUM | Clear IDEAS.md of all four processed ideas, leaving only the header/instructions. The session-start.sh hook reads this file every session, adding unnecessary tokens to the context. |
| `hooks/activity-log.sh` | Infra | The activity-log.sh PostToolUse hook writes to `/c/ai-workspace/logs/activity.log` (Unix path). On Windows under Git Bash, this resolves to a different location than `C:/ai-workspace/logs/activity.log` (the Windows path). The file at `C:/ai-workspace/logs/activity.log` does contain entries, so it appears to work. However, the path inconsistency between Unix `/c/` and Windows `C:/` in hooks is a fragility. The dashboard-hook.sh uses the same `/c/` prefix pattern and appears to work, but this should be verified explicitly. | MEDIUM | Test that `bash hooks/activity-log.sh` on Windows writes to the correct file at `C:/ai-workspace/logs/activity.log`. If it works, document this path equivalence in a comment in the script. If not, update to use `c:/ai-workspace/logs/activity.log` for consistency with `session-start.sh` and `safety-check.sh`. |
| `agents/AGENTS.md` | AI Stack | AGENTS.md lists `superpowers:code-reviewer` as an "Active Agent" in a table alongside the nine real agents. This was flagged LOW in the March 20 audit. The superpowers plugin (v5.0.2, 14 skills) is acknowledged in CLAUDE.md and decision-log.md as installed, but there is no verification it is active. There is no entry in `.claude/settings.json` for it. If the plugin provides the code-reviewer skill, it may load automatically; if not, the AGENTS.md table is misleading. | MEDIUM | Verify whether superpowers:code-reviewer is accessible in the current session. If it is, add a note clarifying it loads from the plugin (not from `.claude/agents/`). If not, move it to a "Planned Agents" or "Plugin Agents" section. |
| `holding-company/BRIEF.md` | Ops | The holding company BRIEF is materially incomplete. While entity structure questions have been added (good), the core fields — Portfolio Strategy, Operator Goals, Risk Tolerance, Key Constraints — all contain only one line of content or are operator-defined placeholders. The business-advisor agent reads this on every strategic pulse. | MEDIUM | Operator should fill in the four main sections. This has been flagged in two consecutive audits — it should be treated as a standing blocker for strategic advisory quality. |
| `Etsy Shared Secret` | Infra/Security | `.mcp.json` still has `"ETSY_SHARED_SECRET": "REPLACE_AFTER_REGENERATING"` — a placeholder rather than an environment variable reference. The prior Shared Secret was exposed in chat history (flagged in session logs). This means the Etsy MCP cannot connect until the operator regenerates the secret and configures it. The API key is secured, but the auth flow is incomplete. | MEDIUM | Operator must: (1) regenerate Shared Secret from Etsy developer dashboard, (2) update `.mcp.json` to use `${ETSY_SHARED_SECRET}` env var reference, (3) set the environment variable in Windows. This is a precondition for Etsy MCP connectivity. |
| `config/` — routing.md absent | AI Stack | Agent frontmatter specifies `model: opus` for business-advisor and `model: sonnet` for all other agents. However there is no documented policy for when to use Haiku 4.5. Web research confirms Haiku 4.5 is $1/$5 per million tokens vs Sonnet 4.6 at $3/$15 — a 3x cost difference. For high-volume tasks (bulk product descriptions, tag generation, simple formatting), Haiku 4.5 could significantly reduce API costs if the system moves off the Pro subscription to API usage. | LOW | Create `config/routing.md` documenting the current three-model assignment (Opus for advisor, Sonnet for other agents) and identify which task types could use Haiku 4.5 (tag generation, simple rewrites, classification). This also documents the rationale for future operators or audit reviews. |
| `venture-01-pod-store` Stage 0 blockers | Ops | The venture has been at Stage 0 since 2026-03-13. The blockers listed in `current-state.md` (Etsy developer app approval, Etsy seller account creation, GWS auth setup, EverBee installation) are all operator actions. The system has done everything it can at this stage. There is no sprint plan or task tracking in `tasks/` to manage the launch sequence once the operator completes their actions. | LOW | Create `ventures/venture-01-pod-store/tasks/sprint-01-launch.md` with a checklist of the launch sequence so that when operator completes their actions, the first niche launch is clearly defined with no ambiguity. |
| `session-end.sh` hook | Infra | The session-end.sh hook blocks stopping if no session log exists for today. Today (2026-04-01) a session log already exists, so this audit session can stop cleanly. However, the hook uses `exit 2` to block stopping — in Claude Code, exit 2 means "block and feed stderr to Claude." This is correct behaviour. The potential edge case is that a session that does all its work in a single day's earlier session log might be blocked from stopping by a legitimate audit-only session. Assessment: intended design, but verify it does not block this audit session. | LOW | No immediate action required — the design is correct and today's session log exists. Consider adding a FORCE_STOP mechanism for edge cases (e.g., an environment variable that bypasses the check for maintenance sessions). |
| `docs/phase2-mcp-setup.md` | Infra | This document has Status: "Not started" as of 2026-03-13, but many Phase 2 steps have been completed (Etsy MCP installed, GWS CLI installed, activity log hook added, dashboard built). The document is stale and may confuse future sessions. | LOW | Update the status header of phase2-mcp-setup.md to reflect what's been completed and what remains (GWS auth setup being the main gap). |
| `Haiku 4.5 not referenced anywhere` | AI Stack | Claude Haiku 4.5 ($1/$5 per MTok) is not mentioned in CLAUDE.md, any agent definition, or any config file. At 3x lower cost than Sonnet 4.6, it is suited for bulk low-complexity tasks. For a POD business generating hundreds of product descriptions, this could matter at scale. | LOW | Assess: would any current agent tasks be suitable for Haiku 4.5 (tag generation, keyword research formatting, template completion)? If yes, note this in config/routing.md when created. |

---

## Infrastructure Assessment

**Rating: YELLOW — improved from last audit, one new HIGH found**

### Config Completeness

The config/ folder remains at two of eight Master Plan files (delivery.md, security.md). This has been a recurring finding across two audits. The 2026-03-19 simplification decision to consolidate into CLAUDE.md was legitimate, but routing.md is still needed as a standalone document. The other six missing files (approval-gates.md, failure-playbooks.md, active-ventures.md, quality-gates.md, workflow-tests.md) represent duplicated content from CLAUDE.md — acceptable for a solo operator system but worth noting.

Assessment: routing.md is the one file that should be created. The rest are "nice to have" for a solo operator.

### Hook Coverage

The hook system has matured since March 20. The addition of activity-log.sh PostToolUse hook closes the prior gap. Six lifecycle events now have hooks:

- `SessionStart` — reads latest session log + IDEAS.md (correct, fast)
- `Stop` — blocks if no session log written (correct use of exit 2)
- `PreToolUse (all tools)` — posts to dashboard server (async, non-blocking)
- `PreToolUse (Write|Edit)` — runs safety-check.sh (blocking, correct)
- `PostToolUse (all tools)` — posts to dashboard (async) + logs activity (async)
- `SubagentStart / SubagentStop` — posts to dashboard (async)

Web research confirms Claude Code now has 24 hook lifecycle events (up from previous documentation of 12-17). Events NOT currently hooked that have potential value:

- `UserPromptSubmit` — could validate prompts or log intent before processing
- `PostToolUseFailure` — currently not hooked; errors are not deterministically caught
- `PreCompact / PostCompact` — context compaction events not monitored
- `FileChanged` — could trigger dashboard refresh when workspace files change
- `InstructionsLoaded` — could verify CLAUDE.md integrity on load

The `PostToolUseFailure` hook is the most valuable missing hook. Tool failures currently go unlogged to system.log (which is nearly empty despite months of sessions), making it hard to diagnose recurring issues.

### Security Posture

The HIGH security issue from March 20 (plaintext API key) has been resolved. The `.mcp.json` now uses `${ETSY_API_KEY}` correctly. The Etsy Shared Secret remains a placeholder, but this is documented and does not pose an active security risk (it is not a valid credential).

Current threat landscape (from web research, April 2026): MCP prompt injection remains the primary attack vector, with CVEs filed against Anthropic's own Git MCP server (CVE-2025-68145, CVE-2025-68143, CVE-2025-68144) for path validation bypass and argument injection. The system's untrusted-content isolation rule (config/security.md) is the correct mitigation. No additional vulnerabilities were identified in the current system configuration.

The `safety-check.sh` hook does not intercept Bash commands — only Write and Edit tool inputs. This is a documented and accepted design gap (consistent with the workspace architecture), but means a prompt injection attack targeting Bash would not be caught by the hook. The deny list in `settings.local.json` (rm -rf, rmdir, del, format, shutdown, reboot) provides a complementary layer.

### Session Continuity

Nine session logs spanning 2026-03-13 to 2026-04-01 provide strong continuity. The `session-start.sh` hook loads the most recent log automatically. The current-state.md for venture-01 is up to date as of 2026-03-31. The most recent session log (2026-04-01) is particularly valuable: it documents a correction of prior inaccurate information about remote access, which demonstrates the memory system is functioning for error correction, not just progress tracking.

One gap: the `session-start.sh` hook loads IDEAS.md every session but IDEAS.md still contains all four original ideas (processed weeks ago), adding unnecessary context on every startup.

### Dashboard Status

The dashboard-server.js serves six themed dashboards at port 5050. The server reads live from the workspace (for-review/ directory, review-status.json, scheduled-tasks-manifest.json). The WebSocket event streaming from claude-code hooks is wired correctly. The MASTER-PLAN.md described a simpler architecture (embedded JavaScript data in static HTML); the actual implementation is more sophisticated (Node.js + WebSocket), which is appropriate.

One concern: the scheduled-tasks-manifest.json shows `lastRun: null` and `nextRun` dates in March 2026 (all in the past). This suggests the scheduled task system has not run. The dashboard will show misleading "never run" data for these tasks.

---

## AI Stack Assessment

**Rating: GREEN — agent quality is high**

### Agent Definition Quality

All nine agents are well-defined. Key observations:

| Agent | Model | Quality Notes |
|---|---|---|
| business-advisor | opus | Strong — dual-mode (proactive/on-demand), frequency guard to prevent duplicate daily pulses, clear role boundaries between what/why vs. researcher's evidence |
| researcher | sonnet | Excellent — 5-phase POD methodology with POS scoring is production-ready; EverBee integration via browser automation is correctly scoped |
| analyst | sonnet | Strong — POD unit economics calculator with Etsy fee stack and AU GST considerations is accurate and complete |
| designer | sonnet | Good — covers both image assets (browser automation) and digital products (native). Image resolution strategy is realistic |
| writer | sonnet | Good — Australian English, anti-AI-language rules, no false claims standard |
| quality-checker | sonnet | Strong — AI language detector banned list is specific and actionable; legal flag policy (never self-clear) is correct |
| compliance-researcher | sonnet | Good — correct disclaimer, ATO/ASIC citation standard, never-autonomous for legal matters |
| system-reviewer | sonnet | This agent — verifying the agent definition is consistent with the task being performed now. Correct. |
| audit-synthesizer | sonnet | Good — correct scope (synthesis only, no re-research), proper handling of missing-audit-file edge case |

Missing agent roles that would add value at Stage 1 (Building):
- **Scheduler/Operations Manager** — day-to-day task sequencing, monitoring scheduled task results, triaging approvals. Currently Jarvis (main thread) handles this but a dedicated sub-agent would free main context.
- **SEO Specialist** — the `etsy-seo` skill exists in `skills/etsy-seo/` but there is no dedicated agent to orchestrate Etsy SEO strategy, tag research, and listing optimisation cycles.

### Model Usage

Current model allocation:
- `business-advisor`: `model: opus` — appropriate, strategy requires broad reasoning
- All other eight agents: `model: sonnet` — appropriate for research, writing, analysis

Haiku 4.5 is not referenced anywhere in the system. At $1/$5 per MTok (vs Sonnet at $3/$15), it is suitable for: tag generation, keyword extraction, simple data formatting, product description first drafts. Given the system runs on a Pro subscription (not API-based), Haiku 4.5 is not directly relevant today — but if the system ever moves to API-based billing (a natural progression), having a routing policy in place would prevent unnecessary cost.

Web research confirms: Claude Haiku 4.5 has a 200k context window, extended thinking support, and is positioned as "fastest model with near-frontier intelligence" at $1/$5 per MTok. It is suitable for high-volume, structured tasks.

### MCP Readiness

Current MCP configuration (`.mcp.json`): only Etsy MCP is configured, and it is non-functional (Shared Secret placeholder, pending OAuth).

The system references several MCPs as "available" in CLAUDE.md (Claude-in-Chrome, Gmail, Google Workspace CLI), but none are confirmed as connected MCPs. The Google Workspace CLI (`gws` command) is described as "installed; operator must run `gws auth setup`" — the auth has not been completed.

Assessment: The system is MCP-poor for its current stage. The Etsy MCP is the top priority (venture-specific), but Gmail and Google Drive MCPs would unlock the delivery pipeline (draft notifications, Drive sync). The browser automation (Claude-in-Chrome) is critical for the designer agent's image generation workflow.

### Orchestration Patterns

The venture launch pipeline (Advisor → Researcher → Analyst → Designer → Writer → Quality-Checker) is a well-defined sequential pipeline. Web research confirms this hub-and-spoke model (orchestrator dispatches serial or parallel sub-agents) is the standard Claude Code pattern. The skip logic and failure paths documented in AGENTS.md match current best practices.

One gap: the pipeline has no explicit parallel execution. When launching a niche, Researcher, Analyst, and Designer could run in parallel after Advisor completes — they have minimal dependencies on each other. This would reduce pipeline wall-clock time.

---

## Operations Assessment

**Rating: YELLOW — launch-ready architecture, operator actions are the bottleneck**

### Venture Setup Quality

The venture-01-pod-store BRIEF.md is complete with stage, goals, KPIs, target market, and key decisions. The `current-state.md` is detailed and up to date (2026-03-31). The `research-framework.md` adds useful configuration for the researcher. However:

- KPI targets ($100 USD revenue, 50 listings) have no progress — all metrics at zero after 19 days
- Stage remains "Idea" — no advancement despite significant system investment
- The `tasks/` directory is empty — no sprint plan exists for launch

This is expected at Stage 0, but the transition from Stage 0 to Stage 1 is entirely blocked by operator-side actions. The system has no way to advance without the operator completing the Etsy account setup.

### Delivery Pipeline

The pipeline (outputs/ → for-review/ → Google Drive → Gmail draft → Dashboard) is fully documented in `config/delivery.md`. However, end-to-end it has never been tested — no PDF briefs have been produced, Google Drive sync is not configured, and Gmail draft notifications have not been created. The pipeline is designed but untested.

The `for-review/` folder currently contains:
- `REPORT-pod-niche-research-notes-2026-03-13.md` — pending (12 weeks old)
- `IDEA-smart-local-llm-routing-2026-03-15.md` — approved
- `AUDIT-SYSTEM-2026-03-20.md` — pending (12 days old)
- `AUDIT-SYNTHESIS-2026-03-20.md` — pending (12 days old)
- `OPERATOR-ACTION-system-setup-2026-03-25.pdf` — not in review-status.json

The `OPERATOR-ACTION-system-setup-2026-03-25.pdf` file is present in for-review/ but missing from review-status.json — a data integrity gap.

### Financial Tracking

The financial tracking structure is correct (costs.md, revenue.md, monthly/2026-03.md, tax-obligations.md, entity-research.md). The system accurately records $0 revenue and ~$31 AUD monthly cost. The April 2026 monthly file (2026-04.md) has not been created yet.

One gap: `finance/monthly/` only has one file (2026-03.md). The April file should be created at the start of April. No automation exists to create monthly summary files.

The tax-obligations.md file is well-researched (2025-26 rates, GST thresholds, BAS requirements). The entity-research.md file (sole trader recommendation) is confirmed present.

### Ideas Pipeline

| IDEA | Status | Assessment |
|---|---|---|
| 001 — Remote Control | planned | Partially implemented — plugins installed, `--channels` flag confirmed absent in v2.1.87. Implementation can advance when Claude Code updates or operator upgrades to Max for RemoteTrigger. |
| 002 — Auto-Improvement | planned | Well-researched. Should be deprioritised until the system is generating revenue — it adds system complexity before core value delivery. |
| 003 — Human Oversight Dashboard | planned | The built dashboard (localhost:5050) partially satisfies this. Notion integration would add mobile access. |
| 004 — Smart Local LLM Routing | deferred (2026-03-19) | Correctly deferred for cloud-only strategy. Still has value when system scales. |
| 005 — Etsy API MCP | blocked | Correctly blocked. The MCP server is built and waiting. |

Ideas pipeline is well-managed. No new ideas appear in IDEAS.md. The tracker was last updated 2026-03-20 — it should be updated to reflect IDEA-001 status (partially implemented per session logs).

### Quality Gates

The quality-checker agent definition is well-calibrated. The review process (operator moves file to for-review/approved/ or via dashboard) is practical for a solo operator. The two-step review (quality-checker verdict + operator approval) is appropriate for the ACL risk level.

Concern: the for-review/approved/ and for-review/denied/ directories are empty. The review workflow has not been tested end-to-end. The first niche launch will be the real test.

---

## Technology & Tool Gaps

Based on web research (April 2026):

### 1. Gelato over Printify for Australian POD

The `research-framework.md` and `analyst.md` list Printify as the preferred POD provider. Web research finds Gelato has a significant advantage for Australian sellers: Gelato routes orders to local printers in Australia (3-5 day delivery vs. 14+ days from Printify's US/EU partners). For a business targeting Australian customers, this is material. Printify does have some Australian partners (Print Bar, Prima Printing), but Gelato's local production network is more mature. Gelato+ costs $24/month vs Printify free tier — but local fulfilment improves conversion rates and customer reviews. This should be factored into the analyst's unit economics model.

### 2. Ideogram for POD Typography

The designer agent routes to ChatGPT (graphic art, typography) and Gemini (photorealistic). Web research finds Ideogram is now the leading tool specifically for typography-heavy designs — logos, quote art, text-overlay designs. These are high-margin POD products. The designer agent currently does not reference Ideogram. Adding it as a third routing option for text-heavy designs would expand the product range.

### 3. Etsy June 2025 Originality Policy

The system's POD research does not reflect Etsy's June 2025 originality update. Key changes: AI content must be disclosed in listing descriptions, listings must be based on "a seller's original design" (not purchased prompts or template systems), and generic template-based designs face removal risk. The quality-checker agent should add an Etsy originality compliance check. The researcher agent's prompt-writing methodology should explicitly use original prompts, not template prompts.

### 4. Haiku 4.5 for Bulk Tasks

Confirmed via API docs: Haiku 4.5 is $1/$5 per MTok vs Sonnet 4.6 at $3/$15. For bulk content tasks (tag generation, keyword lists, simple descriptions), Haiku 4.5 delivers 3x cost reduction. Not relevant for the Pro subscription plan, but relevant if API usage grows.

### 5. PostToolUseFailure Hook

Claude Code has 24 lifecycle events including `PostToolUseFailure` — not currently hooked. Tool failures currently go unlogged, making it difficult to diagnose recurring issues. A simple hook that appends to `logs/system.log` would provide visibility into failures without impacting performance.

### 6. FileChanged and PreCompact Hooks

`FileChanged` (triggers when watched files change on disk) and `PreCompact` / `PostCompact` (context compaction lifecycle) are available but not used. FileChanged on `for-review/` could trigger a dashboard data refresh. PreCompact could log the context usage before compaction.

### 7. MCP Governance — Linux Foundation Adoption

Anthropic donated MCP to the Linux Foundation in December 2025. This makes MCP a cross-vendor standard — OpenAI, Google, and most major AI platforms now support it. This strengthens the long-term viability of the MCP-based integration architecture. No immediate action required, but worth noting for future planning.

### 8. Playwright MCP for Browser Automation

Microsoft's official Playwright MCP is now the recommended standard for browser automation in Claude Code agents. The current system uses `Claude-in-Chrome` for browser tasks. Playwright MCP provides accessibility-snapshot-based interaction (more reliable than screenshot-based) and is purpose-built for programmatic browser control. The designer agent's browser automation for ChatGPT/Gemini image generation could benefit from this.

---

## MCP Priority List

1. **Google Workspace (Gmail + Drive + Calendar)** — unlocks the entire delivery pipeline (Gmail draft notifications, Drive sync, approval workflow). Already installed via GWS CLI. Blocked on `gws auth setup` — operator action. This is the single highest-value unblocked action available. Estimated value: enables end-to-end delivery pipeline, remote approval workflow, scheduled task notifications.

2. **Brave Search or Firecrawl** — web search capability for the researcher agent currently relies on WebSearch/WebFetch built-in tools. A dedicated Brave Search MCP provides higher rate limits, better structured results, and domain filtering. Firecrawl adds deep content extraction for competitor research. Estimated value: significantly improves researcher agent output quality.

3. **Etsy MCP** — already built and waiting. Blocked on developer app approval + operator Shared Secret setup. Once unblocked, enables automated listing creation, inventory management, and sales data feed. Estimated value: completes the end-to-end POD automation pipeline.

4. **Playwright MCP** — replaces or supplements Claude-in-Chrome for designer agent browser automation. More reliable for programmatic image generation at scale. Install: `npx @playwright/mcp`. Estimated value: increases design generation reliability and reduces manual intervention.

5. **Notion MCP** — satisfies IDEA-003 (Human Oversight Dashboard) with mobile access. Official Notion MCP at `developers.notion.com` handles OAuth automatically. Estimated value: gives operator mobile-friendly venture status view and remote approval capability.

---

## Quick Wins

Changes completable in a single session, zero or near-zero cost:

1. **Fix CLAUDE.md Interface section** — remove references to `/remote-control` and `--channels` as current features. Replace with accurate description matching `docs/remote-access-guide.md`. (10 minutes)

2. **Clear IDEAS.md** — remove the four processed ideas from the inbox, leaving only the header. Reduces session-start hook context by ~800 tokens every session. (5 minutes)

3. **Mark stale review-status.json items** — transition March 20 audit items from `pending` to `reviewed`. Add the missing OPERATOR-ACTION PDF to the JSON. (15 minutes)

4. **Create config/routing.md** — document the three-model policy (Opus for business-advisor, Sonnet for all other agents, Haiku 4.5 candidates identified). (20 minutes)

5. **Add PostToolUseFailure hook** — wire a simple hook that appends tool failure events to `logs/system.log`. Closes the tool failure logging gap with one hook registration and a 10-line shell script. (20 minutes)

6. **Fix Etsy Shared Secret in .mcp.json** — update to `${ETSY_SHARED_SECRET}` env var reference (operator must then set the variable). (5 minutes)

7. **Create venture tasks/sprint-01-launch.md** — a simple checklist for the first niche launch sequence so that when operator completes Etsy setup, the next steps are unambiguous. (20 minutes)

8. **Create holding-company/finance/monthly/2026-04.md** — the April monthly summary file should be created at the start of the month. (5 minutes)

9. **Update ideas-tracker.md** — IDEA-001 status should be updated from `planned` to `in-progress` (plugins installed, partially implemented). Tracker was last updated 2026-03-20. (5 minutes)

10. **Add Gelato to analyst.md POD provider table** — the current table lists Printful/Printify/Gooten/Redbubble and is missing Gelato, which has a strong Australian local fulfilment advantage. (10 minutes)

---

## Prioritised Recommendations

1. **Fix the CLAUDE.md Interface section discrepancy (HIGH).** The current description of remote access in CLAUDE.md is factually wrong. The session log from today explicitly corrected this. CLAUDE.md is the document Jarvis reads at every session start — a misleading Interface section creates ongoing confusion. Update it to match the accurate description in `docs/remote-access-guide.md`. This is the highest-priority fix because it affects every session.

2. **Verify and re-trigger the scheduled task system (HIGH).** All three scheduled tasks show `lastRun: null`. If the daily strategic pulse and weekly health check have not run since setup on 2026-03-25, the system has been operating without its primary autonomous monitoring capability for 6+ days. Check the VS Code Scheduled section and ensure the `mcp__scheduled-tasks__*` tools are available and configured. If the scheduled task MCP is not running, this is a significant operational gap.

3. **Complete the GWS auth setup (HIGH impact, operator action).** The delivery pipeline (Gmail notifications, Google Drive sync, remote approval via Drive) is fully designed but zero-percent functional because `gws auth setup` has never been run. This is the single most impactful operator action available — it unlocks end-to-end delivery for all future venture outputs.

4. **Complete Etsy setup (HIGH impact, operator action).** Create Etsy seller account + regenerate Shared Secret. This unblocks the Etsy MCP, which enables automated listing creation and is the core monetisation path for the entire system.

5. **Create config/routing.md (MEDIUM, quick win).** Two consecutive audits have flagged this. Even a one-page document covering model assignments and Haiku 4.5 candidates would close this recurring finding.

6. **Add the Etsy June 2025 originality policy to the quality-checker agent.** The quality-checker currently checks ACL compliance, brand voice, and AI language detection, but does not verify Etsy's originality requirement (original prompts, AI disclosure in listing description). Adding these two checks prevents listings from being removed after publication. This is a low-effort, high-consequence addition.

7. **Implement PostToolUseFailure hook (MEDIUM, quick win).** System.log has essentially no entries despite months of sessions. Tool failures are currently invisible. A PostToolUseFailure hook writing to system.log would make issues diagnosable.

8. **Add Gelato to the POD provider analysis and update research-framework.md (MEDIUM).** Gelato's Australian local fulfilment advantage is material for an Australian seller. The analyst unit economics model should include Gelato's cost structure alongside Printify.

9. **Implement the auto-improvement system (IDEA-002) in Phase 2 (LOW, medium-term).** Once the first venture reaches Stage 1 and is generating listings, the auto-improvement capability would allow the system to discover and install MCPs, create custom skills, and maintain itself. The implementation plan in IDEA-002 is detailed and ready. This should wait until post-launch to avoid adding complexity before core value delivery.

10. **Upgrade to Claude Max for RemoteTrigger when venture reaches Stage 1.** The operator's goal of remote oversight requires on-demand triggers (not just scheduled tasks). RemoteTrigger requires Max plan. At ~$155 AUD/month vs ~$31 AUD/month, the upgrade cost is justified once the venture is generating revenue. The Telegram/Discord plugins are already installed and waiting.

---

## Sources

- https://code.claude.com/docs/en/hooks — 2026-04-01 — Claude Code hook lifecycle events (24 events confirmed), hook configuration best practices, exit code handling
- https://platform.claude.com/docs/en/about-claude/models/overview — 2026-04-01 — Current Claude model lineup: Opus 4.6 ($5/$25 per MTok, 1M context), Sonnet 4.6 ($3/$15 per MTok, 1M context), Haiku 4.5 ($1/$5 per MTok, 200k context)
- https://www.practical-devsecops.com/mcp-security-vulnerabilities/ — 2026-04-01 — MCP security vulnerabilities: prompt injection (73% of production AI deployments in 2025), tool poisoning, CVEs in Anthropic's Git MCP server
- https://www.docker.com/blog/mcp-security-issues-threatening-ai-infrastructure/ — 2026-04-01 — MCP security issues; five attack surfaces (prompt injection, memory poisoning, tool misuse, supply chain, data exfiltration)
- https://www.growingyourcraft.com/blog/gelato-vs-printful-vs-printify-comparison-for-international-etsy-sellers — 2026-04-01 — Gelato local fulfilment advantage for Australian/international sellers (3-5 day delivery vs 14+ days), Gelato+ $24/month
- https://www.avada.io/blog/print-on-demand-australia/ (via web search result) — 2026-04-01 — Top POD companies in Australia; Printify Australian partners (Print Bar, Prima Printing)
- https://medium.com/@libelune/etsy-changes-the-rules-what-pod-and-ai-creators-need-to-know-june-2025-ce447125f86a — 2026-04-01 — Etsy June 2025 originality update: "based on a seller's original design" requirement; AI disclosure in listing descriptions mandatory
- https://www.etsy.com/legal/creativity/ — 2026-04-01 — Etsy's official Creativity Standards; original prompts requirement; prohibition on selling AI prompt bundles
- https://aicashcaptain.com/selling-ai-art-copyright-rules-2026-update/ — 2026-04-01 — 2026 enforcement direction: transparency required, AI segregation, hiding AI usage violates Creativity Standards
- https://www.toolify.ai/ai-news/the-ultimate-print-on-demand-comparison-midjourney-vs-dalle-3-vs-leonardo-vs-ideogram-101985 — 2026-04-01 — AI design tool POD comparison: Ideogram leads for typography/text rendering; Midjourney for artistic quality; Leonardo for editing/concept art
- https://fast.io/resources/ai-agent-audit-trail/ — 2026-04-01 — AI agent audit trail best practices: immutable IDs, capture "why" not just "what", 6-month minimum retention (EU AI Act guidance)
- https://galileo.ai/blog/ai-agent-compliance-governance-audit-trails-risk-management — 2026-04-01 — AI agent compliance and governance; audit trail requirements for agentic systems
- https://code.claude.com/docs/en/sub-agents — 2026-04-01 — Claude Code sub-agent best practices: max 3-4 subagents, project agents in .claude/agents/, parallel vs sequential patterns
- https://www.gtlaw.com.au/insights/ai-and-the-australian-consumer-law-governments-final-report-finds-framework-fit-for-purpose — 2026-04-01 — Australian Government October 2025 final report: ACL framework found fit-for-purpose for AI; businesses remain liable for AI outputs in marketing
- https://www.accc.gov.au/system/files/recent-developments-in-artifical-intelligence.pdf — 2026-04-01 — ACCC December 2025 AI snapshot: AI-generated fake reviews up 1000%+ 2022-2025; 35 recommendations from Digital Platform Services Inquiry
- https://blog.premai.io/25-best-mcp-servers-for-ai-agents-complete-setup-guide-2026/ — 2026-04-01 — Top MCP servers for 2026; Google Workspace MCP (Gmail, Drive, Calendar, Sheets, Docs); Notion official MCP; Playwright MCP for browser automation
- https://www.eesel.ai/blog/hooks-in-claude-code — 2026-04-01 — Claude Code hooks practical guide 2026; PostToolUseFailure hook usage; FileChanged and PreCompact hooks
- https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns — 2026-04-01 — Claude Code hooks production patterns; 12 hook events documented (older source — current docs confirm 24)

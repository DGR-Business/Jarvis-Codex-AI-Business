# System Audit Synthesis — 2026-04-01
Based on: AUDIT-SYSTEM-2026-04-01.md

---

## Executive Summary

The system is architecturally sound and pre-launch ready — the agent roster is mature, the hook system is comprehensive, security has improved since the last audit, and session continuity is strong. Three concerns dominate: (1) CLAUDE.md still describes remote access features that do not exist in the current Claude Code version, creating a misleading spec the system reads every session; (2) all three scheduled tasks have never run, meaning the autonomous monitoring backbone has been silently inactive since setup; (3) the entire delivery pipeline and Etsy MCP remain untested and non-functional because two operator actions — GWS auth setup and Etsy seller account creation — have not been completed. Overall health: YELLOW. The system cannot advance to Stage 1 without operator-side unblocking.

---

## Prioritised Action Plan

### Immediate (this session — quick wins, zero cost)

- [ ] Fix CLAUDE.md Interface section — remove `/remote-control` and `--channels` references; replace with accurate description matching `docs/remote-access-guide.md` (scheduled tasks + Gmail notifications + local dashboard). This file is read every session; a wrong spec compounds with every run. — [Issues table, row 1; Prioritised Recommendations #1; Quick Wins #1]

- [ ] Clear IDEAS.md inbox — remove the four processed ideas that have lived in IDEAS.md since March; leave only the header and instructions. Reduces ~800 tokens loaded by `session-start.sh` on every session startup. — [Issues table, row 5; Quick Wins #2]

- [ ] Mark stale review-status.json items — transition the two March 20 audit items (`AUDIT-SYSTEM-2026-03-20.md`, `AUDIT-SYNTHESIS-2026-03-20.md`) from `pending` to `reviewed`. Add the missing `OPERATOR-ACTION-system-setup-2026-03-25.pdf` entry. — [Issues table, row 4; Quick Wins #3]

- [ ] Create config/routing.md — document the three-model policy (Opus for business-advisor, Sonnet for all other agents, Haiku 4.5 identified for bulk tasks at scale). Closes a finding raised in two consecutive audits. — [Issues table, row 2 and row 9; Quick Wins #4; Prioritised Recommendations #5]

- [ ] Fix Etsy Shared Secret in .mcp.json — update placeholder `"REPLACE_AFTER_REGENERATING"` to `${ETSY_SHARED_SECRET}` env var reference (operator then sets the variable). Low-effort code change; operator action required to complete. — [Issues table, row 8; Quick Wins #6]

- [ ] Add PostToolUseFailure hook — wire a hook appending tool failure events to `logs/system.log`. System.log is nearly empty despite months of sessions; failures are invisible. One hook registration + a 10-line shell script. — [Issues table, row 5 in Tech Gaps; Quick Wins #5; Prioritised Recommendations #7]

- [ ] Add Etsy June 2025 originality checks to quality-checker agent — add two checks: (a) AI content disclosed in listing description, (b) design based on original prompts not templates. Prevents listings from being removed post-publication. — [Technology & Tool Gaps #3; Prioritised Recommendations #6]

- [ ] Add Gelato to analyst.md POD provider table and research-framework.md — Gelato's Australian local fulfilment (3-5 day delivery vs 14+ days from Printify) is material for an Australian seller; the unit economics model should include it. — [Technology & Tool Gaps #1; Quick Wins #10; Prioritised Recommendations #8]

- [ ] Create holding-company/finance/monthly/2026-04.md — April monthly summary file should exist at the start of the month; no automation creates it. — [Operations Assessment, Financial Tracking; Quick Wins #8]

- [ ] Update ideas-tracker.md for IDEA-001 — change status from `planned` to `in-progress` (plugins installed, partially implemented per session logs). Tracker was last updated 2026-03-20. — [Operations Assessment, Ideas Pipeline; Quick Wins #9]

- [ ] Update docs/phase2-mcp-setup.md status header — reflect which Phase 2 steps are complete (Etsy MCP installed, GWS CLI installed, activity log hook, dashboard built) vs. remaining (GWS auth setup). — [Issues table, row 11; Quick Wins implicit]

### Short-term (next 1-2 sessions — operator actions required plus moderate system work)

- [ ] OPERATOR ACTION: Run `gws auth setup` to activate Google Workspace — this is the single highest-value unblocked action available. Unlocks Gmail draft notifications, Google Drive sync, and the remote approval workflow. The delivery pipeline is fully designed but zero-percent functional without this. — [Prioritised Recommendations #3; MCP Priority List #1]

- [ ] OPERATOR ACTION: Create Etsy seller account and regenerate Etsy Shared Secret — then set `ETSY_SHARED_SECRET` Windows environment variable. This is the core monetisation path; Stage 0 → Stage 1 cannot happen without it. — [Prioritised Recommendations #4; venture-01 blockers]

- [ ] OPERATOR ACTION: Verify scheduled task system in VS Code Scheduled section — all three tasks show `lastRun: null` and stale `nextRun` dates from March. Re-trigger them and confirm execution appears in logs/. Daily strategic pulse and weekly health check have been inactive since setup. — [Issues table, row 3; Prioritised Recommendations #2]

- [ ] Create venture-01-pod-store/tasks/sprint-01-launch.md — a clear checklist of the launch sequence for the first niche so that when operator completes Etsy setup, the next steps are unambiguous and no session time is lost re-planning. — [Issues table, row 10; Quick Wins #7]

- [ ] Fill in holding-company/BRIEF.md core sections — Portfolio Strategy, Operator Goals, Risk Tolerance, Key Constraints are all near-empty placeholders. The business-advisor agent reads this on every strategic pulse. Flagged in two consecutive audits. — [Issues table, row 7]

- [ ] Add Ideogram as a third routing option in designer agent — for typography-heavy designs (quote art, text-overlay designs), Ideogram is now the leading tool. These are high-margin POD products not currently in scope. — [Technology & Tool Gaps #2]

- [ ] Verify activity-log.sh Unix path `/c/ai-workspace/` writes to correct Windows location — document the path equivalence in a comment if confirmed working, or update to `c:/ai-workspace/` for consistency. — [Issues table, row 6]

- [ ] Resolve AGENTS.md superpowers:code-reviewer listing — verify whether the skill is accessible in the current session; if yes, add a clarifying note; if not, move to a "Plugin Agents" section. — [Issues table, row 6 (second)]

### Medium-term (this month — infrastructure or strategic changes)

- [ ] Run the end-to-end delivery pipeline test — once GWS auth is active, produce a test PDF brief, confirm it lands in for-review/, syncs to Google Drive AI Business/Review Inbox/, and triggers a Gmail draft notification. The pipeline is designed but has never been tested end-to-end.

- [ ] Add Playwright MCP — install `npx @playwright/mcp` as a replacement or supplement to Claude-in-Chrome for designer agent browser automation. Accessibility-snapshot-based interaction is more reliable than screenshot-based at scale. — [Technology & Tool Gaps #8; MCP Priority List #4]

- [ ] Add Brave Search or Firecrawl MCP — dedicated search MCP with higher rate limits and structured results would significantly improve researcher agent output quality vs. current built-in WebSearch/WebFetch. — [MCP Priority List #2]

- [ ] Add PostToolUseFailure + FileChanged + PreCompact hooks — beyond the immediate PostToolUseFailure hook, FileChanged on `for-review/` would trigger dashboard refresh; PreCompact would log context usage before compaction. — [Technology & Tool Gaps #5-6; Infrastructure Assessment, Hook Coverage]

- [ ] Add Notion MCP for mobile oversight — official Notion MCP satisfies IDEA-003 and gives operator mobile-friendly venture status and remote approval capability without requiring a Claude Max upgrade. — [MCP Priority List #5; Operations Assessment, Ideas Pipeline #003]

### Long-term / Backlog

- [ ] Upgrade to Claude Max plan for RemoteTrigger — enables on-demand remote triggers via Telegram/Discord plugins already installed. Justified at ~$155 AUD/month once venture is revenue-generating. — [Prioritised Recommendations #10; IDEA-001]

- [ ] Implement IDEA-002 (auto-improvement system) post-launch — well-researched plan ready, but should wait until first venture reaches Stage 1 to avoid adding system complexity before core value delivery. — [Prioritised Recommendations #9; Operations Assessment, Ideas Pipeline #002]

- [ ] Create Scheduler/Operations Manager sub-agent — frees main thread context by delegating day-to-day task sequencing, scheduled task monitoring, and approval triage to a dedicated sub-agent. Only warranted once the system is running at higher throughput. — [AI Stack Assessment, Missing Agent Roles]

- [ ] Create SEO Specialist agent — orchestrates Etsy SEO strategy, tag research, and listing optimisation cycles using the existing `etsy-seo` skill. Relevant at Stage 2+ when listings are live. — [AI Stack Assessment, Missing Agent Roles]

- [ ] Introduce parallel agent execution in the venture launch pipeline — Researcher, Analyst, and Designer can run in parallel after Advisor completes; would reduce pipeline wall-clock time. Relevant once pipeline is running regularly. — [AI Stack Assessment, Orchestration Patterns]

- [ ] Add session-end FORCE_STOP mechanism — environment variable bypass for the `session-end.sh` exit 2 block, for maintenance sessions that produce no session log. Low priority; current design is correct for normal use. — [Issues table, row 12]

- [ ] Add Haiku 4.5 routing for bulk tasks — relevant if system migrates from Pro subscription to API billing. Document candidates (tag generation, keyword lists, simple descriptions) in config/routing.md when created. — [Issues table, row 9; Technology & Tool Gaps #4]

- [ ] Establish review-status.json hygiene automation — auto-transition items older than 14 days at `pending` to `expired` status. Low priority; manual hygiene is sufficient for current volume. — [Issues table, row 4]

---

## Top 3 Right Now

The 3 most important things to do in this session, ordered by combined impact and effort:

1. **Fix CLAUDE.md Interface section** — remove the non-existent `/remote-control` and `--channels` references and replace with accurate remote access description. — Impact: HIGH — Effort: LOW — Every session loads CLAUDE.md; a wrong spec silently misinforms every run until fixed.

2. **Add PostToolUseFailure hook** — wire a hook that logs tool failures to `logs/system.log`. — Impact: HIGH — Effort: LOW — System.log has been nearly empty for months; failures are invisible; this closes a critical observability gap with minimal work.

3. **Clear IDEAS.md and tidy review-status.json** (treat as one housekeeping pass) — remove four processed ideas from the IDEAS.md inbox and mark the two stale March 20 audit items as `reviewed`. — Impact: MEDIUM-HIGH — Effort: LOW — Reduces session-start context on every run; removes misleading pending items from the operator inbox.

---

## De-duplicated Issue Summary

The audit contains several overlapping findings that were consolidated above:

- The "config/ files missing" finding (issues table row 2) and "routing.md absent" finding (issues table row 9) are the same issue; consolidated into a single `config/routing.md` action above. The other five missing config files (approval-gates.md, failure-playbooks.md, active-ventures.md, quality-gates.md, workflow-tests.md) are intentionally omitted per the 2026-03-19 simplification decision.
- The "Haiku 4.5 not referenced" finding (issues table row 12 / Technology & Tool Gaps #4) overlaps with the routing.md creation action; consolidated into one action.
- The PostToolUseFailure hook appears in both the Issues table and Technology & Tool Gaps; consolidated into one action.
- The Gelato recommendation appears in both Technology & Tool Gaps #1 and Prioritised Recommendations #8; consolidated.

---

## Source Report

- AUDIT-SYSTEM-2026-04-01.md — retrieved from C:\ai-workspace\for-review\

# System Audit — 2026-07-03

**Auditor:** Jarvis (Claude Fable 5, main session — inline audit)
**Scope:** Full system + July-2026 landscape research
**Previous audits:** 2026-03-20, 2026-04-01
**Trigger:** Operator requested full system review with rebuild mandate

## Method note
A 25-agent review workflow was attempted first and exhausted the Claude plan session limit
(~850k tokens, all agents died before returning results). The audit was completed inline in a
single context instead. This failure is itself finding #8 below. Research was single-pass web
search without adversarial verification — claims marked (verify) should be confirmed at build time.

---

## Executive Summary

The system is well-built plumbing wrapped around a fatally flawed process. Hooks, logging,
memory handoff, and agent definitions are genuinely good — confirmed working with live log
evidence. But the venture produced zero revenue in 4 months because every external action
was designed to end at a manual operator step, and the operator (predictably, reasonably)
did not keep up. The system stalled for 68 days with finished work sitting in an inbox.

**Root cause:** the design optimised for safety-through-approval instead of
safety-through-guardrails. The human was the execution bottleneck in a system whose entire
purpose was to remove the human from execution.

**Second root cause:** no enforcement loop. Two prior audits flagged overlapping findings;
most were never actioned. Audits produced documents, not tasks.

Overall health: **RED on purpose (zero revenue, dormant), GREEN on craftsmanship.**
The rebuild mandate (full autopilot + guardrails, decided 2026-07-02) addresses the true failure.

---

## Verdicts by Component

| Component | Verdict | Basis |
|---|---|---|
| Hooks (6 scripts) | **KEEP** | Best-engineered part. Confirmed firing (activity.log entries same-day). Log rotation built in. PostToolUseFailure catches invisible errors. |
| Memory system (summaries + logs + hook loading) | **KEEP** | Works; survived the 2-month gap and restored context perfectly. Minor: consolidate with Claude Code auto-memory. |
| Agent definitions (9) | **UPGRADE** | High quality (per Apr audit + spot checks) but all assume human-in-loop delivery. Need publisher/ops-monitor roles; delivery targets change under autopilot. |
| Venture/holding structure (BRIEF, current-state, stages, decision log) | **KEEP** | Sound design. Decision log is genuinely valuable. Enforcement of updates must move to a scheduled routine. |
| CLAUDE.md + config/ | **REBUILD** | Autonomy table obsolete under new mandate; Drive-sync instruction references folders that don't exist; security.md partially stale ("no MCPs configured yet"). |
| for-review/ approval loop | **REBUILD** | The component that killed the launch. Used once (2026-04-03) in system's life. Replace with digest + veto model; keep as exception queue for Hard-Stop items only. |
| Dashboard (server + 6 themes) | **REBUILD or KILL** | See finding #3. Unauthenticated action endpoints exposed LAN-wide. Value largely superseded by claude.ai surfaces + email digests. Secure it or retire it. |
| Etsy MCP server (tools/etsy-mcp-server) | **KEEP — finish auth** | See finding #4. OAuth never completed; "API denied" narrative appears wrong. |
| Drive sync | **KILL as specified** | Target folders don't exist in Drive. Rebuild delivery around Gmail digest + Drive for file delivery only if needed. |
| Scheduled tasks (session-only crons + manifest) | **REPLACE** | Never fired once in system history (manifest lastRun: null; session-only crons die with session). Replace with Claude cloud Routines. |
| Skills (6) | **TRIM** | etsy-seo, market-research earn keep; drive-sync is dead; others audit at build time. |
| Finance tracking | **KEEP + enforce** | Structure correct, maintenance failed: EverBee sub (Apr) never logged in costs.md. Automate via weekly routine. |
| MASTER-PLAN.md | **SUPERSEDE** | Replaced by REBUILD-BLUEPRINT-2026-07-03.md. Keep for history. |

---

## Findings (prioritised)

1. **CRITICAL — No version control.** Workspace is not a git repo (a .gitignore exists, unused).
   An autonomous system needs rollback and a tamper-evident change history. Fix: `git init`,
   commit everything, commit-per-external-action discipline.

2. **CRITICAL — Approval-gate design is a proven single point of failure.** 68-day stall;
   finished listing packs pending since Apr 24; approval mechanism used once ever
   (external-actions.log: one batch, 2026-04-03). Fixed by the new mandate — see blueprint.

3. **HIGH — Dashboard security.** `dashboard-server.js` `server.listen(PORT)` binds all
   interfaces (0.0.0.0); CLAUDE.md advertises `http://<pc-ip>:5050`. Approve/deny/move-file
   endpoints and a file-serving endpoint have no authentication; filename inputs go into
   `path.join` without traversal checks (dashboard-server.js:232,264,295). Anyone on the LAN
   can approve items or probe files. Fix: bind 127.0.0.1 + token auth, or retire the server.

4. **HIGH — Etsy MCP is dead weight. [CORRECTED 2026-07-03: operator confirms Etsy DENIED
   the API application — the original audit inference that re-auth would fix it was wrong.]**
   .mcp.json placeholders (`REPLACE_AFTER_REGENERATING`/`REPLACE_AFTER_OAUTH`) reflect an
   OAuth that could never be completed. Action changed: REMOVE the Etsy MCP server and
   tools/etsy-mcp-server. Replacement publishing rails (official, ToS-safe): Gelato
   supplier-push for POD (connected 2026-07-03) + approved partner listing tools
   (Vela/Evlista) for digital downloads. See RESEARCH-channels-platforms-2026-07-03.md.

5. **HIGH — No enforcement loop for improvement work.** Findings from 2026-03-20 and
   2026-04-01 audits recurred unfixed (config gaps, stale review items, empty holding BRIEF).
   Fix: audit output must become tracked tasks with a scheduled routine that nags until closed.

6. **HIGH — Scheduling never actually worked.** All historical scheduled tasks show
   lastRun: null; session-only crons die on exit and require manual recreation. Fix: move
   recurring work to Claude cloud Routines (run on Anthropic infra, PC can be off).

7. **MEDIUM — Permission allowlist too broad for autonomy.** settings.json allows bare
   `rm`, `kill`, `curl`, `git` etc. Deny list catches only crude patterns (`rm -rf` but not
   `rm -r -f`). Tighten before granting autopilot authority.

8. **MEDIUM — Plan economics constrain architecture.** The 25-agent review workflow burned
   ~850k tokens and hit the session cap with zero output. On the current plan, heavy
   multi-agent fan-out is not viable. Rebuild must be token-frugal: single-context work by
   default, subagents only where isolation genuinely pays. Max upgrade is an ROI decision
   once revenue work is actually being throttled (existing trigger stands).

9. **MEDIUM — Cost tracking lapsed.** costs.md still shows only Claude Pro; EverBee paid
   subscription (decision 2026-04-24) absent. ROI-governed spending (new mandate) is
   impossible without accurate cost data. Automate via weekly finance routine.

10. **LOW — Stale references.** security.md "Current MCP Permissions: (none configured yet)";
    CLAUDE.md Drive-sync standing instruction; phase2-mcp-setup.md status; agents/AGENTS.md
    superpowers row (prior audit, still open).

## What genuinely works (carry forward)
- Hook layer (all six, including failure logging and log rotation)
- Session summary/log memory pattern + SessionStart loading
- Decision log discipline and quality
- Agent prompt quality (researcher's POS methodology, analyst's unit economics)
- Venture folder structure and lifecycle stages
- Append-only external-actions.log concept
- Listing-pack content itself (nurse + pilates packs are finished, QC-passed work)

---

## July-2026 landscape (research summary — sources in blueprint)

- **Claude cloud Routines / Managed Agents now exist**: scheduled agents on Anthropic infra
  (claude.ai Tasks on Pro+; Managed Agents via API with cron scheduled deployments, sandboxes,
  MCP, persistent sessions). Removes the "PC must be awake" constraint that broke scheduling.
- **Etsy API v3**: personal app approval described as routine (24-48h (verify)); listing
  management is a core supported use case. Reapplication is worth one operator attempt.
- **POD suppliers**: Gelato (130+ partners, 32 countries, ~87% local production) suits
  AU/global; Printify (900+ products) suits US-heavy catalogs. Both have full product-create
  + Etsy-publish APIs.
- **Etsy AI policy 2026**: AI-assisted content allowed with disclosure; AI prompt bundles
  banned; physical products need at least one real product photo. Digital downloads remain
  the highest-automation category (planners, templates, wall art; hyperlinked PDF planners
  $10-30/sale; new-shop ramps of $500-1k/month within 3-6 months are claimed by industry
  blogs — treat as optimistic (verify against live data before projecting)).
- **Image generation**: API access at $0.01-0.20/image across tiers; text-rendering and
  artistic leaders shift fast — model choice should be a build-time benchmark, not a standing
  decision. (Decision-log entries on "GPT Image 2"/"Midjourney V8" conflict with some current
  sources; re-verify.) API > browser automation for autonomy and ToS safety.

## Disposition
Superseded by: docs/plans/REBUILD-BLUEPRINT-2026-07-03.md (the action plan).
Every finding above maps to a blueprint work item — findings do not close in this document.

# System Audit Synthesis — 2026-03-20
Based on: AUDIT-SYSTEM-2026-03-20.md

---

## Executive Summary

The Jarvis AI Business OS is in good structural shape for a system 7 weeks into its build. The hook coverage, agent definitions, autonomy model, session continuity, and ideas pipeline are all working correctly. The venture launch pipeline (Advisor → Researcher → Analyst → Designer → Writer → Quality-Checker → PDF brief) is well-designed and ready for its first real run.

**Top 3 concerns:**
1. A plaintext Etsy API key sits in .mcp.json — a HIGH security violation under the system's own policy, live right now.
2. logs/activity.log does not exist, so the dashboard live-feed is broken and standing instruction #7 cannot be fulfilled by any agent.
3. The holding-company BRIEF.md is entirely blank — every business-advisor strategic output is running without the operator's goals, risk tolerance, or budget constraints.

**Overall health: YELLOW.** The bones are solid. No action needed to prevent immediate harm except the API key. Everything else is a gap, not a failure.

---

## Top 3 Right Now

The 3 most important things to do immediately:

1. **Move the Etsy API key to a Windows environment variable** — Impact: HIGH — Effort: quick (10 min) — Who: Jarvis + Operator
   Edit `.mcp.json` to replace the plaintext key with `${ETSY_API_KEY}`. Operator sets the variable in Windows System Properties (System → Advanced → Environment Variables). Operator also regenerates the Shared Secret from the Etsy developer dashboard. This closes the only live HIGH security issue.

2. **Create logs/activity.log and add a PostToolUse hook for deterministic logging** — Impact: HIGH — Effort: quick (15 min) — Who: Jarvis
   Create the file with a header line so agents can write to it immediately. Add a PostToolUse hook (async: true) in .claude/settings.json that appends tool events automatically. Without this, the dashboard live-feed shows nothing and standing instruction #7 is silently broken every session.

3. **Operator fills in holding-company/BRIEF.md** — Impact: HIGH — Effort: medium (15-30 min) — Who: Operator
   The business-advisor agent reads this file on every strategic pulse. Fill in portfolio strategy, personal goals, risk tolerance, budget constraints, time available per week, and any markets or niches to avoid. No agent can substitute for this input.

---

## Prioritised Action Plan

### Immediate (this session — quick wins, zero or near-zero cost)

- [ ] **Move Etsy API key to Windows environment variable** — Security violation, HIGH severity. Edit .mcp.json, add `ETSY_API_KEY` to Windows env vars, test MCP still loads. Operator must also regenerate the Etsy Shared Secret separately. (Audit: Issues table, row 1; Security section)

- [ ] **Create logs/activity.log** — File is missing; dashboard live feed and standing instruction #7 are both broken without it. Create with a header line: `# Activity Log — created 2026-03-20`. Takes 1 minute. (Audit: Issues table, row 3; Infrastructure Gaps item 1)

- [ ] **Add a PostToolUse hook for activity.log** — Manual agent writing is unreliable. A PostToolUse hook with `async: true` makes logging deterministic and low-overhead. Required to make the dashboard live-feed actually work. (Audit: Infrastructure Gaps item 1; Hook Reliability section)

- [ ] **Enable native Claude Remote Control (IDEA-001)** — Run `claude remote-control` in terminal, scan QR code. Zero additional cost, takes 5 minutes, gives operator mobile access immediately. (Audit: Ideas Pipeline, IDEA-001; Quick Wins item 3)

- [ ] **Clean up IDEAS.md** — Remove the four processed ideas from the inbox file, leave only the header and intake instructions. Reduces session-start hook noise. Takes 2 minutes. (Audit: Issues table, row 10; Quick Wins item 4)

- [ ] **Add RESEARCH- prefix to config/delivery.md** — The researcher agent uses `RESEARCH-` as a type prefix but it is not in the delivery.md type table. Minor inconsistency that causes confusion when agents cross-reference the config. Takes 2 minutes. (Audit: AI Stack section, Agent Definition Caveats)

- [ ] **Create config/active-ventures.md** — Single-file venture registry: venture-01-pod-store, Stage 0, started 2026-03-13, status Blocked (Etsy app pending). Takes 5 minutes. (Audit: Infrastructure section, Config Completeness)

- [ ] **Create config/routing.md** — Document current model routing: Opus for business-advisor, Sonnet for all others, Haiku 4.5 planned for high-volume listing tasks at Stage 2. Replaces the ad-hoc frontmatter-only approach. Takes 15 minutes. (Audit: Issues table, row 6; Quick Wins item 5)

- [ ] **Document .mcp.json project-scope decision in security.md** — The audit confirmed this is a deliberate choice, not an oversight. Add one paragraph to security.md noting that .mcp.json is project-scoped by design and must never contain plaintext secrets. Takes 5 minutes. (Audit: Issues table, row 7)

### Short-term (next 1-2 sessions — moderate effort, high impact)

- [ ] **Operator: complete holding-company/BRIEF.md** — Cannot be done by Jarvis. The business-advisor reads this on every strategic pulse. Blank = every advisory output is context-free. Fill in goals, risk tolerance, budget, time per week, markets to avoid. Estimated 15-30 minutes of operator input. (Audit: Issues table, row 4)

- [ ] **Install Google Workspace MCP (taylorwilsdon/google_workspace_mcp)** — Covers Gmail, Calendar, Drive, Docs, and Sheets in a single OAuth install. Unlocks the email delivery routing, Drive deliverable storage, and operator notification paths that CLAUDE.md references but which are currently inactive. Single highest-value MCP install. Follow phase2-mcp-setup.md. (Audit: MCP Priority List item 2; Technology Gaps item 11)

- [ ] **Confirm and install PDF generation capability** — The venture launch pipeline promises a PDF brief as its deliverable. If the `pdf` skill is not installed, the pipeline outputs markdown files, not PDFs. Check the Anthropic skill marketplace, install the pdf skill, test it, confirm the designer agent can invoke it. (Audit: Technology Gaps item 6; Operations: Delivery Pipeline)

- [ ] **Create the four remaining config files** — approval-gates.md, failure-playbooks.md, quality-gates.md, workflow-tests.md. The content already exists in CLAUDE.md — this is an extraction exercise. These files let agents reference specific config independently and make the workflow test suite runnable. (Audit: Infrastructure section, Config Completeness)

- [ ] **Add Etsy-specific checks to the quality-checker agent** — Before any listings go live, the quality-checker must check: AI-use disclosure (Etsy now requires it), production partner disclosure (Printify/Gelato must be named on every listing). Add these to the agent's review checklist. Needs to be in place before Stage 1. (Audit: Operations: Quality Gate Effectiveness; POD viability section)

- [ ] **Test session-end.sh on Windows** — Run `bash hooks/session-end.sh < /dev/null` on a day with and without a session log present. Confirm exit codes 0 and 2 are correct under Git Bash on Windows. A silent failure here could allow Claude Code to exit without a session log being enforced. (Audit: Issues table, row 11)

- [ ] **Verify superpowers:code-reviewer agent status** — AGENTS.md lists this agent but no superpowers plugin is installed. Either confirm installation or move the entry to a Planned Agents section. Misleading entries erode trust in the roster. (Audit: Issues table, row 12)

### Medium-term (this month — infrastructure or strategic changes)

- [ ] **Install Notion MCP for human oversight dashboard (IDEA-003)** — Official hosted Notion MCP + Notion Free plan = zero additional cost. Gives the operator mobile access to venture status, tasks, and review items. Build the Notion workspace (ventures database, tasks, review items) when installing. Do this as the venture moves toward Stage 1. (Audit: MCP Priority List item 3; Ideas Pipeline IDEA-003)

- [ ] **Add a dashboard data regeneration routine** — The dashboard HTML contains hardcoded static venture and financial data that does not update automatically. Options: (a) extend the Node.js server to serve live workspace data from API endpoints reading venture BRIEFs and finance files, or (b) create a PostToolUse or session-end hook that regenerates the static HTML sections. (Audit: Issues table, row 8; Infrastructure Gaps item 3)

- [ ] **Implement a PostToolUse hook for session log checkpointing** — The session-end.sh blocks Claude from stopping without a session log, but abnormal terminations bypass it. A PostToolUse hook that periodically writes a checkpoint improves resilience. (Audit: Infrastructure Gaps item 2)

- [ ] **Add Haiku 4.5 to the routing table** — At Stage 2 (Active), route high-volume low-stakes tasks — tag generation, product description variants, structured data formatting — to Haiku 4.5. It costs 12x less than Sonnet. Document in config/routing.md. Not urgent at Stage 0 but should be decided before listing production begins. (Audit: Technology Gaps item 5; Recommendations item 7)

- [ ] **Run full niche validation research via the researcher agent** — The current niche research file (REPORT-pod-niche-research-notes-2026-03-13.md) is a system test document, not substantive research. A full niche validation run (pet portraits, zippered tote bags, outdoor hobby niches) using EverBee data is needed to select the first niche and unblock Stage 1. (Audit: Operations: Venture Setup Quality)

- [ ] **Add MCP-level audit logging** — The external-actions.log covers Approve-level actions but not MCP tool calls. Adding an MCP-level log (tool called, arguments, result) would close a gap identified in 2026 OWASP MCP Top 10. Implement as part of the Phase 2 MCP expansion. (Audit: Infrastructure Gaps item 4; Technology section)

### Long-term / Backlog

- [ ] **Evaluate Composio as a unified MCP layer** — Composio provides a single MCP covering 250+ platforms with managed OAuth. For a solo operator who will eventually need Slack, GitHub, Airtable, and social connections, this reduces MCP management overhead. Worth evaluating before installing individual MCPs for every platform. (Audit: Technology Gaps item 12)

- [ ] **Add Recraft to the designer agent's AI tool routing table** — Recraft is the only major AI image generator that produces native SVG files. For POD designs that need to scale to 4500x5400px without quality loss, vector-native generation is a meaningful advantage over raster output from ChatGPT or Gemini. Add as a third routing option. (Audit: Recommendations item 12; Technology Gaps item 7)

- [ ] **Evaluate dedicated Etsy keyword research MCP (EverBee, Sale Samurai, or Marmalead)** — The researcher agent currently uses WebSearch for keyword research. A dedicated Etsy keyword data source would significantly improve listing quality. Not blocking at Stage 0 but should be evaluated before Stage 1 listing production. (Audit: Technology Gaps item 8)

- [ ] **Evaluate Printify MCP for direct product push** — A Printify MCP would allow the designer agent to push designs and create draft products without operator manually uploading. Reduces the operator's manual steps in the pipeline. Evaluate at Stage 1 (Building). (Audit: MCP Priority List item 5)

- [ ] **Evaluate Gelato as co-primary fulfilment partner** — Gelato has fulfilment hubs closer to Australia, which may reduce international shipping costs and times for AU customers. Run a unit economics comparison (analyst agent) against Printify before committing to a fulfilment partner. (Audit: Recommendations item 11)

- [ ] **Build a scheduler or automation agent** — No dedicated agent exists for managing scheduled tasks or recurring operations. Currently handled ad-hoc by Jarvis. Becomes a gap as venture volume scales. Plan for Stage 2+. (Audit: AI Stack: Missing Agent Roles)

- [ ] **Evaluate a legal/compliance research agent** — The Master Plan specifies this role. The quality-checker covers ACL compliance checks but a specialist agent for IP, trademark, and platform ToS research would reduce the operator's exposure before issues reach Human-Only territory. Build at Stage 1-2 when content production begins in volume. (Audit: AI Stack: Missing Agent Roles)

- [ ] **Implement IDEA-002 (Auto-Improvement)** — Comprehensive plan exists in ideas/reviewed/. Defer until Phase 3 is operational and the skill-creator plugin is confirmed as installed. (Audit: Ideas Pipeline IDEA-002)

- [ ] **Create tasks/sprint-01.md for venture-01** — The tasks/ directory is empty. Not needed at Stage 0, but required when niche launch begins. Create at the start of Stage 1. (Audit: Issues table, row 9)

---

## Source Report
- AUDIT-SYSTEM-2026-03-20.md — retrieved from review-inbox/

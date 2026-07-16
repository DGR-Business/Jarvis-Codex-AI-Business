# BOOTSTRAP TASK — Phase 1 Foundation Build

## Objective
Create the complete workspace folder structure and all configuration files for the AI Business Operating System as defined in the Master Plan v1.1.

## Instructions

### 1. Create Folder Structure
Build the complete directory tree as defined in Master Plan Section 3.1. Every folder, including empty ones that will be populated later.

### 2. Create Configuration Files
For each file in config/, generate sensible defaults based on the Master Plan:
- routing.md — document Mode 1 (active), Mode 2 (planned), Mode 3 (active)
- approval-gates.md — full autonomy level rules with AU legal context
- failure-playbooks.md — all failure scenarios and responses
- active-ventures.md — empty registry (ventures added later)
- quality-gates.md — customer-facing review rules
- delivery.md — routing rules (inbox/Drive/email)
- security.md — MCP hardening rules, secrets management, browser automation ToS warnings
- workflow-tests.md — 8 test cases from Master Plan Section 11

### 3. Create Holding Company Structure
- BRIEF.md — placeholder for operator's portfolio strategy
- decision-log.md — empty, with header explaining format
- finance/costs.md — header + first entry: Claude Pro subscription
- finance/revenue.md — header, empty
- finance/monthly/2026-03.md — template for first month

### 4. Create Venture Template
- ventures/_template/BRIEF.md — template with all required fields (name, description, stage, goals, KPIs, target market, key decisions, current status)
- ventures/_template/current-state.md — blank template
- ventures/_template/tasks/ (empty)
- ventures/_template/outputs/ (empty)
- ventures/_template/logs/ (empty)

### 5. Create Review System
- review-inbox/ directory
- review-inbox/review-status.json — empty array: []

### 6. Create Log Files
- logs/external-actions.log — header explaining format, no entries yet
- logs/system.log — header, no entries yet

### 7. Create Memory Directory
- memory/ directory (empty, will be populated by session logs)

### 8. ASK the operator:
- What is the first venture? (Get name, description, goals)
- Any specific business context for the holding company BRIEF?

### 9. Create First Venture
Once the operator answers, copy _template/ to ventures/venture-01-[name]/ and fill in the BRIEF.md with their answers.

### 10. Report completion
List everything created. Confirm the system is ready for Phase 2.
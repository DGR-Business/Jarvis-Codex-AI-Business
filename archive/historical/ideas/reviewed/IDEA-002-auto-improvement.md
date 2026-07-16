# IDEA-002: Auto-Improvement System

## Original Idea
> Auto-Improvement — the system should automatically improve with updates, skill searches/creations. Find and install new MCP servers, skills, plugins. Create custom skills when needed. Self-improving system.

## Status: planned
## Priority: medium
## Scope: SYSTEM
## Date Submitted: 2026-03-15
## Date Reviewed: 2026-03-16

---

## Feasibility Research

### The Core Question

Can the AI business operating system improve itself — discovering and installing new capabilities, creating custom skills, updating its own configuration, and getting better over time without the operator having to manually find and install every tool?

The answer is: **mostly yes, with critical safety boundaries.**

Claude Code already has the building blocks for a self-improving system. The plugin marketplace, the skill-creator tool, the `claude mcp add` CLI command, and the hooks system together provide a foundation where the system can discover, install, create, test, and deploy new capabilities programmatically. But "can" does not mean "should" for every layer. The research below maps exactly what is safe to automate, what needs human approval, and what must never be autonomous.

---

### Component A: Plugin and Skill Discovery (Marketplace System)

**What exists today:**

Claude Code has a fully functional plugin marketplace ecosystem with over 9,000 plugins available as of early 2026. The official Anthropic marketplace (`claude-plugins-official`) is automatically registered when Claude Code starts. Community and third-party marketplaces can be added with `/plugin marketplace add user-or-org/repo-name`.

**Key commands for programmatic discovery and installation:**
- `/plugin` — opens the plugin manager with a Discover tab to browse available plugins
- `/plugin install {plugin-name}@{marketplace}` — installs a specific plugin
- `/plugin marketplace add {repo}` — registers a new marketplace source
- Community package managers like `ccpi` provide `ccpi search`, `ccpi install`, `ccpi list --installed`, and `ccpi update`

**What a plugin includes:**
A single plugin can bundle slash commands, subagents, MCP servers, hooks, and LSP servers into one installable unit. This means installing one plugin can add multiple capabilities simultaneously.

**Can Claude Code search and install plugins programmatically?**
YES. The `/plugin install` command can be called during a session. Claude Code can search marketplaces, evaluate plugin descriptions, and install relevant plugins without the operator manually browsing. The `ccpi` package manager adds structured search and update capabilities.

**Auto-update status:**
Plugins installed from marketplace repos currently have no built-in update mechanism. Users have no native way to know when a plugin has upstream updates. However, community implementations have created SessionStart hooks that check for upstream updates once per day by caching timestamps. This is a solvable gap.

**Feasibility: HIGH.** The discovery and installation infrastructure already exists. The system can search for plugins matching a need ("I need a skill for SEO content review") and install them.

---

### Component B: Custom Skill Creation (Skill-Creator Plugin)

**What exists today:**

Anthropic's official `skill-creator` plugin is a comprehensive toolkit for developing, testing, and iterating on Claude Code skills. It provides four operating modes:

1. **Create** — generates a new skill from a natural language description. Walks through requirements gathering, produces a SKILL.md file with proper frontmatter, instructions, and reference files.

2. **Eval** — writes and runs evaluations (tests) that check whether the skill produces expected behaviour for given prompts. Similar to software unit testing but for AI skills.

3. **Improve** — analyses eval results and proposes targeted improvements to the skill. Identifies gaps in instructions, edge cases, and quality issues.

4. **Benchmark** — runs standardised assessments using evals. Tracks pass rate, elapsed time, and token usage across runs. Supports A/B testing between skill versions.

**How it works internally:**
Four composable sub-agents handle specialised tasks: an Executor that runs skills against eval prompts, a Grader that evaluates outputs against defined expectations, a Comparator that performs blind A/B comparisons between skill versions, and an Analyzer that suggests targeted improvements based on results. Each agent runs in a clean context with its own token and timing metrics.

**Can Claude Code create custom skills programmatically?**
YES. The skill-creator can be invoked with `/skill-creator` and given a description of what the skill should do. It produces a complete skill package (directory with SKILL.md and any supporting files). The eval and improve modes mean the system can also test and refine its own creations before deploying them.

**What skills look like:**
Every skill is a directory containing at minimum a `SKILL.md` file with YAML frontmatter (name, description) and instructions. Skills can also contain executable scripts, reference files, and tool configurations. Skills can spawn isolated subagents, restrict which tools Claude uses, override the model, hook into lifecycle events, and run in forked contexts.

**Feasibility: HIGH.** The system can identify a capability gap ("I need a skill that validates product descriptions against Australian Consumer Law requirements"), create a custom skill, test it with evals, improve it based on results, and deploy it — all programmatically.

---

### Component C: MCP Server Discovery and Installation

**What exists today:**

Claude Code provides a CLI command to add MCP servers:
- `claude mcp add [name] --scope user` — adds an MCP server via interactive wizard
- `claude mcp add-json [name] '{"type":"stdio","command":"...","args":[...]}'` — adds via JSON config
- `claude mcp list` — lists configured servers
- `claude mcp remove [name]` — removes a server
- `claude mcp get [name]` — tests a server connection

Scoping options: `--scope local` (current project only), `--scope project` (shared via .mcp.json), `--scope user` (all projects).

Additionally, the third-party `add-mcp` CLI tool can detect which coding agents are installed and configure MCP servers across all of them simultaneously.

**Can Claude Code modify its own MCP configuration?**
YES — with caveats. The `claude mcp add` and `claude mcp add-json` commands can be run from bash within a Claude Code session. The underlying configuration is stored in JSON files (`~/.claude.json` for user scope, `.mcp.json` for project scope) which are standard JSON and can be read/written programmatically. After modification, Claude Code needs a restart or session refresh for changes to take effect.

**What this enables:**
The system could, in principle, search for MCP servers that provide a needed capability (e.g., "I need to connect to Shopify"), find the right MCP server (from registries like mcp.so, smithery.ai, or GitHub), and install it using `claude mcp add-json`.

**Critical limitation:**
Most MCP servers require credentials (API keys, OAuth tokens) that the system cannot and should not provision autonomously. The MCP can be installed, but the credential setup requires human action.

**Feasibility: MEDIUM-HIGH.** Installation mechanics work. Credential provisioning is the bottleneck and must remain human-controlled.

---

### Component D: Hooks for Deterministic Automation

**What exists today:**

Hooks are user-defined shell commands that execute at specific points in Claude Code's lifecycle. They provide deterministic control — they fire every time, without exception, regardless of prompt phrasing or model behaviour. There are 17 lifecycle points including:

- `SessionStart` / `SessionStop` — session lifecycle
- `PreToolUse` / `PostToolUse` — before/after any tool invocation
- Matcher patterns to target specific tools (e.g., only fire for `Write` tool, or only for `Bash` tool)

**How hooks support auto-improvement:**
- A `SessionStart` hook can check for plugin updates and install them automatically
- A `PostToolUse` hook can log every tool invocation for performance analysis
- Hooks can enforce quality gates (e.g., run a linter after every file write)
- A scheduled hook can audit installed skills and flag unused ones for removal

**Can Claude Code create and manage its own hooks?**
YES. Hooks are configured in `.claude/settings.json`, which is a JSON file that Claude Code can read and write. The system can add, modify, or remove hooks programmatically.

**Feasibility: HIGH.** Hooks are the strongest mechanism for deterministic self-improvement because they bypass the probabilistic nature of LLM behaviour.

---

### Component E: What Should NOT Be Automated (Safety Boundaries)

This is the most important section of this review. A self-improving system that can modify its own configuration, install arbitrary software, and change its own behaviour has significant risk potential. The 2026 International AI Safety Report explicitly identifies self-modifying AI systems as an area requiring careful governance.

**NEVER automate (Human-Only — hardcoded boundaries):**

1. **Credential management.** The system must never autonomously create API keys, OAuth tokens, service accounts, or any authentication credentials. This is a hard boundary — no exceptions. Credential provisioning always requires operator action.

2. **Security configuration changes.** Modifications to `config/security.md`, firewall rules, filesystem permission boundaries, or any security policy must be human-approved. A self-improving system that can weaken its own safety constraints is a fundamental safety failure.

3. **MCP credential injection.** Even if the system can install an MCP server, it must never store or inject API keys, tokens, or secrets into configuration files. All secrets via environment variables, set by the operator.

4. **Removal of safety hooks.** Any hooks that enforce quality gates, audit logging, or security checks must be protected from removal by the auto-improvement system. The system cannot remove its own guardrails.

5. **Modification of the autonomy level system.** The system must not be able to promote its own actions from Approve to Auto. The autonomy boundaries are operator-defined and immutable.

6. **External account creation.** The system must not create accounts on any platform, even if it would enable a useful integration.

**Require approval before executing (Approve):**

1. **Installing MCP servers.** Even though the mechanics are automated, new MCP servers expand the system's attack surface and capabilities. The operator should be notified and approve before any new MCP server goes live.

2. **Installing plugins from unverified sources.** The official Anthropic marketplace is curated, but community marketplaces may contain plugins with unreviewed code. Plugins from non-official sources should require approval.

3. **Creating hooks that modify system behaviour.** New hooks that run shell commands have the power to affect anything the system touches. Operator should review and approve.

4. **Modifying CLAUDE.md or config/ files.** These are the system's operating instructions. Changes should be proposed, reviewed, and approved, not silently applied.

**Safe to automate (Auto — full autonomy):**

1. **Searching marketplaces for relevant plugins.** Read-only discovery is safe.
2. **Creating custom skills via skill-creator.** Skills are sandboxed instructions, not executable code with system access.
3. **Running evals and benchmarks on skills.** Testing is inherently safe.
4. **Updating installed plugins from verified sources** (official Anthropic marketplace).
5. **Logging and reporting on system capabilities.** Audit trail of what is installed, what is used, what is unused.
6. **Proposing improvements for operator review.** The system can research, draft, and recommend — the operator approves.

---

### Component F: Practical Risks of a Self-Improving System

**Risk 1: Configuration Drift**
Over time, automated changes accumulate. The system installs plugins, creates skills, adds hooks. Without careful tracking, the operator loses visibility into what the system can do and how it behaves. Mitigation: maintain a manifest file that logs every auto-improvement action with timestamp, rationale, and reversibility.

**Risk 2: Capability Creep**
Each new plugin or MCP server expands the system's action space. More capabilities mean more potential for unintended consequences. An AI agent with access to email, file storage, web browsing, and e-commerce platforms has a very large action space. Mitigation: regular capability audits, minimum-privilege principle (only install what is actively needed).

**Risk 3: Quality Degradation**
Auto-created skills may not match the quality of hand-crafted ones. The skill-creator's eval system helps, but evals are only as good as the test cases. A skill that passes basic evals may fail on edge cases in production. Mitigation: all auto-created skills enter a "probationary" period where they are used alongside manual review before being trusted for autonomous execution.

**Risk 4: Dependency Bloat**
Installing many plugins and MCP servers creates a dependency tree that becomes hard to maintain. Plugins may conflict, MCP servers may have overlapping capabilities, and updates to one component may break another. Mitigation: quarterly cleanup reviews, tracking which plugins/skills are actually used vs installed.

**Risk 5: Prompt Injection via Plugins**
Third-party plugins and MCP servers are attack vectors for prompt injection. A malicious or compromised plugin could inject instructions that override the system's safety behaviour. The 2026 International AI Safety Report highlights that some models can now distinguish evaluation from deployment contexts and alter behaviour accordingly — this applies to plugin code as well. Mitigation: only use the official Anthropic marketplace for auto-installation; community sources require manual review.

**Risk 6: Circular Improvement Loops**
A system that improves itself based on its own evaluation of its own performance may converge on locally optimal but globally suboptimal behaviour. It might, for example, create increasingly complex skills that are technically correct but practically unusable. Mitigation: human review of improvement proposals, external benchmarks, real-world outcome tracking.

---

## Recommendation

**Status: PLANNED — implement in Phase 2 with a phased rollout.**

This idea is feasible and valuable, but the implementation must be carefully staged. The infrastructure for self-improvement already exists in Claude Code — plugin marketplace, skill-creator, `claude mcp add`, hooks. The question is not "can we build this?" but "how do we build this safely?"

The core principle: **the system can propose improvements freely, but execution of changes to its own configuration requires gated approval based on risk level.**

**Key findings:**

1. **Plugin discovery and installation works today.** Over 9,000 plugins in the marketplace, programmatic install via `/plugin install`, package manager (`ccpi`) for search and update. The system can find what it needs.

2. **Custom skill creation is production-ready.** The skill-creator plugin with Create/Eval/Improve/Benchmark modes provides a full lifecycle for generating and testing custom skills. The system can identify capability gaps and fill them.

3. **MCP server installation is programmatic.** `claude mcp add-json` can add new MCP servers from bash. The bottleneck is credential provisioning, which correctly remains human-controlled.

4. **Hooks provide deterministic self-improvement.** SessionStart hooks can check for updates, PostToolUse hooks can enforce quality, and the hook system itself can be extended programmatically.

5. **Safety boundaries are well-defined.** Credentials, security config, autonomy boundaries, and guardrail hooks must be protected. The autonomy level system already provides the framework — auto-improvement actions slot into existing levels.

6. **The risks are manageable but real.** Configuration drift, capability creep, quality degradation, and prompt injection via plugins are genuine concerns. All are addressable with audit logging, capability manifests, probationary periods, and source restrictions.

---

## Implementation Plan

### Phase 1: Audit and Manifest *(Auto)* — 1 session

1. Install the `skill-creator` plugin from the official Anthropic marketplace
2. Create `config/capability-manifest.md` — a living document that tracks:
   - All installed plugins (name, source, date installed, last used)
   - All custom skills (name, purpose, date created, eval pass rate)
   - All MCP servers (name, purpose, credential status, date added)
   - All hooks (name, lifecycle point, purpose, date added)
3. Create a `SessionStart` hook that checks for plugin updates from the official Anthropic marketplace once per day (cache timestamp to avoid repeated checks)
4. Create a `SessionStart` hook that appends a capability summary to the session log

### Phase 2: Skill Creation Pipeline *(Auto / Notify)* — 2-3 sessions

5. Build a "capability gap detection" routine:
   - During task execution, if Claude identifies a recurring task pattern that would benefit from a dedicated skill, log it to `ideas/skill-gaps.md`
   - Once per week, review skill gaps and create custom skills for the top candidates
6. For each new custom skill:
   - Create using skill-creator Create mode
   - Write evals using skill-creator Eval mode (minimum 5 test cases)
   - Run benchmarks using skill-creator Benchmark mode
   - If pass rate > 80%, deploy to `/skills/` directory
   - If pass rate <= 80%, run skill-creator Improve mode and re-benchmark
   - Log creation to capability manifest
7. Establish a "probationary" period: new auto-created skills are flagged in the manifest and subject to operator review within 7 days

### Phase 3: Plugin Discovery Pipeline *(Notify / Approve)* — 1-2 sessions

8. When a task requires a capability not available in the current skill/plugin set:
   - Search the official Anthropic marketplace for relevant plugins
   - If a match is found, save the plugin details to `review-inbox/` as a PLUGIN-PROPOSAL item
   - Wait for operator approval before installing
9. For approved plugins:
   - Install via `/plugin install`
   - Add to capability manifest
   - Run basic functional test
   - Log to audit trail
10. Restrict auto-installation to the official Anthropic marketplace only. Community marketplace plugins always require Approve-level approval with a manual review of the plugin source.

### Phase 4: MCP Server Proposals *(Approve)* — 1 session

11. When a task would benefit from a new MCP server (e.g., connecting to a new platform):
    - Research available MCP servers for the need
    - Write a proposal to `review-inbox/` as an MCP-PROPOSAL item
    - Include: server name, source, capabilities, credential requirements, security assessment
    - Wait for operator approval
12. On approval:
    - Install via `claude mcp add-json` (without credentials)
    - Guide operator through credential setup
    - Test the connection
    - Add to capability manifest

### Phase 5: Self-Monitoring and Cleanup *(Auto)* — 1 session

13. Create a monthly "system health" routine:
    - Review capability manifest for unused plugins/skills (not used in 30+ days)
    - Flag unused capabilities for potential removal
    - Run benchmarks on all custom skills to detect quality drift
    - Generate a "system improvement report" for the operator
14. Create a hook that logs all tool usage to enable data-driven improvement decisions
15. Build a "before and after" comparison: track task completion time, quality scores, and error rates to measure whether auto-improvements are actually improving performance

### Estimated Effort
- **Phase 1 (Audit and Manifest):** 1 session, ~1-2 hours
- **Phase 2 (Skill Creation Pipeline):** 2-3 sessions, ~4-6 hours
- **Phase 3 (Plugin Discovery Pipeline):** 1-2 sessions, ~2-3 hours
- **Phase 4 (MCP Server Proposals):** 1 session, ~1-2 hours
- **Phase 5 (Self-Monitoring):** 1 session, ~2-3 hours
- **Total: 6-8 sessions, ~10-16 hours of agent work**
- **Ongoing overhead:** Minimal — SessionStart hooks handle daily checks, monthly health report is automated

### Dependencies / Blockers
- Skill-creator plugin must be installed (Phase 1, step 1)
- Official Anthropic marketplace must be accessible (it is by default)
- No blocker on custom skill creation — all infrastructure exists
- MCP server proposals depend on operator credential provisioning
- Existing `config/security.md` rules must be respected throughout

### Safety Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  AUTO-IMPROVEMENT ENGINE                  │
├─────────────┬──────────────┬──────────────┬─────────────┤
│  DISCOVER   │   CREATE     │   INSTALL    │  MONITOR    │
│  (Auto)     │   (Auto)     │ (Approve)    │  (Auto)     │
│             │              │              │             │
│ Search      │ Skill-creator│ Plugin       │ Capability  │
│ marketplace │ Create mode  │ install      │ manifest    │
│ Identify    │ Eval mode    │ MCP add      │ Usage       │
│ gaps        │ Improve mode │ Hook config  │ tracking    │
│ Research    │ Benchmark    │              │ Health      │
│ MCP options │              │              │ reports     │
├─────────────┴──────────────┴──────┬───────┴─────────────┤
│                                   │                      │
│           APPROVAL GATE           │    AUDIT TRAIL       │
│  (Approve for installs/config)    │  (append-only log)   │
│  (Notify for skill deployment)    │                      │
├───────────────────────────────────┴──────────────────────┤
│                    HARD BOUNDARIES                        │
│  NO: credential management                               │
│  NO: security config changes                             │
│  NO: autonomy boundary modifications                     │
│  NO: guardrail hook removal                              │
│  NO: external account creation                           │
│  NO: community plugin auto-install                       │
└─────────────────────────────────────────────────────────┘
```

---

## Relationship to Other Ideas

- **IDEA-001 (Remote Control):** Auto-improvement proposals that need approval can be sent to the operator via Telegram/Remote Control for faster turnaround. The operator does not need to be at the machine to approve a plugin install.
- **IDEA-003 (Human Oversight Dashboard):** The capability manifest and system health reports feed naturally into the Notion dashboard. The operator can see what the system has installed, what it wants to install, and approve/reject proposals directly from the dashboard.
- **IDEA-004 (Smart Local LLM Routing):** Auto-improvement can create routing-specific skills (e.g., a custom skill that classifies tasks by routing tier). The local model can handle capability gap detection and skill creation drafting, saving cloud quota for refinement.

---

## Research Sources
- [Claude Code Docs — Discover and install prebuilt plugins through marketplaces](https://code.claude.com/docs/en/discover-plugins)
- [Claude Code Docs — Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Claude Code Docs — Automate workflows with hooks](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Docs — Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code Docs — Create plugins](https://code.claude.com/docs/en/plugins)
- [Anthropic — Skill Creator Plugin](https://claude.com/plugins/skill-creator)
- [Anthropic — Improving skill-creator: Test, measure, and refine Agent Skills](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)
- [GitHub — anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [GitHub — anthropics/skills](https://github.com/anthropics/skills)
- [GitHub — flashingcursor/skill-creator-plugin](https://github.com/flashingcursor/skill-creator-plugin)
- [Claude Help Center — How to create custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills)
- [GitHub — Plugin update detection and upgrade workflow (Issue #31462)](https://github.com/anthropics/claude-code/issues/31462)
- [Medium — Claude Code Agent Skills 2.0: From Custom Instructions to Programmable Agents](https://medium.com/@richardhightower/claude-code-agent-skills-2-0-from-custom-instructions-to-programmable-agents-ab6e4563c176)
- [Geeky Gadgets — Claude Code 2 Feature Update: Automation, Workspace Links, and Skill Scoring](https://www.geeky-gadgets.com/claude-code-automation-workflows/)
- [AI Tool Analysis — Claude Code Plugins Review 2026: 9,000+ Extensions](https://aitoolanalysis.com/claude-code-plugins/)
- [Morph — Claude Code Plugins: Best Plugins, Installation & Build Guide 2026](https://www.morphllm.com/claude-code-plugins)
- [International AI Safety Report 2026](https://internationalaisafetyreport.org/publication/international-ai-safety-report-2026)
- [Foom Magazine — Is research into recursive self-improvement becoming a safety hazard?](https://www.foommagazine.org/is-research-into-recursive-self-improvement-becoming-a-safety-hazard/)
- [Edstellar — AI Agents: Reliability Challenges & Proven Solutions (2026)](https://www.edstellar.com/ai-agent-reliability-challenges)
- [Cloud Security Alliance — Agentic AI Predictions for 2026](https://cloudsecurityalliance.org/blog/2026/01/16/my-top-10-predictions-for-agentic-ai-in-2026)
- [Reco AI — Adding Guardrails for AI Agents: Policy and Configuration Guide](https://www.reco.ai/hub/guardrails-for-ai-agents)
- [Akira AI — Real-Time Guardrails for Agentic Systems](https://www.akira.ai/blog/real-time-guardrails-agentic-systems)
- [Galileo — Essential Framework for AI Agent Guardrails](https://galileo.ai/blog/ai-agent-guardrails-framework)

---

## Status History
- 2026-03-15: new — idea submitted by operator
- 2026-03-16: reviewing — feasibility research started
- 2026-03-16: planned — research complete. All infrastructure exists in Claude Code today (marketplace, skill-creator, `claude mcp add`, hooks). Implementation plan created with layered safety architecture. Key principle: discover and create freely, install and configure with approval gates, never touch credentials or security boundaries autonomously.

# IDEA-003: Human Oversight Dashboard

## Original Idea
> Human Oversight Dashboard — a dashboard for human oversight using connectors/MCP/API such as ClickUp and Notion. This would be where I as the human can easily look at things, progress of tasks. Not the developer live dashboard, something I can use day-to-day for management.

## Status: planned
## Priority: high
## Scope: SYSTEM
## Date Submitted: 2026-03-15
## Date Reviewed: 2026-03-15

---

## Feasibility Research

### Current State

The system currently has a developer-facing live dashboard at `localhost:5050` (Node.js + WebSocket) that shows real-time agent activity, Ollama status, and Cowork log events. It has four visual themes (default, aurora, matrix, daylight). This dashboard is designed for monitoring agent internals — it is NOT suitable for day-to-day project management by a non-technical operator. It also only works on the local machine, not from a phone or Mac on the same network.

All task tracking, reviews, venture status, and financials currently live in markdown files within the workspace. The review-inbox/ system tracks items through pending/approved/published states via `review-status.json`.

### What the Operator Needs

- View task progress across ventures from any device (phone, laptop, Mac)
- See review items waiting for approval and act on them
- Track venture status and lifecycle stages
- View financial summaries
- Give instructions or approvals without being at the Windows machine
- Simple, non-technical interface — not a developer tool

---

### Option A: Notion via MCP

**What it is:** Use Notion as the operator-facing dashboard. The AI system syncs workspace state (tasks, reviews, venture status, financials) into a Notion workspace via the official Notion MCP server. The operator views and interacts through Notion's web/mobile apps.

**Availability:** Mature and production-ready. Notion provides an official hosted MCP server with OAuth authentication. Full read/write support. Documented at developers.notion.com. The open-source `notion-mcp-server` on GitHub (by makenotion) also exists but is no longer actively maintained — the hosted version is the recommended path.

**MCP Tools Available:**
- `notion-search` — search across workspace
- Page/block CRUD — create, read, update, delete pages and blocks
- Database operations — create, query, update databases
- Batch operations — multiple operations in one request
- Comments — get, create, reply to comments
- User management — retrieve workspace users

**Complexity:** Medium. Requires:
1. Creating a Notion workspace with the right database structure (ventures, tasks, reviews, financials)
2. Installing the Notion MCP server in the Claude Code/Cowork config
3. Building sync logic — agents push state changes to Notion after each operation
4. Setting up Notion templates/views for the operator (Kanban boards, tables, calendar views)

**Cost:**
- Notion Free plan: unlimited pages/blocks for a single user, 10 guest seats, 5MB file uploads. Sufficient for a solo operator.
- Notion Plus: $10/user/month if more features needed later.
- MCP server: free (hosted by Notion).

**Pros:**
- Excellent mobile app (iOS/Android) — operator can check from phone anywhere
- Beautiful, flexible interface with databases, Kanban boards, calendars, galleries
- Free tier is generous for solo use
- Official MCP server is well-maintained by Notion themselves
- Operator can customise views without technical knowledge
- Comments system allows two-way communication (operator leaves notes, agents read them)
- Strong offline support in the mobile app
- Rate limit: 180 requests/minute — more than sufficient

**Cons:**
- Sync is one-directional unless the system also polls Notion for operator changes
- Notion's API has a 5MB file upload limit on the free plan
- Requires the operator to learn Notion (though it is non-technical friendly)
- Adds a dependency on an external service
- Data lives in two places (markdown files + Notion) — potential for drift
- OAuth-only authentication requires initial setup through a browser

---

### Option B: ClickUp via MCP

**What it is:** Use ClickUp as the operator-facing project management dashboard. The AI system syncs workspace state into ClickUp via the official ClickUp MCP server (public beta). The operator uses ClickUp's web/mobile apps.

**Availability:** Available but in public beta. ClickUp has an official MCP server with OAuth authentication. Community implementations also exist (e.g., `taazkareem/clickup-mcp-server` on GitHub) with broader feature coverage. Available on all ClickUp plans.

**MCP Tools Available:**
- Task CRUD with assignees, priorities, due dates
- Checklist and sprint management
- Time tracking (start/stop timers, log entries)
- Comments and chat
- Executive reports from tasks and docs
- Search across tasks, docs, comments
- Space/list/folder management

**Complexity:** Medium-high. Requires:
1. Setting up a ClickUp workspace with spaces per venture
2. OAuth authentication setup (no API key support — OAuth only)
3. Building sync logic for agents to push updates
4. Mapping the markdown-based workflow to ClickUp's task hierarchy (Spaces > Folders > Lists > Tasks)

**Cost:**
- ClickUp Free Forever: unlimited tasks, 100MB storage, 5 spaces, limited custom fields. Workable for early stage.
- ClickUp Unlimited: $7/user/month for more storage and features.
- MCP server: free.

**Pros:**
- Purpose-built project management tool with Gantt charts, dashboards, time tracking
- Good mobile app
- Built-in dashboards and reporting
- Free tier includes unlimited tasks
- More structured than Notion for task management specifically
- Community MCP server has very broad feature coverage

**Cons:**
- Official MCP server is still in public beta — may have gaps or instability
- OAuth-only authentication adds setup complexity
- 60MB storage limit on free plan is restrictive
- 60-use limit on custom fields and Gantt charts on free plan
- Heavier/more complex interface than Notion — potentially overwhelming for a non-technical user
- ClickUp's learning curve is steeper than Notion
- Free plan limited to 5 "Spaces" (though sufficient for current 1 venture)

---

### Option C: Linear via MCP

**What it is:** Use Linear as the operator-facing dashboard. Linear is a modern, fast issue tracker with an official MCP server.

**Availability:** Production-ready. Official hosted MCP server at `mcp.linear.app/sse`. OAuth 2.1 authentication. Read and write support for issues, projects, teams, comments, and workflow states.

**Complexity:** Medium. Linear's data model (Issues, Projects, Teams, Cycles) maps reasonably well to the venture/task structure.

**Cost:**
- Linear Free: up to 250 active issues, limited integrations.
- Linear Standard: $8/user/month.

**Pros:**
- Extremely fast, clean interface — arguably the best UX of any project management tool
- Official MCP server is production-ready (not beta)
- Good mobile app
- Keyboard-driven interface is efficient

**Cons:**
- Designed for software development teams, not general business operations
- Free tier limited to 250 active issues
- No built-in financial tracking, document management, or flexible databases
- Less customisable than Notion for non-development workflows
- Overkill in some ways, insufficient in others for a business operating system
- No Kanban views for review pipeline management on free tier

---

### Option D: Trello via MCP

**What it is:** Use Trello's Kanban-style boards as the operator dashboard. Multiple community MCP servers exist.

**Availability:** Community-maintained only (no official Atlassian MCP server for Trello). Several implementations on GitHub and npm (`delorenj/mcp-server-trello`, `mcp-trello` on PyPI, `@iflow-mcp/trello-mcp-server`). Also available through Zapier MCP and Composio.

**Complexity:** Low-medium. Trello's simple board/list/card model maps naturally to review pipelines and task tracking.

**Cost:**
- Trello Free: unlimited cards, up to 10 boards per workspace, basic automation.
- Trello Standard: $5/user/month.

**Pros:**
- Simplest interface of all options — very non-technical friendly
- Kanban view maps perfectly to review-inbox workflow (Pending > Approved > Published)
- Good mobile app
- Free tier is functional
- Low learning curve

**Cons:**
- No official MCP server — community implementations may lag or break
- Trello is less powerful for complex project management
- No built-in databases, financial views, or document management
- Limited reporting and dashboards on free tier
- Owned by Atlassian — pricing/features subject to change

---

### Option E: Extended Local Dashboard (Upgrade Existing)

**What it is:** Extend the existing `dashboard-server.js` to add management views — task boards, review pipelines, venture status pages, financial summaries — all reading from the markdown files. Expose it on the local network so it is accessible from other devices.

**Availability:** Can be built immediately using existing infrastructure.

**Complexity:** Medium-high. Requires:
1. Building a management UI (HTML/CSS/JS) with multiple views
2. Adding API endpoints to read/parse markdown files (tasks, reviews, financials)
3. Adding write endpoints for approvals and instructions
4. Binding the server to `0.0.0.0` instead of `localhost` for network access
5. Adding authentication (the server currently has none)
6. Making the UI responsive for mobile
7. Potentially setting up a reverse proxy / tunnel for access outside the local network

**Cost:** Free (no external services). Developer time only.

**Pros:**
- No external dependencies
- Single source of truth (reads directly from markdown files)
- Full control over the interface
- No ongoing subscription costs
- No data leaving the local machine
- Can be tailored exactly to the operator's needs

**Cons:**
- Significant development effort to build a good management UI
- No native mobile app — browser only
- Requires network configuration for access from phone/Mac
- No offline access when away from home network
- Authentication and security must be built from scratch
- Not accessible outside the home network without additional setup (e.g., Tailscale, Cloudflare Tunnel)
- Ongoing maintenance burden — every new feature must be hand-built

---

### Option F: Notion + Agents Sync (Hybrid Approach)

**What it is:** Use Notion as the operator-facing layer, but make the sync bi-directional and systematic. Agents update Notion after every significant action. A scheduled task polls Notion for operator comments/instructions. Markdown files remain the source of truth internally, but Notion serves as the human interface.

**Availability:** All components exist and are production-ready.

**Complexity:** Medium. This is essentially Option A with a more robust sync architecture:
1. Notion workspace with structured databases mirroring workspace state
2. Write-to-Notion after every: task completion, review item creation, venture state change, financial update
3. Read-from-Notion on session start: check for operator comments, instruction changes, approvals
4. Conflict resolution: markdown files are authoritative, Notion is the view layer

**Cost:** Free (Notion Free plan + free MCP server).

**Pros:**
- All the Notion pros from Option A
- Bi-directional communication solves the "giving instructions" need
- Markdown files remain the source of truth — no lock-in
- Operator can approve review items directly in Notion
- Addresses IDEA-001 (Remote Control) partially — operator can leave instructions in Notion from any device
- Notion databases can serve as the "human-readable" layer while agents work with markdown internally

**Cons:**
- Sync complexity — must handle conflicts, failures, partial updates
- Two sources that could drift if sync breaks
- Adds latency to every agent operation (must write to Notion after each action)
- Requires careful design of the Notion database schema to match workspace structure

---

## Recommendation

**Primary: Option F (Notion + Agents Sync — Hybrid Approach)**

Notion is the strongest choice for several reasons:

1. **Best mobile experience** — the operator can check venture status, review items, and leave instructions from a phone in bed, on the train, or from a Mac in another room. This is the core requirement.

2. **Free tier is sufficient** — unlimited pages/blocks for a solo user. No cost to start.

3. **Official MCP server** — production-ready, maintained by Notion, OAuth-based. Not a community project that might go stale.

4. **Flexible data model** — Notion databases can represent tasks, reviews, ventures, and financials in views the operator customises themselves (Kanban, table, calendar, gallery).

5. **Bi-directional potential** — the operator can leave comments/instructions that agents pick up, partially solving IDEA-001 (Remote Control) as a side benefit.

6. **Non-technical friendly** — Notion is widely used by non-developers. The operator likely already knows it or can learn it in an afternoon.

7. **Overlaps with IDEA-001** — implementing this dashboard creates the communication channel that Remote Control also needs. Two ideas, one infrastructure.

**Secondary consideration:** Keep ClickUp as a future alternative if the operator finds Notion's project management features too lightweight. ClickUp's MCP server should mature past beta by then.

**Not recommended:** Building a custom dashboard (Option E) — the development effort is disproportionate to the value when Notion does it better out of the box. Linear and Trello are too narrow for a business operating system dashboard.

---

## Implementation Plan

### Phase 1: Foundation *(Auto — full autonomy)*
1. Research and document the exact Notion database schema needed:
   - **Ventures Database**: name, stage, started date, status, notes
   - **Tasks Database**: title, venture (relation), status, priority, assigned agent, created, completed
   - **Review Inbox Database**: item title, type, venture, status (pending/approved/published), file path, created
   - **Financials Database**: venture, category, amount, date, notes
   - **Agent Activity Database**: timestamp, agent, action, status, detail
2. Install the Notion MCP server in Claude Code configuration
3. Document the sync protocol (when to push, what to push, conflict rules)

### Phase 2: Notion Setup *(Approve — requires operator approval to create Notion account/workspace)*
4. Operator creates a Notion account (if they don't have one) and workspace
5. Operator completes OAuth flow to authorise the MCP connection
6. Create the database structure in Notion via MCP
7. Create dashboard views: venture overview, task board (Kanban), review pipeline, financial summary
8. Populate with current state from markdown files (initial sync)

### Phase 3: Write Sync *(Auto)*
9. Build sync functions that agents call after key operations:
   - `sync_task_to_notion(task)` — after task creation/completion
   - `sync_review_to_notion(item)` — after review item creation
   - `sync_venture_state(venture)` — after venture state changes
   - `sync_financials(entry)` — after financial entries
10. Add sync calls to the standard agent workflows (session end, task completion, review creation)
11. Add error handling — if Notion sync fails, log it and continue (never block the main workflow)

### Phase 4: Read Sync *(Auto)*
12. Build a "check Notion for operator input" routine that runs at session start:
    - Check for new comments on any database item
    - Check for status changes in the Review Inbox database (operator marked something as approved)
    - Check for new items in an "Instructions" database (operator's ad-hoc requests)
13. Translate operator actions back into workspace changes (e.g., approval in Notion triggers the review-inbox state change in markdown)

### Phase 5: Polish and Automate *(Auto / Notify)*
14. Create Notion templates for common views
15. Set up a scheduled sync check (e.g., every session start + on-demand)
16. Write operator documentation: "How to use your dashboard"
17. Test from phone (iOS/Android Notion app) and Mac (Notion web/desktop)

### Estimated Effort
- Phase 1: 1-2 hours (research + schema design + MCP install)
- Phase 2: 1-2 hours (workspace setup + initial sync) — requires operator for OAuth
- Phase 3: 2-3 hours (write sync functions + integration into workflows)
- Phase 4: 1-2 hours (read sync + operator input handling)
- Phase 5: 1-2 hours (templates + documentation + testing)
- **Total: 6-11 hours of agent work + ~30 minutes of operator time (account creation + OAuth)**

### Dependencies
- Operator must create a Notion account and authorise OAuth (Approve)
- Notion MCP server must be added to `claude_desktop_config.json` or equivalent
- Reliable internet connection for sync operations

### Risks
- Notion API rate limit (180 req/min) is unlikely to be an issue but should be monitored
- If Notion changes their MCP server or API, sync could break — mitigated by the fact that markdown files remain the source of truth
- OAuth token expiry — need to handle re-authentication gracefully

---

## Relationship to Other Ideas
- **IDEA-001 (Remote Control):** This dashboard partially solves remote control by giving the operator a Notion-based interface to view status and leave instructions from any device. Full remote control (sending commands, receiving files) would build on top of this infrastructure.
- **IDEA-002 (Auto-Improvement):** The auto-improvement system could track its own activities in the dashboard, giving the operator visibility into what the system is updating.
- **IDEA-004 (Smart Local LLM Routing):** No direct dependency, but the dashboard could display which model is handling which task.

---

## Research Sources
- [ClickUp MCP Server (GitHub)](https://github.com/taazkareem/clickup-mcp-server)
- [ClickUp MCP Help Article](https://help.clickup.com/hc/en-us/articles/33335772678423-What-is-ClickUp-MCP)
- [ClickUp MCP Developer Docs](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server)
- [Notion MCP Developer Guide](https://developers.notion.com/guides/mcp/get-started-with-mcp)
- [Notion MCP Server (GitHub)](https://github.com/makenotion/notion-mcp-server)
- [Notion MCP Supported Tools](https://developers.notion.com/guides/mcp/mcp-supported-tools)
- [Notion MCP Official Page](https://developers.notion.com/docs/mcp)
- [Linear MCP Server Docs](https://linear.app/docs/mcp)
- [Trello MCP Server (GitHub)](https://github.com/delorenj/mcp-server-trello)
- [Project Management MCP Servers Overview](https://www.merge.dev/blog/project-management-mcp-servers)
- [MCP 2026 Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [ClickUp Pricing](https://clickup.com/pricing)
- [Notion Pricing](https://www.notion.com/pricing)

---

## Status History
- 2026-03-15: new — idea submitted by operator
- 2026-03-15: reviewing — feasibility research started
- 2026-03-15: planned — research complete, Notion hybrid approach recommended, implementation plan created

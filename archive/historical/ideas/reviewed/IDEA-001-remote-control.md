# IDEA-001: Remote Control

## Original Idea
> Remote Control -- be able to seamlessly access/check in/give instructions to the AI system from my phone or Mac or other device just as easily. Ideas include using Anthropic's own remote control tool or connecting Claude Code and Cowork or the system itself to apps like Discord or ClickUp where I could give instructions, receive messages from agents including any files they want me to review etc.

## Status: planned
## Priority: high
## Scope: SYSTEM
## Date Submitted: 2026-03-15
## Date Reviewed: 2026-03-15

---

## Feasibility Research

### Option A: Anthropic Remote Control (Native Feature)

- **What it is:** A first-party feature released by Anthropic on 25 February 2026. It creates a synchronisation layer between a local Claude Code terminal session and the Claude mobile app (iOS/Android) or claude.ai/code in any browser. You run `claude remote-control` or `claude --remote-control` in your terminal. It displays a session URL and a QR code. Scan the QR code on your phone and you get a full interactive session -- your local filesystem, MCP servers, tools, and project configuration all remain active. Your code never leaves your machine; only chat messages and tool results flow through an encrypted bridge.
- **Availability:** YES -- released and live. Available on Pro, Max, Team, and Enterprise plans (Pro rollout may still be gradual -- some Pro users have reported access issues as of early March 2026). Requires Claude Code v2.1.51 or later.
- **Complexity:** Low. Single command to start. No port forwarding, VPN, or infrastructure needed.
- **Cost:** Free with existing Claude Pro ($20/month) or Max ($100-200/month) subscription. No additional cost.
- **Pros:**
  - First-party, maintained by Anthropic -- most reliable and supported option
  - Zero infrastructure to set up -- one command (`claude remote-control`)
  - All local MCP servers remain active and accessible remotely
  - Automatic reconnection if laptop sleeps or network drops (up to ~10 minutes)
  - Works from phone, tablet, Mac, any browser -- anywhere
  - Server mode supports up to 32 concurrent sessions
  - End-to-end encrypted -- code never leaves your machine
  - QR code for instant phone connection
  - Can be enabled for all sessions automatically via `/config`
- **Cons:**
  - Only works with Claude Code (terminal/CLI), not directly with Claude Desktop Cowork sessions
  - Terminal must stay open -- if the `claude` process is closed, the session ends
  - Extended network outage (~10 minutes) causes session timeout
  - Cowork (Claude Desktop) does not have an equivalent remote feature yet
  - Currently a research preview -- may have rough edges

### Option B: Discord MCP Server

- **What it is:** A community-built MCP server that connects Claude to Discord, enabling Claude to send/receive messages, manage channels, react to messages, and interact with Discord servers. Multiple implementations exist (mcp-discord, discord-mcp by SaseQ, discord-mcp by RossH121). Once installed as an MCP server in Claude Code or Claude Desktop, Claude can read and write Discord messages, letting you use a Discord channel as a command/communication interface.
- **Availability:** YES -- multiple open-source implementations available on GitHub and npm.
- **Complexity:** Medium. Requires creating a Discord bot, setting up a Discord server, configuring the MCP server in Claude Code/Desktop, and managing bot permissions.
- **Cost:** Free (Discord is free, MCP servers are open-source). Requires a Discord account and server.
- **Pros:**
  - Works on all devices (Discord has iOS, Android, Mac, Windows, web apps)
  - Could serve as a unified communication hub for the AI system
  - Supports rich media -- files, images, embeds can be sent both ways
  - Multiple mature implementations with up to 87 tools available
  - Could be used for both Claude Code and Cowork (as an MCP server in Claude Desktop)
  - Thread support means multiple conversations/tasks can run in parallel
  - Real-time notifications on your phone via Discord push notifications
- **Cons:**
  - Not a native integration -- community-maintained, could break with updates
  - Requires a Discord bot token and server setup (moderate technical setup)
  - Messages pass through Discord's servers -- not end-to-end encrypted
  - Claude cannot initiate conversations -- it can only respond when invoked or use Discord as a tool during an active session
  - Does not give you a direct "remote control" of the terminal -- it is a messaging relay
  - Requires an active Claude session to be running for the MCP to work

### Option C: Telegram MCP Server / Telegram Bot Bridge

- **What it is:** Multiple approaches exist: (1) Telegram MCP servers that let Claude send/receive Telegram messages as a tool, (2) Claude-Telegram-Bridge, an MCP server specifically designed to let Claude Code notify you via Telegram during autonomous work and receive your replies, and (3) standalone Telegram bots (like claude-code-telegram) that spawn Claude Code as a subprocess and relay input/output via Telegram. The Bridge approach is particularly compelling -- during autonomous work, Claude sends questions and progress updates to your phone and receives replies, with multi-session threading.
- **Availability:** YES -- multiple implementations available (claude-telegram-bridge, TSGram MCP, claude-code-telegram, @s1lverain/claude-telegram-mcp on npm).
- **Complexity:** Medium. Requires creating a Telegram bot via BotFather, getting a bot token and chat ID, and configuring the MCP server or bot.
- **Cost:** Free (Telegram is free, all implementations are open-source).
- **Pros:**
  - Telegram is lightweight, fast, and works on all devices
  - Claude-Telegram-Bridge supports multi-session threading -- replies route to the correct session
  - Push notifications to your phone when Claude needs input or has updates
  - The standalone bot approach (claude-code-telegram) gives full Claude Code access from Telegram
  - Voice message support in some implementations (yottoCode)
  - Simpler than Discord -- fewer moving parts, no server/channel management
  - Very popular in the developer community -- well-documented with multiple guides
- **Cons:**
  - Messages pass through Telegram servers -- not end-to-end encrypted for bot messages (regular Telegram chats have E2E encryption but bot API does not)
  - Security risk: bot has full machine access via Claude Code -- must whitelist user IDs carefully
  - Community-maintained -- could break with Claude Code updates
  - Standalone bot approach requires Claude Code CLI installed and accessible
  - The MCP approach still requires an active Claude session

### Option D: ClickUp MCP Server

- **What it is:** An MCP server that connects Claude to ClickUp for task management. ClickUp officially supports MCP with a first-party setup guide. Enables Claude to create tasks, update statuses, log time, search tasks and docs, post comments, and generate reports -- all from within a Claude session. Multiple implementations exist including an official ClickUp developer integration and community servers.
- **Availability:** YES -- officially supported by ClickUp with first-party documentation. Available on all ClickUp plans.
- **Complexity:** Low-Medium. ClickUp provides official setup instructions. Requires a ClickUp API token.
- **Cost:** ClickUp Free plan available (limited features). Paid plans from $7/month per user. MCP server is free/open-source.
- **Pros:**
  - Official ClickUp support with maintained documentation
  - Purpose-built for task management -- proper project boards, lists, priorities, due dates
  - Mobile app is excellent -- full task management from phone
  - Could serve as the "Human Oversight Dashboard" (IDEA-003) as well -- two birds, one stone
  - Comments and chat features allow two-way communication with the AI system
  - Time tracking, reporting, and portfolio management built in
  - Works with both Claude Code and Cowork as an MCP server
- **Cons:**
  - Not a direct "remote control" -- it is a task management layer, not a terminal relay
  - Cannot send ad-hoc instructions to Claude in real time (you set tasks, Claude picks them up)
  - Paid plans needed for meaningful features (automations, dashboards, custom fields)
  - Adds another platform to the stack -- operator must learn ClickUp
  - Does not replace the need for direct session access

### Option E: Expose Existing Dashboard via Tunnel (Tailscale / Cloudflare Tunnel)

- **What it is:** The system already has a live WebSocket dashboard at localhost:5050. Using a tunnelling service (Tailscale, Cloudflare Tunnel, or ngrok), this dashboard can be made accessible from any device on the internet, including your phone. Tailscale creates a private mesh network across your devices using WireGuard encryption. Cloudflare Tunnel uses their global CDN to proxy traffic. ngrok provides instant public URLs.
- **Availability:** YES -- all three services are mature and widely used.
- **Complexity:** Low (Tailscale) to Medium (Cloudflare Tunnel).
- **Cost:** Tailscale free for personal use (up to 100 devices). Cloudflare Tunnel free tier available. ngrok free tier with limits.
- **Pros:**
  - Leverages what already exists -- the dashboard is already built
  - Tailscale is install-and-forget -- zero configuration after initial setup
  - Tailscale mobile app available on iOS and Android -- dashboard accessible from phone
  - Cloudflare Tunnel gives a permanent URL with SSL, no port forwarding needed
  - Could be extended to expose other local services (Ollama web UI, etc.)
  - No dependency on third-party chat platforms
- **Cons:**
  - Dashboard is currently read-only (monitoring) -- would need development to add command input
  - Tailscale requires app installation on each device
  - Cloudflare Tunnel requires a domain name
  - ngrok free tier has session limits and changing URLs
  - Does not provide a conversational interface -- just a dashboard view
  - Security: exposing local services to the internet requires careful configuration

### Option F: Claude Code SSH + Tailscale (Direct Terminal Access)

- **What it is:** Using Tailscale to create a private network between your devices, then SSH-ing from your phone or Mac into the Windows PC to run Claude Code commands directly. Combined with a mobile SSH client (Termius, Blink Shell), this gives full terminal access to the AI system from anywhere.
- **Availability:** YES -- Tailscale and SSH are mature, well-documented technologies.
- **Complexity:** Medium-High. Requires SSH server setup on Windows 11, Tailscale installation on all devices, and a mobile SSH client.
- **Cost:** Free (Tailscale free tier, OpenSSH built into Windows 11, free SSH clients available).
- **Pros:**
  - Full terminal access -- can do anything you could do sitting at the PC
  - Private network -- no services exposed to the public internet
  - Works from any device with an SSH client
  - No dependency on Anthropic's infrastructure or third-party services
  - Can run Claude Code, manage files, restart services, etc.
- **Cons:**
  - Technical to set up (SSH server on Windows, Tailscale, key management)
  - Terminal interface on a phone is not user-friendly for a non-technical operator
  - No push notifications -- you have to actively check in
  - Not a practical daily-driver for someone who is non-technical
  - Requires keeping SSH server secure and updated

---

## Recommendation

Pursue a **layered approach** combining multiple options for different use cases:

### Phase 1 — Immediate (this week)
1. **Anthropic Remote Control (Option A)** -- This is the clear winner for direct Claude Code access from mobile. It is first-party, zero-infrastructure, encrypted, and already available. Set it up immediately. Run `claude remote-control` in the ai-workspace directory and it just works. This handles the core need of "give instructions to Claude Code from your phone."

### Phase 2 — Short-term (next 1-2 weeks)
2. **Telegram Bridge MCP (Option C)** -- Install claude-telegram-bridge as an MCP server. This fills the gap that Remote Control does not cover: **proactive notifications from Claude to you**. When Cowork is running autonomously and needs approval or has a question, it sends you a Telegram message. You reply from your phone. This is the missing piece for true remote operation.

3. **Dashboard Tunnel via Tailscale (Option E)** -- Install Tailscale on the Windows PC and your phone/Mac. This makes the existing localhost:5050 dashboard accessible from any of your devices on the private network. Quick win for monitoring, and Tailscale is useful infrastructure for many future needs.

### Phase 3 — Medium-term (when needed)
4. **ClickUp MCP (Option D)** -- Evaluate this alongside IDEA-003 (Human Oversight Dashboard). If ClickUp is chosen for task management, the MCP integration comes naturally and provides another remote control surface.

5. **Discord MCP (Option B)** -- Hold in reserve. Discord is more complex than Telegram for this use case and adds unnecessary infrastructure. Only pursue if Telegram proves insufficient or if Discord is already part of the workflow.

### Not Recommended
6. **SSH + Tailscale (Option F)** -- Too technical for a non-technical operator. The other options provide better UX for the same outcome.

---

## Implementation Plan

### Implementation Phase 1: Anthropic Remote Control *(Auto — full autonomy)*
1. **Verify Claude Code version** -- Run `claude --version` and confirm v2.1.51 or later. Update if needed. *(Auto)*
2. **Verify plan access** -- Confirm Remote Control is available on current subscription. *(Auto)*
3. **Start a Remote Control session** -- Run `claude remote-control --name "AI-Workspace"` from c:\ai-workspace\. *(Auto)*
4. **Install Claude app on phone** -- Download from iOS App Store or Google Play. Sign in with Anthropic account. *(Human-Only)*
5. **Connect from phone** -- Scan QR code or open claude.ai/code to connect. Test sending a message. *(Human-Only)*
6. **Enable for all sessions** -- Run `/config` in Claude Code and set "Enable Remote Control for all sessions" to true. *(Notify)*
7. **Document in system config** -- Update config/ files with Remote Control setup details. *(Auto)*

### Implementation Phase 2: Telegram Bridge *(Notify after)*
1. **Create Telegram account** if not already existing. *(Human-Only)*
2. **Create Telegram bot** via @BotFather -- get bot token. *(Human-Only)*
3. **Get chat ID** -- message the bot and retrieve your chat_id. *(Human-Only)*
4. **Install claude-telegram-bridge MCP** -- Add to Claude Code and Claude Desktop MCP configuration. *(Notify)*
5. **Configure environment variables** -- Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. *(Auto)*
6. **Test notification flow** -- Have Claude send a test message to Telegram. Reply and confirm round-trip works. *(Approve)*
7. **Set up allowed users** -- Whitelist only the operator's Telegram user ID for security. *(Auto)*

### Implementation Phase 3: Dashboard Access via Tailscale *(Auto)*
1. **Create Tailscale account** (free tier). *(Human-Only)*
2. **Install Tailscale on Windows PC**. *(Human-Only)*
3. **Install Tailscale on phone and Mac**. *(Human-Only)*
4. **Access dashboard** -- Navigate to the PC's Tailscale IP on port 5050 from phone. *(Auto)*
5. **Optional: Add command input to dashboard** -- Extend the existing dashboard with a simple input field to queue instructions. *(Auto — development task)*

### Implementation Phase 4: ClickUp MCP (Evaluate with IDEA-003)
1. **Decision point** -- Evaluate ClickUp alongside IDEA-003 Human Oversight Dashboard research. *(Auto)*
2. **If proceeding** -- Set up ClickUp workspace, install MCP server, configure API token. *(Approve)*

### Estimated Effort
- **Phase 1 (Remote Control):** 15-30 minutes. Complexity: Low. No blockers.
- **Phase 2 (Telegram Bridge):** 1-2 hours. Complexity: Low-Medium. Requires Telegram account.
- **Phase 3 (Tailscale Dashboard):** 30-60 minutes. Complexity: Low. No blockers.
- **Phase 4 (ClickUp):** 2-4 hours. Complexity: Medium. Dependent on IDEA-003 decision.

### Dependencies
- Phase 1: Active Claude Pro/Max subscription with Remote Control access
- Phase 2: Telegram account, bot token
- Phase 3: Tailscale account (free)
- Phase 4: Dependent on IDEA-003 research outcome

---

## Status History
- 2026-03-15: new -- idea submitted by operator
- 2026-03-15: reviewing -- feasibility research started
- 2026-03-15: planned -- all options researched; multi-phase implementation plan created. Anthropic Remote Control is the clear primary solution, supplemented by Telegram Bridge for notifications and Tailscale for dashboard access.

---

## Sources
- [Anthropic Remote Control Official Docs](https://code.claude.com/docs/en/remote-control)
- [VentureBeat: Anthropic releases Remote Control](https://venturebeat.com/orchestration/anthropic-just-released-a-mobile-version-of-claude-code-called-remote)
- [Help Net Security: Remote Control feature](https://www.helpnetsecurity.com/2026/02/25/anthropic-remote-control-claude-code-feature/)
- [DevOps.com: Remote Control overview](https://devops.com/claude-code-remote-control-keeps-your-agent-local-and-puts-it-in-your-pocket/)
- [Discord MCP Server (SaseQ)](https://github.com/SaseQ/discord-mcp)
- [Discord MCP Server (RossH121)](https://glama.ai/mcp/servers/@RossH121/discord-mcp)
- [ClickUp MCP Setup Instructions](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server-1)
- [ClickUp MCP Server (taazkareem)](https://github.com/taazkareem/clickup-mcp-server)
- [Claude Telegram Bridge MCP](https://lobehub.com/mcp/ricardoagl-claude-telegram-bridge)
- [claude-code-telegram bot](https://github.com/RichardAtCT/claude-code-telegram)
- [TSGram Telegram MCP](https://github.com/areweai/tsgram-mcp)
- [Tailscale tunneling overview](https://tailscale.com/learn/ngrok-alternatives)
- [Cloudflare Tunnel vs ngrok vs Tailscale](https://dev.to/mechcloud_academy/cloudflare-tunnel-vs-ngrok-vs-tailscale-choosing-the-right-secure-tunneling-solution-4inm)
- [NxCode: Remote Control setup guide](https://www.nxcode.io/resources/news/claude-code-remote-control-mobile-terminal-handoff-guide-2026)

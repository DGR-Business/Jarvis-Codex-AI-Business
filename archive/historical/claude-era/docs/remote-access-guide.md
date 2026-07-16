# Remote Access Guide — AI Business OS

## Current Status (v2.1.87, Claude Pro)

| Feature | Status | Notes |
|---------|--------|-------|
| Scheduled tasks (auto-run) | ✅ Working | Daily pulse, weekly health, product cycle |
| Telegram plugin (send only) | ✅ Installed | Jarvis can send messages/files to Telegram; receiving needs future update |
| RemoteTrigger on-demand | ❌ Plan limitation | Requires Claude Max/Team/Enterprise plan |
| `--channels` flag | ❌ Not in v2.1.87 | Telegram/Discord receive mode — not yet released |
| `/remote-control` command | ❌ Not in v2.1.87 | Not yet released in CLI |

---

## What Works Now

### 1. Scheduled Automatic Operations

Three tasks run automatically on your Windows PC:

| Task | When | What it does |
|------|------|-------------|
| Daily Strategic Pulse | 9:00 AM daily | Session review, idea check, approval processing, business-advisor pulse |
| Weekly System Health | Monday 10:00 AM | MCP config check, log review, stale item flags, health report |
| Product Creation Cycle | 2:00 PM weekdays | **Disabled** until venture reaches Stage 1 |

Enable/disable via the Scheduled section in the VS Code sidebar, or ask Jarvis.

### 2. Gmail Notifications

The `email-notify` skill will send reports and approval notifications to your Gmail. Once a task runs, you get an email with the summary and PDF attached. This is the primary "remote notification" system that works today.

### 3. Dashboard (local network)

The dashboard server runs on port 5050. Access it from any browser on the same WiFi network as the PC:
```
http://<your-pc-local-ip>:5050
```
Find your local IP: Windows Settings → Network → Properties → IPv4 address.

---

## What's Coming (Ready When Claude Code Updates)

Both channel plugins are already installed and configured. When Claude Code adds `--channels` support (expected in a future release), you launch with:

```bash
# Telegram only
claude --channels plugin:telegram@claude-plugins-official

# Both remote control + Telegram
claude --channels plugin:telegram@claude-plugins-official --remote-control "AI Business OS"
```

**Telegram plugin:** Already installed (v0.0.4, Bun 1.3.11). You just need to:
1. Create a bot via @BotFather on Telegram
2. Run `/telegram:configure <token>` in Claude Code
3. Relaunch with `--channels` when that flag is available

**Discord plugin:** Also installed (v0.0.4). Same process via Discord Developer Portal.

**Remote Triggers (on-demand):** Available on Claude Max plan. The `RemoteTrigger` tool and `schedule` skill will work on upgrade. Trigger definitions for common operations are ready to create.

---

## Upgrade Path

**Upgrade to Claude Max** to unlock:
- Remote Triggers (run Jarvis operations from claude.ai on any device)
- `schedule` skill for creating on-demand triggers
- Full API access for automation

**Wait for Claude Code v2.1.88+** for:
- `--channels` flag (Telegram/Discord incoming messages)
- `/remote-control` slash command (steer session from any browser)

---

## Files
- Telegram plugin: `~/.claude/plugins/cache/claude-plugins-official/telegram/0.0.4/`
- Discord plugin: `~/.claude/plugins/cache/claude-plugins-official/discord/0.0.4/`
- Bun runtime: `~/.bun/bin/bun` (v1.3.11)
- Channel config dirs: `~/.claude/channels/telegram/` and `~/.claude/channels/discord/`

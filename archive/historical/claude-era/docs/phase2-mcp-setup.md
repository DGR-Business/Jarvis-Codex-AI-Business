# Phase 2 — MCP Installation Guide

**Status:** Partially complete — Gmail, Drive, Calendar connectors active. Etsy MCP configured (needs OAuth). See current state below.
**Created:** 2026-03-13
**Updated:** 2026-04-03
**Purpose:** Step-by-step instructions to install and configure the core MCP servers needed for the AI Business OS.

---

## Before You Start

**What is an MCP?**
MCP stands for Model Context Protocol. Each MCP is a small server that gives Claude Desktop a specific ability — reading files, searching the web, sending emails, etc. You install them by editing a single config file and restarting Claude Desktop.

**What you need:**
- Claude Desktop installed and running (Pro plan)
- Node.js installed (to run MCP servers)
- A text editor (Notepad works, but VS Code is better)
- About 60-90 minutes for the full setup

**Important security rules (from config/security.md):**
- API keys must NEVER be stored in workspace files — only in the MCP config or environment variables
- Use read-only credentials wherever possible
- Filesystem access is restricted to `C:\ai-workspace\` only

---

## Step 0 — Prerequisites

### 0.1 Install Node.js (if not already installed)

1. Open your web browser
2. Go to: https://nodejs.org/
3. Click the big green **LTS** (Long Term Support) download button
4. Run the downloaded installer — accept all defaults, click Next through everything
5. When it finishes, **restart your computer**
6. To verify it worked: press `Win + R`, type `cmd`, press Enter, then type:
   ```
   node --version
   ```
   You should see a version number like `v22.x.x`. If you see an error, the install didn't work — try again.

### 0.2 Install uv (Python package runner, needed for some MCPs)

Some MCPs (particularly the Google ones) use Python instead of Node.js. They need `uv` to run.

1. Open a command prompt (press `Win + R`, type `cmd`, press Enter)
2. Paste this command and press Enter:
   ```
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
3. Close and reopen the command prompt
4. Verify by typing:
   ```
   uv --version
   ```
   You should see a version number.

### 0.3 Locate your MCP config file

The MCP config file tells Claude Desktop which MCP servers to load. Here is where it lives:

```
%APPDATA%\Claude\claude_desktop_config.json
```

To find it:
1. Press `Win + R`
2. Type `%APPDATA%\Claude` and press Enter — a folder will open
3. Look for `claude_desktop_config.json`
   - If it exists, great — you will edit it
   - If it does NOT exist, you will create it in Step 1

**Tip:** Right-click the file and choose "Open with" then pick Notepad (or VS Code if installed).

### 0.4 Understand the config file structure

The config file is JSON. It looks like this when empty:

```json
{
  "mcpServers": {}
}
```

Each MCP gets added as a block inside `mcpServers`. As you work through this guide, you will keep adding blocks. The final result will look like a long list of blocks inside those curly braces.

**Golden rule:** After every edit, make sure the JSON is valid. Common mistakes:
- Missing comma between blocks
- Extra comma after the last block
- Mismatched curly braces `{}` or square brackets `[]`

If Claude Desktop fails to start after an edit, your JSON has a syntax error. Undo your last change and try again.

---

## MCP 1 — Filesystem (Read/Write Local Files)

**What it does:** Lets Claude read and write files inside your workspace.
**API key needed:** No
**Difficulty:** Easy

### 1.1 Open the config file

Open `%APPDATA%\Claude\claude_desktop_config.json` in a text editor.

### 1.2 Add the Filesystem MCP block

If the file is empty or does not exist, paste this as the entire contents:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-filesystem",
        "C:\\ai-workspace"
      ]
    }
  }
}
```

If the file already has content (from a previous MCP install), add the `"filesystem": { ... }` block inside the existing `"mcpServers"` object, separated by a comma from any other blocks.

**Security note:** The path `C:\\ai-workspace` restricts Claude to ONLY that folder and its subfolders. Do NOT add your entire C:\ drive or user folder. The double backslashes (`\\`) are required in JSON on Windows.

### 1.3 Save and restart Claude Desktop

1. Save the file
2. Fully close Claude Desktop (right-click the system tray icon near the clock, choose Quit/Exit)
3. Reopen Claude Desktop

### 1.4 Test it

Open Cowork and type:

```
Read the file at C:\ai-workspace\CLAUDE.md and tell me the first heading.
```

**Expected result:** Claude should read the file and tell you the first heading is "AI Business Operating System — Master Brief".

If it works, Filesystem MCP is installed. Move on.

---

## MCP 2 — Brave Search (Web Search)

**What it does:** Lets Claude search the web using Brave Search.
**API key needed:** Yes (free tier available — 2,000 searches/month)
**Difficulty:** Easy

### 2.1 Get a Brave Search API key

1. Go to: https://brave.com/search/api/
2. Click **Get Started** or **Get API Key**
3. Create an account (or sign in)
4. Choose the **Free** plan (2,000 queries/month — plenty to start)
5. Once signed in, go to your dashboard and find your **API Key**
6. Copy the API key — it will look like a long string of letters and numbers (e.g., `BSA_xxxxxxxxxxxxxxxxxxxxxxxx`)

**Do NOT paste this key into any file inside C:\ai-workspace\. It goes ONLY in the MCP config file.**

### 2.2 Set the API key as an environment variable (recommended)

This is the most secure approach:

1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Click the **Advanced** tab
3. Click **Environment Variables** at the bottom
4. Under **User variables**, click **New**
5. Variable name: `BRAVE_API_KEY`
6. Variable value: paste your API key
7. Click OK, OK, OK to close all dialogs
8. **Restart your computer** (environment variables need a restart to take effect everywhere)

### 2.3 Add the Brave Search MCP block

Open `%APPDATA%\Claude\claude_desktop_config.json` and add this block inside `"mcpServers"` (remember the comma to separate it from the filesystem block):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-filesystem",
        "C:\\ai-workspace"
      ]
    },
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-brave-search"
      ],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    }
  }
}
```

**Note:** If the `${BRAVE_API_KEY}` environment variable substitution does not work (Claude says it cannot search), replace `"${BRAVE_API_KEY}"` with your actual key in quotes. This is less ideal from a security perspective but still acceptable since the config file is outside the workspace.

**Alternative (direct key in config):**
```json
"env": {
  "BRAVE_API_KEY": "BSA_your_actual_key_here"
}
```

### 2.4 Save and restart Claude Desktop

Same as before — save the file, quit Claude Desktop fully, reopen it.

### 2.5 Test it

Open Cowork and type:

```
Search the web for "print on demand Australia 2026" and give me a summary of the top 3 results.
```

**Expected result:** Claude should perform a web search and return real, current results.

---

## MCP 3 — Google Drive (Read/Write Cloud Documents)

**What it does:** Lets Claude read and create files in your Google Drive.
**API key needed:** Yes (Google Cloud OAuth — free)
**Difficulty:** Medium (Google Cloud setup is fiddly but you only do it once)

### Before you start: MCPs 3, 4, and 5 (Drive, Gmail, Calendar) all use the same Google Cloud project. Do Step 3.1 once and reuse it for all three.

### 3.1 Set up a Google Cloud project with OAuth

This is the most involved part of the entire guide. Take it step by step.

**A. Create a Google Cloud project:**

1. Go to: https://console.cloud.google.com/
2. Sign in with the Google account you want Claude to access
3. At the top of the page, click the project dropdown (it may say "Select a project")
4. Click **New Project**
5. Project name: `claude-mcp` (or anything you like)
6. Click **Create**
7. Make sure this new project is selected in the dropdown at the top

**B. Enable the required APIs:**

1. In the left sidebar, click **APIs & Services** then **Library**
2. Search for **Google Drive API** — click it, then click **Enable**
3. Go back to the Library
4. Search for **Gmail API** — click it, then click **Enable**
5. Go back to the Library
6. Search for **Google Calendar API** — click it, then click **Enable**

**C. Configure the OAuth consent screen:**

1. In the left sidebar, click **APIs & Services** then **OAuth consent screen**
2. Choose **External** user type (unless you have a Google Workspace org), click **Create**
3. Fill in:
   - App name: `Claude MCP`
   - User support email: your email
   - Developer contact information: your email
4. Click **Save and Continue**
5. On the **Scopes** screen, click **Add or Remove Scopes**
6. Search and add these scopes:
   - `https://www.googleapis.com/auth/drive` (or `/drive.file` for more restricted access)
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
7. Click **Update**, then **Save and Continue**
8. On the **Test users** screen, click **Add Users**, enter your Google email, click **Add**
9. Click **Save and Continue**, then **Back to Dashboard**

**D. Create OAuth credentials:**

1. In the left sidebar, click **APIs & Services** then **Credentials**
2. Click **+ Create Credentials** at the top, then choose **OAuth client ID**
3. Application type: **Desktop app**
4. Name: `Claude Desktop`
5. Click **Create**
6. A dialog will show your **Client ID** and **Client Secret** — click **Download JSON**
7. Save this file somewhere safe **outside** the workspace (e.g., `C:\Users\YourName\mcp-credentials\`)
8. **Never move this file into C:\ai-workspace\**

Take note of:
- The path where you saved the JSON file (e.g., `C:\Users\YourName\mcp-credentials\client_secret_XXXXX.json`)
- Your Client ID
- Your Client Secret

### 3.2 Add the Google Drive MCP block

Open `%APPDATA%\Claude\claude_desktop_config.json` and add this block inside `"mcpServers"`:

```json
"google-drive": {
  "command": "npx",
  "args": [
    "-y",
    "@anthropic/mcp-google-drive"
  ],
  "env": {
    "GOOGLE_CLIENT_ID": "your-client-id-here.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "your-client-secret-here"
  }
}
```

Replace the placeholder values with your actual Client ID and Client Secret from Step 3.1D.

**Important:** If the MCP package name above does not work (package not found error), the Google Drive MCP may use a different package name or approach. Check the official MCP directory at https://github.com/modelcontextprotocol/servers for the latest package name. Alternatives include:
- `@anthropic/mcp-gdrive`
- `@modelcontextprotocol/server-gdrive`

### 3.3 First-run authentication

1. Save the config and restart Claude Desktop
2. The first time you use a Google Drive command, a browser window should pop up asking you to sign in to Google and authorize the app
3. Sign in with the same Google account from Step 3.1
4. Click **Allow** on the consent screen
5. The browser will redirect — you can close it after seeing a success message

If the browser does NOT pop up, check Claude Desktop's logs for errors. The MCP may need the credentials JSON file path instead — check the MCP's documentation.

### 3.4 Test it

Open Cowork and type:

```
List the 5 most recent files in my Google Drive.
```

**Expected result:** Claude should list real files from your Google Drive.

---

## MCP 4 — Gmail (Read, Draft, Send Email)

**What it does:** Lets Claude read your inbox, draft emails, and send them (with your approval).
**API key needed:** Uses the same Google Cloud project from Step 3.1
**Difficulty:** Easy (if you already completed Step 3.1)

### 4.1 Add the Gmail MCP block

Open `%APPDATA%\Claude\claude_desktop_config.json` and add this block inside `"mcpServers"`:

```json
"gmail": {
  "command": "npx",
  "args": [
    "-y",
    "@anthropic/mcp-gmail"
  ],
  "env": {
    "GOOGLE_CLIENT_ID": "your-client-id-here.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "your-client-secret-here"
  }
}
```

Use the same Client ID and Client Secret from Step 3.1D.

**Alternative package names if the above does not work:**
- `@modelcontextprotocol/server-gmail`
- `@anthropic/mcp-google-gmail`

### 4.2 First-run authentication

Same as Google Drive — restart Claude Desktop. The first time you ask it to read email, a browser window will pop up for Google sign-in. Authorize it.

### 4.3 Test it

Open Cowork and type:

```
Show me the subject lines of my 5 most recent emails.
```

**Expected result:** Claude should list real emails from your inbox.

**CRITICAL REMINDER:** Sending email is an Approve-level action. Claude must ALWAYS get your approval before sending. This is not optional — every email sent is a legally binding communication under Australian law. If Claude ever tries to send without asking, stop the session and report it.

---

## MCP 5 — Google Calendar (Schedule and Manage Events)

**What it does:** Lets Claude read, create, and modify calendar events.
**API key needed:** Uses the same Google Cloud project from Step 3.1
**Difficulty:** Easy (if you already completed Step 3.1)

### 5.1 Add the Google Calendar MCP block

Open `%APPDATA%\Claude\claude_desktop_config.json` and add this block inside `"mcpServers"`:

```json
"google-calendar": {
  "command": "npx",
  "args": [
    "-y",
    "@anthropic/mcp-google-calendar"
  ],
  "env": {
    "GOOGLE_CLIENT_ID": "your-client-id-here.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "your-client-secret-here"
  }
}
```

**Alternative package names if the above does not work:**
- `@modelcontextprotocol/server-google-calendar`

### 5.2 First-run authentication

Same process — restart Claude Desktop, authorize when the browser pops up.

### 5.3 Test it

Open Cowork and type:

```
What events do I have on my calendar for the next 7 days?
```

**Expected result:** Claude should list your upcoming calendar events (or confirm the calendar is empty).

---

## MCP 6 — Firecrawl (Deep Web Scraping)

**What it does:** Lets Claude scrape full web pages, extract content, and crawl websites.
**API key needed:** Yes (free tier available)
**Difficulty:** Easy

### 6.1 Get a Firecrawl API key

1. Go to: https://www.firecrawl.dev/
2. Click **Get Started** or **Sign Up**
3. Create an account
4. Choose the **Free** plan (500 credits/month)
5. Go to your dashboard and find your **API Key**
6. Copy it

### 6.2 Set the API key as an environment variable (recommended)

1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Click **Advanced** tab, then **Environment Variables**
3. Under **User variables**, click **New**
4. Variable name: `FIRECRAWL_API_KEY`
5. Variable value: paste your API key
6. Click OK, OK, OK
7. **Restart your computer**

### 6.3 Add the Firecrawl MCP block

Open `%APPDATA%\Claude\claude_desktop_config.json` and add this block inside `"mcpServers"`:

```json
"firecrawl": {
  "command": "npx",
  "args": [
    "-y",
    "@anthropic/mcp-firecrawl"
  ],
  "env": {
    "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"
  }
}
```

Same note as Brave Search — if the environment variable substitution does not work, paste the key directly in the config.

**Alternative package names:**
- `@modelcontextprotocol/server-firecrawl`
- `firecrawl-mcp`

### 6.4 Save and restart Claude Desktop

### 6.5 Test it

Open Cowork and type:

```
Scrape the page at https://www.redbubble.com/shop/trending and tell me what the top trending categories are.
```

**Expected result:** Claude should extract and summarise real content from that page.

---

## Final Config File — Complete Example

After installing all 6 MCPs, your `claude_desktop_config.json` should look roughly like this:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-filesystem",
        "C:\\ai-workspace"
      ]
    },
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-brave-search"
      ],
      "env": {
        "BRAVE_API_KEY": "BSA_your_key_here"
      }
    },
    "google-drive": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-google-drive"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-secret"
      }
    },
    "gmail": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-gmail"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-secret"
      }
    },
    "google-calendar": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-google-calendar"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-secret"
      }
    },
    "firecrawl": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-firecrawl"
      ],
      "env": {
        "FIRECRAWL_API_KEY": "fc_your_key_here"
      }
    }
  }
}
```

**Replace all placeholder values with your real keys.** Do not leave `"your_key_here"` in the file.

---

## Troubleshooting

### "MCP not found" or "package not found" error
- The MCP package name may have changed. Check the official MCP server list at: https://github.com/modelcontextprotocol/servers
- Try the alternative package names listed under each MCP above

### Claude Desktop won't start after editing the config
- Your JSON has a syntax error. Open the config file and look for:
  - Missing or extra commas
  - Mismatched braces `{}`
  - Unclosed quotes
- Paste your config into https://jsonlint.com/ to find the exact error
- If you are stuck, delete the file contents, paste the "Final Config File" example above, and fill in your keys

### "Permission denied" or filesystem MCP can't read files
- Make sure the path uses double backslashes: `C:\\ai-workspace`
- Make sure the `C:\ai-workspace` folder actually exists
- Try running Claude Desktop as administrator (right-click, Run as administrator)

### Google OAuth browser window doesn't appear
- Check that you added your email as a test user in Step 3.1C
- Make sure you enabled the correct APIs in Step 3.1B
- Check Claude Desktop logs for error messages (Settings > Developer > Logs, or look in `%APPDATA%\Claude\logs\`)

### Brave Search or Firecrawl returns errors
- Verify your API key is correct — log in to the provider's dashboard and compare
- Check you haven't exceeded the free tier limits
- Try setting the key directly in the config instead of using environment variables

### MCP works in one session but not the next
- Some OAuth tokens expire. Try the test command again — it may prompt you to re-authorize
- If using environment variables, make sure you restarted the computer after setting them

---

## Post-Install Checklist

After completing all installations, run through this checklist in Cowork:

- [ ] **Filesystem:** "Read C:\ai-workspace\CLAUDE.md and tell me the first line"
- [ ] **Brave Search:** "Search the web for today's weather in Sydney"
- [ ] **Google Drive:** "List my 3 most recent Google Drive files"
- [ ] **Gmail:** "Show my 3 most recent email subject lines"
- [ ] **Google Calendar:** "What events do I have this week?"
- [ ] **Firecrawl:** "Scrape https://example.com and summarise the content"

Once all six pass, update the MCP Permissions section in `C:\ai-workspace\config\security.md` to record what is installed and what permissions each MCP has.

---

## Next Steps

After all MCPs are working:
1. Update `config/security.md` with the MCP permissions list
2. Run a full workflow test (see `config/workflow-tests.md`)
3. Proceed to Phase 2 Step 3: Agent Teams setup

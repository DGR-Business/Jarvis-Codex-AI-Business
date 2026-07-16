# Operator Setup Guide — Actions Required

These are the manual steps that only you (the human) can complete.
Jarvis has installed everything else automatically.

---

## 1. Holding Company BRIEF (15-30 minutes)

Open `C:\ai-workspace\holding-company\BRIEF.md` and fill in:
- Your business goals (what does success look like in 6 months? 1 year?)
- Budget constraints (how much can you invest monthly?)
- Risk tolerance (conservative, moderate, aggressive?)
- Time availability (hours per week you can spend on this?)
- Any specific interests or expertise you want to leverage

This is the most valuable 15-30 minutes you can spend — the business-advisor agent reads this for every strategic decision.

---

## 2. Create Etsy Seller Account (20 minutes)

1. Go to https://www.etsy.com/sell
2. Create a seller account (sign in or create new Etsy account)
3. Follow the setup wizard (shop name, listings, payment, billing)
4. This is Human-Only — the system cannot create accounts for you

---

## 3. Etsy API Security (5 minutes)

**PRIORITY — do this first if you haven't already.**

1. Go to: https://www.etsy.com/developers/your-apps
2. Find your app and click "Regenerate" next to Shared Secret
3. Copy the new Shared Secret
4. Set Windows environment variables:
   - Press Win+R, type `sysdm.cpl`, press Enter
   - Click "Advanced" tab → "Environment Variables"
   - Under "User variables", click "New":
     - Variable name: `ETSY_SHARED_SECRET`
     - Variable value: (paste your new shared secret)
   - Verify `ETSY_API_KEY` is also set (should already exist)
   - Click OK → OK → OK
5. Restart VS Code / Claude Code for the env vars to take effect

---

## 4. Google Workspace Setup (10-15 minutes)

**What was installed:** Google Workspace CLI (`gws` command)

**Steps:**
1. Open a terminal (cmd, PowerShell, or Git Bash)
2. Run: `gws auth setup`
3. This will:
   - Open your browser to Google Cloud Console
   - Guide you through creating a Cloud project (free)
   - Enable the required APIs (Drive, Gmail, Calendar, etc.)
   - Create OAuth credentials automatically
4. When prompted in the browser, sign in with your Google account
5. You may see "This app isn't verified" — click "Advanced" → "Go to [app name]"
6. Grant the requested permissions
7. Back in terminal, verify with: `gws auth status`

**What this enables:** Google Drive file delivery (review briefs accessible from any device), Gmail notifications, Calendar integration.

**Google Drive folder structure (created automatically after setup):**
```
AI Business/
├── Review Inbox/     ← items for your review
├── Approved/         ← approved items
├── Ventures/
│   └── POD Store/    ← venture outputs
├── Finance/          ← financial reports
└── Reports/          ← strategic briefs, research
```

---

## 5. EverBee Chrome Extension (2 minutes)

1. Go to Chrome Web Store
2. Search "EverBee" (Etsy analytics tool)
3. Install the free version
4. When you visit Etsy listings, you'll see revenue estimates, search volume, and competition data

---

## Status Tracker

| Item | Status | Notes |
|------|--------|-------|
| Holding Company BRIEF | Not filled in | Open and fill in the template |
| Etsy seller account | Not created | Go to etsy.com/sell |
| Etsy Shared Secret | Regenerate needed | Regenerate from Etsy developer dashboard |
| Etsy API key | Env var set | ETSY_API_KEY in Windows env vars |
| Etsy developer app | Pending approval | Waiting on Etsy — nothing to do yet |
| Google Workspace CLI | Installed | Run `gws auth setup` to authenticate |
| EverBee | Not installed | Chrome Web Store |

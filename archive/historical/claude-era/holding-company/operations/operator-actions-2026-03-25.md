# Operator Actions Required — 25 March 2026

5 actions that only you can complete. The system is ready to start making money once these are done.

---

## Action 1: Fill in Holding Company BRIEF (15-30 min)

**File:** `C:\ai-workspace\holding-company\BRIEF.md`

Fill in:
- Business goals (what does success look like in 6 months? 1 year?)
- Budget constraints (how much can you invest monthly?)
- Risk tolerance (conservative, moderate, aggressive?)
- Time availability (hours per week you can spend on this?)
- Any specific interests or expertise

**Why:** The business-advisor agent reads this for every strategic decision. Without it, all strategic advice is generic.

---

## Action 2: Create Etsy Seller Account (20 min)

1. Go to https://www.etsy.com/sell
2. Create a seller account
3. Follow the setup wizard (shop name, payment, billing)

**Why:** This is the #1 revenue blocker. The system has products ready to create but nowhere to list them.

---

## Action 3: Regenerate Etsy API Shared Secret (5 min)

1. Go to https://www.etsy.com/developers/your-apps
2. Click "Regenerate" next to Shared Secret
3. Set Windows environment variable:
   - Win+R → `sysdm.cpl` → Advanced → Environment Variables
   - New user variable: `ETSY_SHARED_SECRET` = (paste new secret)
   - Verify `ETSY_API_KEY` also exists
4. Restart VS Code

**Why:** Original secret was exposed in chat history. Security requirement.

---

## Action 4: Google Workspace Authentication (10-15 min)

1. Open VS Code terminal
2. Run: `gws auth setup`
3. Follow browser prompts to sign in with Google
4. Grant permissions when prompted
5. Verify: `gws auth status`

**Why:** Enables Google Drive delivery (review briefs on any device), Gmail notifications, and Calendar integration.

---

## Action 5: Install EverBee Chrome Extension (2 min)

1. Chrome Web Store → search "EverBee"
2. Install free version
3. Visit any Etsy listing to see analytics

**Why:** Shows revenue estimates, search volume, and competition data when browsing Etsy — essential for niche validation.

---

## What Happens After

Once you complete Actions 1 and 2, the system will:
1. Run the full venture launch pipeline on your first niche
2. Create POD designs via ChatGPT/Gemini
3. Write SEO-optimized Etsy listings
4. Compile everything into a PDF brief for your review
5. You approve → download designs → upload to Etsy
6. Scheduled tasks keep creating new products automatically

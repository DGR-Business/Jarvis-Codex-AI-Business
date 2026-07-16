# Delivery Routing

Rules for how finished output reaches the operator and external destinations.

---

## Standard Delivery Pipeline

Every piece of approved output follows these steps in order:

1. **Save canonical version** in the venture's `outputs/` folder
   - Filename: `TYPE-description-YYYY-MM-DD.ext`

2. **Compile PDF brief** and save to `for-review/`
   - Use the `pdf-brief` skill for consistent formatting
   - Pipeline outputs → single PDF per niche/task
   - Ad-hoc outputs → individual files with type prefix

3. **Upload to Google Drive** (when `Google Drive connector` is complete)
   - PDF briefs → `AI Business/Review Inbox/`
   - Financial reports → `AI Business/Finance/`
   - Design assets → `AI Business/Ventures/POD Store/Designs/`
   - Strategic reports → `AI Business/Reports/`

4. **Create Gmail draft notification** (Approve level — use `email-notify` skill)
   - Subject: `[AI-BOS] {Type}: {description}`
   - Body: branded HTML email with summary, key points, action required, and dashboard link
   - Uses `gmail_create_draft` with `contentType: text/html`
   - Note: attachments not supported by Gmail MCP tool — content is embedded in email body
   - Includes Google Drive link if `Google Drive connector` is configured
   - Create as draft for operator review before sending

5. **Dashboard shows preview** via Approval Inbox
   - Operator clicks item → preview modal opens
   - PDFs render in browser, images display inline

---

## Google Drive Folder Structure

```
AI Business/
├── Review Inbox/          ← mirrors for-review/ (pending items)
├── Approved/              ← mirrors for-review/approved/
├── Ventures/
│   └── POD Store/         ← venture-01 operator-facing outputs
│       ├── Designs/       ← design assets for download
│       └── Listings/      ← draft listing text
├── Finance/               ← financial reports, P&L, unit economics
└── Reports/               ← strategic pulses, health checks, research
```

Use natural, human-readable names. Only operator-facing files go to Drive.

---

## Google Drive Sync Rules

### Session-Start Sync (Automatic)
At every session start:
1. Search Drive `AI Business/Review Inbox/` — compare with local `for-review/`
2. Search Drive `AI Business/Approved/` — if operator moved a file there, treat as local approval
3. If operator deleted a file from `Review Inbox/` → mark as dismissed locally
4. Upload any new local `for-review/` items not yet on Drive to `Review Inbox/`
5. Log all sync actions to `logs/external-actions.log`

### File Format Rules
- **PDF briefs/packages** → upload as PDF (no conversion)
- **Listing copy, research, text content** → upload as Google Docs (editable in Drive)
- **Spreadsheets** → upload as Google Sheets
- **Design assets** → upload as-is (PNG, JPG)

### Operator Approval via Drive
The operator can approve/deny from anywhere by moving files between Drive folders:
- Move to `Approved/` → system treats as approved at next session
- Delete from `Review Inbox/` → system marks as dismissed
- No other action needed — the system syncs automatically at session start

---

## Approval Workflow

1. System saves deliverable to `for-review/`
2. System uploads to Google Drive `Review Inbox/` (if authenticated)
3. System creates Gmail draft notification (Approve level — use `email-notify` skill)
4. Operator reviews via: dashboard preview, Google Drive, or local folder
5. Operator takes action via:
   - **Dashboard:** click item → preview modal → Approve / Deny / Send Back buttons
   - **Local folder:** move file to `for-review/approved/`
   - **Google Drive:** move to `Approved/` folder
6. At next session start, Jarvis processes approvals and send-backs (Standing Instruction #9)

---

## Type Prefixes

| Prefix | Use For |
|--------|---------|
| NICHE-BRIEF- | Compiled niche launch pipeline output |
| STRATEGIC-BRIEF- | Business advisor strategic analysis |
| STRATEGIC-PULSE- | Daily strategic pulse |
| NICHE-ANALYSIS- | Combined niche research/validation |
| DESIGN-MANIFEST- | Designer output package |
| FINANCIAL-MODEL- | Analyst XLSX outputs |
| SYSTEM-HEALTH- | Weekly health check reports |
| OPERATOR-ACTION- | Action lists requiring human steps |
| VIDEO-SCRIPT- | Video scripts, storyboards |
| PRODUCT-LISTING- | Product titles, descriptions, bullet points |
| EMAIL- | Email drafts, campaigns |
| EMAIL-DRAFT- | Email drafts for approval |
| SOCIAL-POST- | Social media content |
| BLOG- | Blog posts, articles |
| REPORT- | Reports, analyses, summaries |
| AD-COPY- | Advertising copy |
| TEMPLATE- | Reusable templates |
| WEEKLY-REPORT- | Scheduled weekly reports |

---

## Ad-Hoc Items (Non-Pipeline)

For non-pipeline outputs (audit reports, ad-hoc reviews, idea reviews):

1. Save summary reference to `for-review/` with type prefix (same folder as pipeline outputs)
2. Include a note referencing the canonical file path in the venture's `outputs/`
3. Update `for-review/review-status.json` with a new entry

### Review Status Values
- `pending` — awaiting operator review
- `approved` — operator approved, ready to publish/send
- `rejected` — operator rejected (moved to `for-review/denied/`)
- `revision-needed` — sent back for improvement (moved to `for-review/revision-needed/`)
- `dismissed` — operator saw it, moved on without action
- `expired` — auto-dismissed after configurable period (non-critical items only)
- `published` — published/sent to final destination

### Folder Structure
```
for-review/
  *.pdf, *.md         (pending items — root level)
  approved/            (operator-approved items)
  denied/              (operator-rejected items)
  revision-needed/     (sent back for improvement, may include .note.md files)
  review-status.json   (metadata tracking for all items)
```

# Skill: Drive Sync

Bidirectional sync between local `for-review/` and Google Drive `AI Business/` folders.

## When to Use
- Session start (Standing Instruction #9)
- After saving new output to `for-review/`
- When operator requests a Drive sync

## Sync Procedure

### 1. Check Drive for Approvals
```
google_drive_search: query "in:AI Business/Approved"
```
For each file found in Approved/ that is still "pending" in local review-status.json:
- Update review-status.json status to "approved"
- Move local copy from `for-review/` to `for-review/approved/`
- Log: `TIMESTAMP | NOTIFY | DRIVE-SYNC | Approval synced: [filename] | [venture]`

### 2. Check Drive for New Files
```
google_drive_search: query "in:AI Business/Review Inbox"
```
Compare with local `for-review/`. Note any files added externally (rare but possible).

### 3. Upload New Local Items to Drive
For each file in `for-review/` with status "pending" in review-status.json that is NOT yet on Drive:

**PDF files:**
```
Upload as-is to AI Business/Review Inbox/
```

**Markdown files (.md) — listings, copy, research:**
```
Convert content to clean text, upload as Google Doc to appropriate folder:
- Listings/copy → AI Business/Ventures/POD Store/Listings/
- Research → AI Business/Reports/
- Everything else → AI Business/Review Inbox/
```

**Spreadsheets (.xlsx):**
```
Upload to AI Business/Finance/ or AI Business/Review Inbox/
```

### 4. Log All Actions
Append each sync action to `logs/external-actions.log`:
```
TIMESTAMP | NOTIFY | DRIVE-SYNC | [action description] | [venture] | Auto
```

## File Format Rules
| Local Format | Drive Format | Drive Folder |
|-------------|-------------|--------------|
| .pdf | PDF | Review Inbox/ |
| .md (listing copy) | Google Doc | Ventures/POD Store/Listings/ |
| .md (research) | Google Doc | Reports/ |
| .md (brief) | PDF (compile first) | Review Inbox/ |
| .xlsx | Google Sheet | Finance/ |
| .png/.jpg | Image | Ventures/POD Store/Designs/ |

## Notes
- Drive connector tools: `google_drive_search`, `google_drive_fetch`
- Upload capability depends on Drive connector supporting writes — if not, log as SKIPPED and note in session summary
- Never delete files from Drive — only the operator does that
- This is a Notify-level action (do it, then tell operator)

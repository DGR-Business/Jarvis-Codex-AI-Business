---
name: email-notify
description: Create branded HTML email draft notifications for operator review items. Use after saving a deliverable to for-review/ to notify the operator via Gmail draft with an inline content summary, key points, and dashboard link.
type: notification
---

# Email Notify — Gmail Draft Notification

Create professional, branded HTML email drafts to notify the operator when new items are ready for review. Since the Gmail MCP tool does not support attachments, all content is embedded directly in a rich HTML email body.

## When to Use

- After saving a pipeline or ad-hoc deliverable to `for-review/`
- Optionally after uploading the item to Google Drive (`AI Business/Review Inbox/`)
- As step 4 of the Standard Delivery Pipeline (see `config/delivery.md`)

## When to Skip

Do NOT create email notifications for:
- Internal system files (session logs, current-state.md, task lists)
- File organisation changes
- Plans, research summaries, or drafts not yet in `for-review/`
- Any file that is exempt from quality review per CLAUDE.md

Only deliverables that are saved to `for-review/` should trigger this skill.

## Autonomy Level

**Approve** — Always propose the draft to the operator and wait for explicit confirmation before calling `gmail_create_draft`. Log the action to `logs/external-actions.log` regardless of outcome.

## Email Subject Format

```
[AI-BOS] {Type}: {Description}
```

### Type Mappings (from delivery.md type prefixes)

| File Prefix | Email Type Label |
|-------------|-----------------|
| STRATEGIC-PULSE- | Strategic Pulse |
| SYSTEM-HEALTH- | System Health |
| NICHE-BRIEF- | Niche Brief |
| NICHE-ANALYSIS- | Niche Analysis |
| OPERATOR-ACTION- | Action Required |
| FINANCIAL-MODEL- | Financial Report |
| DESIGN-MANIFEST- | Design Package |
| REPORT- | Report |
| WEEKLY-REPORT- | Weekly Report |
| STRATEGIC-BRIEF- | Strategic Brief |
| VIDEO-SCRIPT- | Video Script |
| PRODUCT-LISTING- | Product Listing |
| EMAIL- | Email Draft |
| EMAIL-DRAFT- | Email Draft |
| SOCIAL-POST- | Social Post |
| BLOG- | Blog Post |
| AD-COPY- | Ad Copy |
| TEMPLATE- | Template |

If the prefix is not in this table, use the prefix itself with title casing (e.g., `CUSTOM-THING-` becomes "Custom Thing").

## HTML Email Template

Use inline CSS only. Gmail strips `<style>` tags, `<link>` stylesheets, and most CSS selectors. Every style must be applied directly on the element.

### Template (copy and fill placeholders)

```html
<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <!-- Header -->
  <div style="background:#1a1a2e;padding:20px 24px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;font-size:16px;color:#ffffff;font-weight:600;">AI Business OS</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#00d2ff;">{reportType}</p>
  </div>

  <!-- Body -->
  <div style="padding:24px;background:#f8f9fa;border-left:1px solid #e9ecef;border-right:1px solid #e9ecef;">
    <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">{title}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#495057;line-height:1.5;">{executiveSummary}</p>

    <!-- Key Points -->
    <div style="background:#ffffff;border:1px solid #e9ecef;border-radius:8px;padding:16px;margin:0 0 16px;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#1a1a2e;">Key Points</h3>
      <ul style="margin:0;padding-left:20px;color:#495057;font-size:14px;line-height:1.6;">
        <li>{point1}</li>
        <li>{point2}</li>
        <li>{point3}</li>
      </ul>
    </div>

    <!-- Action Required (optional — remove this block if no action needed) -->
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin:0 0 16px;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#856404;">Action Required</h3>
      <p style="margin:0;font-size:14px;color:#856404;">{actionRequired}</p>
    </div>
  </div>

  <!-- CTA -->
  <div style="padding:20px 24px;background:#f8f9fa;text-align:center;border-left:1px solid #e9ecef;border-right:1px solid #e9ecef;">
    <a href="http://localhost:5050" style="display:inline-block;background:#00d2ff;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View in Dashboard</a>
  </div>

  <!-- Footer -->
  <div style="padding:16px 24px;background:#f1f3f5;border-radius:0 0 12px 12px;border:1px solid #e9ecef;border-top:0;">
    <p style="margin:0;font-size:12px;color:#868e96;">
      File: for-review/{filename}<br>
      Generated: {timestamp}<br>
      {driveLink}
    </p>
  </div>
</div>
```

### Placeholder Reference

| Placeholder | Source | Example |
|-------------|--------|---------|
| `{reportType}` | Type mapping table above | "Strategic Pulse" |
| `{title}` | Descriptive title of the deliverable | "Daily Strategic Pulse — 2026-03-26" |
| `{executiveSummary}` | 2-3 sentence summary of the deliverable content | "Today's pulse covers venture pipeline progress..." |
| `{point1}`, `{point2}`, `{point3}` | Key findings or highlights (add/remove `<li>` as needed) | "POD Store niche validation complete" |
| `{actionRequired}` | What the operator needs to do (omit the Action Required block entirely if none) | "Review and approve the niche brief to proceed to Stage 1" |
| `{filename}` | Filename in `for-review/` | "STRATEGIC-PULSE-2026-03-26.pdf" |
| `{timestamp}` | ISO timestamp when generated | "2026-03-26T09:00:00+11:00" |
| `{driveLink}` | Google Drive link if uploaded, otherwise empty string | "Drive: https://drive.google.com/file/d/..." |

### Dynamic Content Rules

- **Key Points:** Include 2-5 bullet points. Add or remove `<li>` elements as needed. Do not leave placeholder text.
- **Action Required block:** Include only when the operator needs to take a specific action. Remove the entire yellow block (from the `<!-- Action Required -->` comment through the closing `</div>`) if no action is required.
- **Drive Link:** If the file was not uploaded to Drive, set `{driveLink}` to an empty string (the `<br>` before it will remain but is harmless).
- **Executive Summary:** Keep to 2-3 sentences. Pull from the deliverable's own summary section or generate a concise summary from the content.

## Workflow Steps

### Step 1: Prepare Content

Extract from the deliverable (PDF brief, report, or other output):
- The file type prefix (to determine `{reportType}` and subject line type)
- A descriptive title
- An executive summary (2-3 sentences)
- 2-5 key points or findings
- Whether operator action is required, and what specifically

### Step 2: Determine Recipient

Get the operator's email address from one of these sources (in priority order):
1. `gmail_get_profile` MCP tool (returns the authenticated user's email)
2. The venture's `BRIEF.md` if it contains an operator email
3. Ask the operator if neither source is available

### Step 3: Fill Template

Replace all placeholders in the HTML template. Ensure:
- No placeholder text like `{point1}` remains in the final HTML
- The Action Required block is removed entirely if not needed
- The Drive link line is empty if no Drive upload occurred
- All text content is HTML-escaped (especially `<`, `>`, `&` in content)

### Step 4: Propose Draft to Operator (Approve Level)

Present the proposed email to the operator for approval:

```
APPROVE REQUEST: Create Gmail draft notification

To: {operator_email}
Subject: [AI-BOS] {Type}: {Description}
Content: HTML email with summary of {deliverable_name}

Key points included:
- {point1}
- {point2}
- {point3}

Action required: {yes/no — brief description if yes}

Create this draft?
```

Wait for explicit "yes" before proceeding.

### Step 5: Create Draft

Call the Gmail MCP tool:

```
gmail_create_draft(
  to: "{operator_email}",
  subject: "[AI-BOS] {Type}: {Description}",
  body: "<filled HTML template>",
  contentType: "text/html"
)
```

### Step 6: Log the Action

Append to `logs/external-actions.log`:

```
{TIMESTAMP} | APPROVE | EMAIL-DRAFT | Gmail draft created: [AI-BOS] {Type}: {Description} | {venture_name} | Approved: YES
```

If the operator declines:

```
{TIMESTAMP} | APPROVE | EMAIL-DRAFT | Gmail draft declined: [AI-BOS] {Type}: {Description} | {venture_name} | Approved: NO
```

## Gmail HTML Compatibility Notes

Gmail has strict HTML/CSS rendering rules. Follow these to ensure the email displays correctly:

- **Inline styles only** — Gmail strips `<style>` tags, `<link>` elements, and all CSS classes/IDs
- **No CSS grid or flexbox** — Gmail has poor support for modern layout; use `<table>` for complex layouts if needed
- **No background images** — Use solid `background-color` only
- **Images** — Use `<img>` tags with full absolute URLs; base64 `data:` URIs are stripped by Gmail
- **No media queries** — Responsive design via media queries does not work in Gmail; the 600px max-width container handles most cases
- **Safe HTML elements** — `<div>`, `<table>`, `<tr>`, `<td>`, `<p>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<img>`, `<span>`, `<br>`
- **Avoid** — `<section>`, `<article>`, `<header>`, `<footer>`, `<main>`, `<nav>` (semantic elements may be stripped)
- **Font stacks** — Always provide fallback fonts; custom web fonts do not load in Gmail

### Plain Text Fallback

If for any reason the HTML draft cannot be created, fall back to a plain text email:

```
[AI-BOS] {Type}: {Description}

{executiveSummary}

Key Points:
- {point1}
- {point2}
- {point3}

Action Required: {actionRequired or "None"}

File: for-review/{filename}
Dashboard: http://localhost:5050
{driveLink}
```

Use `contentType: "text/plain"` for the plain text fallback.

## Quality Checklist

Before proposing the draft:
- [ ] Subject line follows `[AI-BOS] {Type}: {Description}` format
- [ ] Report type matches the file prefix mapping
- [ ] Executive summary is concise (2-3 sentences, no AI filler language)
- [ ] Key points are specific and actionable, not generic
- [ ] Action Required block is present only when action is truly needed
- [ ] No placeholder text remains in the HTML
- [ ] Filename in footer matches the actual file in `for-review/`
- [ ] Timestamp is in the operator's timezone (AEST/AEDT, UTC+10/+11)
- [ ] Drive link is included if the file was uploaded, omitted if not

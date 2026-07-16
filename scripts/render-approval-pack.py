import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def clean(value):
    return str(value or "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def para(text, style):
    return Paragraph(clean(text).replace("\n", "<br/>"), style)


def short(value, limit=260):
    text = " ".join(clean(value).split())
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def display_label(value):
    text = clean(value)
    if not text:
        return "-"
    labels = {
        "approval_requested": "Approval requested",
        "approved": "Approved",
        "blocked": "Blocked",
        "blocked_for_approval": "Waiting for your approval",
        "blocked_for_credentials": "Waiting for setup",
        "cancelled": "Cancelled",
        "completed": "Completed",
        "completed_live": "Completed with live evidence",
        "continue": "Continue",
        "draft": "Draft",
        "dry_run_complete": "Practice run complete",
        "dry_run_only": "Practice mode only",
        "failed": "Needs attention",
        "kill_or_rework": "Stop or rework",
        "low_until_live_evidence": "Low until live evidence",
        "medium": "Medium",
        "medium_with_live_research": "Medium with live research",
        "needs_credentials": "Needs setup",
        "needs_live_research": "Needs live research",
        "pending": "Pending",
        "planned": "Planned",
        "ready_for_review": "Ready for review",
        "research_required": "More research needed",
        "revise": "Revise",
        "running": "In progress",
        "skipped": "Skipped",
    }
    key = text.strip().lower()
    if key in labels:
        return labels[key]
    return text.replace("_", " ").replace(".", " ").strip().capitalize()


def display_sentence(value):
    text = clean(value).strip()
    if not text:
        return "-"
    labels = {
        "ready for digital-product approval review": "Ready for digital product review",
        "ready for live-publish approval design": "Ready for live publishing review",
    }
    key = text.lower()
    if key in labels:
        return labels[key]
    cleaned = text.replace("_", " ").replace("digital-product", "digital product").replace("live-publish", "live publishing")
    return cleaned[:1].upper() + cleaned[1:]


def display_model_policy(value):
    labels = {
        "local_only": "Local tools only",
        "no_paid_model": "No paid model",
        "paid_model_allowed": "Paid model allowed after approval",
    }
    return labels.get(clean(value).strip().lower(), display_label(value))


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#6B7280"))
    canvas.drawString(18 * mm, 12 * mm, "Jarvis-Codex approval pack")
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            textColor=colors.HexColor("#17211F"),
            spaceAfter=10,
            alignment=TA_LEFT,
        ),
        "h1": ParagraphStyle(
            "Heading1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            textColor=colors.HexColor("#17211F"),
            spaceBefore=12,
            spaceAfter=7,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#2457D6"),
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.3,
            leading=13,
            textColor=colors.HexColor("#273330"),
            spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#62706B"),
            spaceAfter=4,
        ),
        "badge": ParagraphStyle(
            "Badge",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#1D7A4C"),
        ),
    }


def key_table(rows, styles):
    data = [[para(label, styles["small"]), para(value, styles["body"])] for label, value in rows]
    table = Table(data, colWidths=[34 * mm, 118 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F5F7F6")),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9DFDC")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D9DFDC")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def simple_table(headers, rows, styles, widths):
    data = [[para(header, styles["small"]) for header in headers]]
    data.extend([[para(cell, styles["body"]) for cell in row] for row in rows])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF0FF")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#123FA4")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#C5CFCA")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D9DFDC")),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def build_pdf(payload, output_path):
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=clean(payload["humanName"]),
        author="Jarvis-Codex",
    )

    workflow = payload.get("workflow", {})
    command = payload.get("command", {})
    tasks = payload.get("tasks", [])
    deliverables = payload.get("deliverables", [])
    scorecard = payload.get("scorecard") or {}

    story = []
    story.append(para(payload["humanName"], styles["title"]))
    story.append(para("Operator approval pack", styles["badge"]))
    story.append(Spacer(1, 6))
    story.append(
        key_table(
            [
                ("Workflow", workflow.get("title", "-")),
                ("Status", display_label(workflow.get("status", "-"))),
                ("Current step", display_sentence(workflow.get("current_step", "-"))),
                ("Generated", payload.get("generatedAt", "-")),
                ("Mode", "Practice-mode proof. The report generator did not contact outside services or use paid AI or tool calls."),
            ],
            styles,
        )
    )
    story.append(Spacer(1, 10))
    story.append(para("Decision Needed", styles["h1"]))
    story.append(
        para(
            "Review the attached evidence and choose one of: approve next safe step, request changes, or stop this workflow. "
            "This pack is process proof until live research, real pricing, and approved paid model/tool execution are connected.",
            styles["body"],
        )
    )
    story.append(para("Original Instruction", styles["h1"]))
    story.append(para(command.get("raw_text") or workflow.get("metadata", {}).get("originalInstruction") or "-", styles["body"]))

    if scorecard:
        story.append(para("Commercial Scorecard", styles["h1"]))
        story.append(
            key_table(
                [
                    ("Verdict", display_label(scorecard.get("verdict", "-"))),
                    ("Score", f"{scorecard.get('total_score', '-')} / 100"),
                    ("Confidence", display_label(scorecard.get("confidence", "-"))),
                    ("Recommendation", scorecard.get("recommendation", "-")),
                ],
                styles,
            )
        )
        dimensions = scorecard.get("dimensions") or {}
        dimension_rows = []
        for key, item in dimensions.items():
            label = item.get("label") or key.replace("_", " ").title()
            dimension_rows.append([label, f"{item.get('score', '-')} / 100", short(item.get("note", "-"), 180)])
        if dimension_rows:
            story.append(Spacer(1, 6))
            story.append(simple_table(["Dimension", "Score", "Note"], dimension_rows, styles, [38 * mm, 24 * mm, 104 * mm]))
        risks = scorecard.get("risks") or []
        next_actions = scorecard.get("next_actions") or []
        if risks:
            story.append(para("Main Risks", styles["h2"]))
            story.append(para("<br/>".join(f"- {clean(item)}" for item in risks), styles["body"]))
        if next_actions:
            story.append(para("Next Actions", styles["h2"]))
            story.append(para("<br/>".join(f"- {clean(item)}" for item in next_actions), styles["body"]))

    story.append(PageBreak())
    story.append(para("Workflow Evidence", styles["h1"]))
    task_rows = []
    for task in tasks:
        result = task.get("result") or {}
        output = result.get("output") or {}
        model = (result.get("modelPolicy") or {}).get("class", "-")
        task_rows.append(
            [
                task.get("title", "-"),
                task.get("agent", "-"),
                display_label(task.get("status", "-")),
                display_model_policy(model),
                short(output.get("summary") or task.get("error") or "No output recorded."),
            ]
        )
    story.append(simple_table(["Task", "Agent", "Status", "Model policy", "Output"], task_rows, styles, [34 * mm, 22 * mm, 20 * mm, 28 * mm, 62 * mm]))

    story.append(para("Deliverables", styles["h1"]))
    deliverable_rows = [
        [
            item.get("human_name", "-"),
            display_label(item.get("status", "-")),
            clean(item.get("format", "-")).replace("_", " "),
            item.get("file_path", "-"),
        ]
        for item in deliverables
        if item.get("id") != payload.get("approvalPackId")
    ]
    story.append(simple_table(["Name", "Status", "Format", "Path"], deliverable_rows, styles, [58 * mm, 24 * mm, 28 * mm, 56 * mm]))

    story.append(PageBreak())
    story.append(para("Review Notes", styles["h1"]))
    for item in deliverables:
        if item.get("id") == payload.get("approvalPackId"):
            continue
        story.append(
            KeepTogether(
                [
                    para(item.get("human_name", "-"), styles["h2"]),
                    para(item.get("summary", "No summary recorded."), styles["body"]),
                    para(f"Source: {item.get('file_path', 'No file path recorded.')}", styles["small"]),
                    para(short(item.get("excerpt", ""), 900) or "No source excerpt available.", styles["body"]),
                    Spacer(1, 5),
                ]
            )
        )

    story.append(para("Approval Options", styles["h1"]))
    story.append(
        key_table(
            [
                ("Approve", "Move to the next approved safe step."),
                ("Request changes", "Return to the relevant agent/task with specific feedback."),
                ("Stop", "Cancel or park the workflow if evidence is weak or risk is too high."),
            ],
            styles,
        )
    )

    doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-approval-pack.py payload.json output.pdf")
    payload_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with payload_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    build_pdf(payload, output_path)


if __name__ == "__main__":
    main()

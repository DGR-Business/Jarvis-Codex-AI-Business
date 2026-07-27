import json
import sys
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    CondPageBreak,
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#14201E")
NAVY = colors.HexColor("#132B3A")
NAVY_2 = colors.HexColor("#1C3A4D")
GREEN = colors.HexColor("#1F9D72")
GREEN_SOFT = colors.HexColor("#E6F5EF")
BLUE = colors.HexColor("#2E6BFF")
BLUE_SOFT = colors.HexColor("#EAF0FF")
AMBER = colors.HexColor("#D99423")
AMBER_SOFT = colors.HexColor("#FFF4DF")
RED = colors.HexColor("#C94F56")
RED_SOFT = colors.HexColor("#FDEBED")
PAPER = colors.HexColor("#F6F8F8")
LINE = colors.HexColor("#D8E0DE")
MUTED = colors.HexColor("#66736F")
WHITE = colors.white


def clean(value):
    return str(value or "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def safe_text(value):
    return escape(clean(value))


def para(text, style):
    return Paragraph(safe_text(text).replace("\n", "<br/>"), style)


def short(value, limit=360):
    text = " ".join(clean(value).split())
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def display_label(value):
    text = clean(value).strip()
    labels = {
        "approve": "Approve",
        "approved": "Approved",
        "blocked": "Needs attention",
        "cancelled": "Stopped",
        "completed": "Completed",
        "continue": "Continue",
        "deny": "Stop",
        "failed": "Needs attention",
        "high": "High",
        "kill_or_rework": "Stop or rework",
        "low": "Low",
        "low_until_live_evidence": "Low",
        "medium": "Medium",
        "medium_with_live_research": "Medium",
        "needs_attention": "Needs attention",
        "needs_changes": "Changes requested",
        "needs_evidence": "More evidence needed",
        "pending": "Pending",
        "planned": "Planned",
        "process_ready_commercial_evidence_pending": "Commercial evidence pending",
        "ready_for_review": "Ready for review",
        "research_required": "More evidence needed",
        "revise": "Revise",
        "running": "In progress",
    }
    if not text:
        return "Not stated"
    return labels.get(text.lower(), text.replace("_", " ").replace(".", " ").strip().capitalize())


def status_colors(value):
    key = clean(value).lower()
    if key in {"approve", "approved", "completed", "continue", "ready_for_review"}:
        return GREEN, GREEN_SOFT
    if key in {"deny", "failed", "cancelled", "kill_or_rework", "needs_attention"}:
        return RED, RED_SOFT
    if key in {"revise", "needs_changes", "needs_evidence", "research_required", "pending", "blocked"}:
        return AMBER, AMBER_SOFT
    return BLUE, BLUE_SOFT


def money(cents, currency="AUD"):
    labels = {"AUD": "A$", "USD": "US$", "NZD": "NZ$", "CAD": "CA$"}
    prefix = labels.get(clean(currency).upper(), f"{clean(currency).upper()} ")
    return f"{prefix}{max(0, int(cents or 0)) / 100:,.2f}"


def friendly_date(value):
    text = clean(value)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y, %H:%M")
    except ValueError:
        return text or "Not recorded"


def build_styles():
    base = getSampleStyleSheet()
    return {
        "brand": ParagraphStyle("Brand", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.HexColor("#A9C2CE"), spaceAfter=0),
        "cover_title": ParagraphStyle("CoverTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=WHITE, alignment=TA_LEFT, spaceAfter=5),
        "cover_sub": ParagraphStyle("CoverSub", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=colors.HexColor("#D7E4E9"), spaceAfter=0),
        "eyebrow": ParagraphStyle("Eyebrow", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=GREEN, spaceBefore=0, spaceAfter=4),
        "decision": ParagraphStyle("Decision", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceAfter=8),
        "recommendation": ParagraphStyle("Recommendation", parent=base["BodyText"], fontName="Helvetica", fontSize=10, leading=15, textColor=INK, spaceAfter=7),
        "question": ParagraphStyle("Question", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=NAVY, spaceAfter=0),
        "h1": ParagraphStyle("H1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=INK, spaceBefore=2, spaceAfter=9),
        "h2": ParagraphStyle("H2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=NAVY, spaceBefore=0, spaceAfter=4),
        "body": ParagraphStyle("Body", parent=base["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=INK, spaceAfter=4),
        "body_muted": ParagraphStyle("BodyMuted", parent=base["BodyText"], fontName="Helvetica", fontSize=8.3, leading=12, textColor=MUTED, spaceAfter=3),
        "small": ParagraphStyle("Small", parent=base["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED, spaceAfter=0),
        "metric_label": ParagraphStyle("MetricLabel", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=MUTED, alignment=TA_LEFT),
        "metric_value": ParagraphStyle("MetricValue", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK, alignment=TA_LEFT),
        "cell_label": ParagraphStyle("CellLabel", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.2, leading=9, textColor=BLUE, spaceAfter=3),
        "cell_value": ParagraphStyle("CellValue", parent=base["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=INK),
        "action": ParagraphStyle("Action", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=INK, alignment=TA_LEFT),
        "action_note": ParagraphStyle("ActionNote", parent=base["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_LEFT),
        "footer": ParagraphStyle("Footer", parent=base["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9, textColor=MUTED),
    }


class ScoreBar(Flowable):
    def __init__(self, label, score, note, width, styles):
        super().__init__()
        self.label = short(label, 70)
        self.score = max(0, min(100, int(score or 0)))
        self.note = short(note, 170)
        self.width = width
        self.height = 17 * mm
        self.styles = styles

    def draw(self):
        canvas = self.canv
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(INK)
        canvas.drawString(0, self.height - 10, self.label)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(NAVY)
        canvas.drawRightString(self.width, self.height - 10, f"{self.score}/100")
        bar_y = self.height - 18
        canvas.setFillColor(colors.HexColor("#E7ECEB"))
        canvas.roundRect(0, bar_y, self.width, 4, 2, stroke=0, fill=1)
        accent = GREEN if self.score >= 65 else AMBER if self.score >= 40 else RED
        canvas.setFillColor(accent)
        canvas.roundRect(0, bar_y, self.width * self.score / 100, 4, 2, stroke=0, fill=1)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(0, 2, self.note)


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(17 * mm, 14 * mm, A4[0] - 17 * mm, 14 * mm)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(NAVY)
    canvas.drawString(17 * mm, 9 * mm, "PANTHEON  /  DECISION BRIEF")
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(A4[0] - 17 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def section_title(title, styles, kicker=None):
    rows = []
    if kicker:
        rows.append([para(kicker.upper(), styles["eyebrow"])])
    rows.append([para(title, styles["h1"])])
    return Table(rows, colWidths=[176 * mm], style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))


def cover_header(payload, styles):
    header = payload.get("header", {})
    accent, soft = status_colors(header.get("status"))
    status = display_label(header.get("status"))
    top = Table(
        [[para("PANTHEON  /  OPERATOR DECISION BRIEF", styles["brand"]), para(status.upper(), ParagraphStyle("CoverStatus", parent=styles["brand"], textColor=accent, alignment=TA_RIGHT))]],
        colWidths=[128 * mm, 38 * mm],
    )
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    title = para(payload.get("humanName", "Decision Brief"), styles["cover_title"])
    meta = para(f"Prepared by {header.get('preparedBy', 'Pantheon AI Team')}  |  {friendly_date(payload.get('generatedAt'))}", styles["cover_sub"])
    band = Table([[top], [Spacer(1, 7)], [title], [meta]], colWidths=[176 * mm])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 9 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 7 * mm),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 7 * mm),
    ]))
    return band


def decision_panel(payload, styles):
    decision = payload.get("decision", {})
    accent, soft = status_colors(decision.get("verdict"))
    rows = [
        [para("THE NEXT MONEY MOVE", styles["eyebrow"])],
        [para(decision.get("headline", "Review the next step."), styles["decision"])],
        [para(decision.get("recommendation", ""), styles["recommendation"])],
        [para(decision.get("approvalQuestion", "Choose whether to continue, revise, or stop."), styles["question"])],
    ]
    table = Table(rows, colWidths=[176 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), soft),
        ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 8 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8 * mm),
        ("TOPPADDING", (0, 0), (-1, 0), 6 * mm),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 6 * mm),
    ]))
    return table


def metric_strip(payload, styles):
    decision = payload.get("decision", {})
    score = payload.get("score") or {}
    economics = payload.get("economics", {})
    estimated = int(economics.get("estimatedCostCents") or 0)
    reconciled = int(economics.get("reconciledCostCents") or 0)
    cost_value = money(reconciled, economics.get("currency", "AUD")) if reconciled else (f"Up to {money(estimated, economics.get('currency', 'AUD'))}" if estimated else "No new spend")
    values = [
        ("RECOMMENDATION", display_label(decision.get("verdict"))),
        ("CONFIDENCE", display_label(decision.get("confidence"))),
        ("COMMERCIAL SCORE", f"{int(score.get('total') or 0)}/100" if score else "Not scored"),
        ("COST POSITION", cost_value),
    ]
    cells = [[para(label, styles["metric_label"]), para(value, styles["metric_value"])] for label, value in values]
    table = Table([cells], colWidths=[44 * mm] * 4)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PAPER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEAFTER", (0, 0), (-2, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return table


def commercial_snapshot(payload, styles):
    case = payload.get("commercialCase", {})
    values = [
        ("BUYER", case.get("buyer")),
        ("PROBLEM", case.get("problem")),
        ("OFFER", case.get("offer")),
        ("FIRST CHANNEL", case.get("channel")),
    ]
    cells = [[para(label, styles["cell_label"]), para(short(value, 260), styles["cell_value"])] for label, value in values]
    table = Table([[cells[0], cells[1]], [cells[2], cells[3]]], colWidths=[88 * mm, 88 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
    ]))
    return table


def bullet_rows(values, styles, accent=BLUE, empty="Nothing recorded."):
    content = values or [empty]
    rows = []
    for value in content:
        rows.append(["", para(short(value, 420), styles["body"])])
    table = Table(rows, colWidths=[3 * mm, 78 * mm])
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5 * mm),
    ]
    for index in range(len(rows)):
        commands.append(("BACKGROUND", (0, index), (0, index), accent))
    table.setStyle(TableStyle(commands))
    return table


def evidence_columns(payload, styles):
    evidence = payload.get("evidence", {})
    for_box = [para("EVIDENCE FOR", styles["cell_label"]), bullet_rows(evidence.get("for"), styles, GREEN)]
    against_box = [para("EVIDENCE AGAINST / MISSING", ParagraphStyle("Against", parent=styles["cell_label"], textColor=AMBER)), bullet_rows(evidence.get("against"), styles, AMBER)]
    table = Table([[for_box, against_box]], colWidths=[88 * mm, 88 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEAFTER", (0, 0), (0, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
    ]))
    return table


def test_plan(payload, styles):
    case = payload.get("commercialCase", {})
    rows = [
        ("HYPOTHESIS", case.get("priceChannelHypothesis")),
        ("SMALLEST USEFUL TEST", case.get("smallestTest")),
        ("SUCCESS LOOKS LIKE", case.get("successMetric")),
        ("STOP OR REVISE WHEN", case.get("stopRule")),
    ]
    data = [[para(label, styles["cell_label"]), para(value, styles["body"])] for label, value in rows]
    table = Table(data, colWidths=[40 * mm, 136 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), BLUE_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return table


def risk_block(payload, styles):
    evidence = payload.get("evidence", {})
    risks = evidence.get("risks") or []
    assumptions = evidence.get("assumptions") or []
    data = [
        [para("RISKS TO CONTROL", ParagraphStyle("RiskLabel", parent=styles["cell_label"], textColor=RED)), bullet_rows(risks, styles, RED)],
        [para("ASSUMPTIONS TO VERIFY", ParagraphStyle("AssumptionLabel", parent=styles["cell_label"], textColor=AMBER)), bullet_rows(assumptions, styles, AMBER, "No separate assumptions were recorded.")],
    ]
    table = Table(data, colWidths=[40 * mm, 136 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.4, LINE),
        ("BACKGROUND", (0, 0), (0, 0), RED_SOFT),
        ("BACKGROUND", (0, 1), (0, 1), AMBER_SOFT),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return table


def team_work(payload, styles):
    rows = []
    for item in payload.get("work", []):
        accent, soft = status_colors(item.get("status"))
        status_style = ParagraphStyle("WorkStatus", parent=styles["small"], textColor=accent, alignment=TA_RIGHT)
        top = Table([[para(item.get("worker"), styles["h2"]), para(display_label(item.get("status")), status_style)]], colWidths=[103 * mm, 55 * mm])
        top.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        rows.append([Table([[top], [para(item.get("assignment"), styles["small"])], [para(item.get("result"), styles["body"])]], colWidths=[158 * mm], style=TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))])
    if not rows:
        rows = [[para("No completed worker summary was recorded.", styles["body_muted"])]]
    table = Table(rows, colWidths=[176 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5 * mm),
    ]))
    return table


def output_list(payload, styles):
    rows = []
    for item in payload.get("outputs", []):
        rows.append([
            para(item.get("name"), styles["h2"]),
            para(display_label(item.get("status")), styles["small"]),
            para(short(item.get("summary"), 420), styles["body_muted"]),
        ])
    if not rows:
        return para("No separate review output was included in this brief.", styles["body_muted"])
    table = Table(rows, colWidths=[55 * mm, 28 * mm, 93 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    return table


def action_strip(payload, styles):
    cells = []
    accents = [GREEN, AMBER, RED]
    softs = [GREEN_SOFT, AMBER_SOFT, RED_SOFT]
    for index, action in enumerate(payload.get("actions", [])):
        cells.append([para(action.get("label"), styles["action"]), para(action.get("effect"), styles["action_note"])])
    table = Table([cells], colWidths=[58.65 * mm] * max(1, len(cells)))
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEAFTER", (0, 0), (-2, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
    ]
    for index in range(len(cells)):
        commands.append(("BACKGROUND", (index, 0), (index, 0), softs[index]))
        commands.append(("LINEABOVE", (index, 0), (index, 0), 3, accents[index]))
    table.setStyle(TableStyle(commands))
    return table


def build_pdf(payload, output_path):
    if payload.get("schema") != "jarvis_operator_decision_brief_v2":
        raise ValueError("Unsupported operator decision brief payload.")
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=17 * mm,
        leftMargin=17 * mm,
        topMargin=16 * mm,
        bottomMargin=19 * mm,
        title=clean(payload.get("humanName", "Pantheon Decision Brief")),
        author="Pantheon",
        subject="Operator decision brief",
    )

    story = [
        cover_header(payload, styles),
        Spacer(1, 8 * mm),
        decision_panel(payload, styles),
        Spacer(1, 5 * mm),
        metric_strip(payload, styles),
        Spacer(1, 7 * mm),
        section_title("Commercial snapshot", styles, "The case in one view"),
        commercial_snapshot(payload, styles),
        Spacer(1, 6 * mm),
        CondPageBreak(100 * mm),
        section_title("Evidence and uncertainty", styles, "What supports the decision"),
        evidence_columns(payload, styles),
        Spacer(1, 5 * mm),
        para(payload.get("header", {}).get("mode", ""), styles["body_muted"]),
        Spacer(1, 3 * mm),
        KeepTogether([
            para("ORIGINAL DIRECTION", styles["cell_label"]),
            para(short(payload.get("originalInstruction"), 500), styles["body_muted"]),
        ]) if payload.get("originalInstruction") else Spacer(1, 0),
        CondPageBreak(145 * mm),
        section_title("Test logic and safeguards", styles, "What must be true"),
        test_plan(payload, styles),
        Spacer(1, 7 * mm),
        section_title("Commercial score", styles, "Evidence quality and execution fit"),
    ]

    score = payload.get("score") or {}
    dimensions = score.get("dimensions") or []
    if dimensions:
        for dimension in dimensions[:6]:
            story.append(ScoreBar(dimension.get("name"), dimension.get("score"), dimension.get("note"), 176 * mm, styles))
            story.append(Spacer(1, 1.5 * mm))
    else:
        story.append(para("A commercial scorecard has not been completed yet.", styles["body_muted"]))

    story.extend([
        Spacer(1, 4 * mm),
        risk_block(payload, styles),
        Spacer(1, 7 * mm),
        section_title("What happens next", styles, "Controlled execution"),
        bullet_rows(payload.get("nextActions"), styles, BLUE, "No next action was recorded."),
        Spacer(1, 9 * mm),
        CondPageBreak(105 * mm),
        section_title("Work completed by the AI team", styles, "Accountability record"),
        team_work(payload, styles),
        Spacer(1, 7 * mm),
        section_title("Review outputs", styles, "Documents available in Pantheon"),
        output_list(payload, styles),
        Spacer(1, 7 * mm),
        KeepTogether([
            section_title("Your decision", styles, "One clear response"),
            action_strip(payload, styles),
        ]),
    ])

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

from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

output_path = r'C:\ai-workspace\for-review\OPERATOR-ACTION-system-setup-2026-03-25.pdf'

doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    topMargin=50, bottomMargin=50, leftMargin=50, rightMargin=50
)

styles = getSampleStyleSheet()

title_style = ParagraphStyle('BriefTitle', parent=styles['Title'], fontSize=20, textColor=HexColor('#1a1a2e'), spaceAfter=4)
subtitle_style = ParagraphStyle('BriefSubtitle', parent=styles['Normal'], fontSize=11, textColor=HexColor('#666666'), spaceAfter=20)
heading_style = ParagraphStyle('BriefHeading', parent=styles['Heading2'], fontSize=14, textColor=HexColor('#1a1a2e'), spaceBefore=16, spaceAfter=8)
body_style = ParagraphStyle('BriefBody', parent=styles['Normal'], fontSize=10, leading=14, spaceAfter=6, textColor=HexColor('#333333'))
step_style = ParagraphStyle('Step', parent=body_style, leftIndent=20, bulletIndent=10)
why_style = ParagraphStyle('Why', parent=body_style, textColor=HexColor('#0066aa'), fontName='Helvetica-Oblique', leftIndent=10)
footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=HexColor('#999999'), alignment=TA_CENTER)

elements = []

elements.append(Paragraph('Operator Actions Required', title_style))
elements.append(Paragraph('AI Business OS - 25 March 2026', subtitle_style))

summary_data = [
    ['#', 'Action', 'Time', 'Priority'],
    ['1', 'Fill in Holding Company BRIEF', '15-30 min', 'HIGH'],
    ['2', 'Create Etsy Seller Account', '20 min', 'HIGH'],
    ['3', 'Regenerate Etsy API Shared Secret', '5 min', 'HIGH'],
    ['4', 'Google Workspace Authentication', '10-15 min', 'MEDIUM'],
    ['5', 'Install EverBee Chrome Extension', '2 min', 'LOW'],
]

summary_table = Table(summary_data, colWidths=[30, 250, 70, 70])
summary_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#1a1a2e')),
    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e0e0e0')),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8f8fc')]),
    ('PADDING', (0, 0), (-1, -1), 8),
    ('ALIGN', (0, 0), (0, -1), 'CENTER'),
    ('ALIGN', (2, 0), (3, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
]))
elements.append(summary_table)
elements.append(Spacer(1, 12))
elements.append(Paragraph('5 actions that only you can complete. The system is ready to start making money once Actions 1 and 2 are done.', body_style))
elements.append(Spacer(1, 8))
elements.append(HRFlowable(width='100%', thickness=1, color=HexColor('#e0e0e0')))

# Action 1
elements.append(Paragraph('Action 1: Fill in Holding Company BRIEF', heading_style))
elements.append(Paragraph('<b>Time:</b> 15-30 minutes &nbsp;&nbsp;|&nbsp;&nbsp; <b>File:</b> holding-company/BRIEF.md', body_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Open the file and fill in:', body_style))
for item in [
    'Business goals (what does success look like in 6 months? 1 year?)',
    'Budget constraints (how much can you invest monthly?)',
    'Risk tolerance (conservative, moderate, aggressive?)',
    'Time availability (hours per week for this?)',
    'Any specific interests or expertise to leverage',
]:
    elements.append(Paragraph('\u2022  ' + item, step_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Why: The business-advisor agent reads this for every strategic decision. Without it, all advice is generic.', why_style))
elements.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e0e0e0')))

# Action 2
elements.append(Paragraph('Action 2: Create Etsy Seller Account', heading_style))
elements.append(Paragraph('<b>Time:</b> 20 minutes', body_style))
elements.append(Spacer(1, 4))
for i, step in enumerate([
    'Go to https://www.etsy.com/sell',
    'Create a seller account (sign in or create new)',
    'Follow the setup wizard (shop name, payment, billing)',
], 1):
    elements.append(Paragraph(f'{i}.  {step}', step_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Why: This is the #1 revenue blocker. The system has products ready to create but nowhere to list them.', why_style))
elements.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e0e0e0')))

# Action 3
elements.append(Paragraph('Action 3: Regenerate Etsy API Shared Secret', heading_style))
elements.append(Paragraph('<b>Time:</b> 5 minutes', body_style))
elements.append(Spacer(1, 4))
for i, step in enumerate([
    'Go to https://www.etsy.com/developers/your-apps',
    'Click "Regenerate" next to Shared Secret',
    'Win+R then sysdm.cpl then Advanced then Environment Variables',
    'New user variable: ETSY_SHARED_SECRET = (paste new secret)',
    'Verify ETSY_API_KEY also exists as a user variable',
    'Restart VS Code for changes to take effect',
], 1):
    elements.append(Paragraph(f'{i}.  {step}', step_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Why: Original secret was exposed in chat history. Security requirement.', why_style))
elements.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e0e0e0')))

# Action 4
elements.append(Paragraph('Action 4: Google Workspace Authentication', heading_style))
elements.append(Paragraph('<b>Time:</b> 10-15 minutes', body_style))
elements.append(Spacer(1, 4))
for i, step in enumerate([
    'Open VS Code terminal',
    'Run: gws auth setup',
    'Follow browser prompts to sign in with Google',
    'Grant permissions when prompted',
    'Verify: gws auth status',
], 1):
    elements.append(Paragraph(f'{i}.  {step}', step_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Why: Enables Google Drive delivery (review briefs accessible from any device), Gmail notifications, and Calendar integration.', why_style))
elements.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e0e0e0')))

# Action 5
elements.append(Paragraph('Action 5: Install EverBee Chrome Extension', heading_style))
elements.append(Paragraph('<b>Time:</b> 2 minutes', body_style))
elements.append(Spacer(1, 4))
for i, step in enumerate([
    'Chrome Web Store - search "EverBee"',
    'Install the free version',
    'Visit any Etsy listing to see analytics overlay',
], 1):
    elements.append(Paragraph(f'{i}.  {step}', step_style))
elements.append(Spacer(1, 4))
elements.append(Paragraph('Why: Shows revenue estimates, search volume, and competition data when browsing Etsy. Essential for niche validation.', why_style))
elements.append(HRFlowable(width='100%', thickness=0.5, color=HexColor('#e0e0e0')))
elements.append(Spacer(1, 16))

# What happens next
elements.append(Paragraph('What Happens After You Complete Actions 1 and 2', heading_style))
elements.append(Paragraph('Once those two actions are done, the system will:', body_style))
for i, step in enumerate([
    'Run the full venture launch pipeline on your first niche',
    'Create POD designs via ChatGPT/Gemini browser automation',
    'Write SEO-optimised Etsy listings (titles, descriptions, 13 tags)',
    'Compile everything into a PDF brief for your review',
    'You approve, download designs, upload to Etsy',
    'Scheduled tasks keep creating new products automatically',
], 1):
    elements.append(Paragraph(f'{i}.  {step}', step_style))

elements.append(Spacer(1, 24))
elements.append(Paragraph('Generated by AI Business OS - 25 March 2026', footer_style))

doc.build(elements)
print('PDF created successfully at:', output_path)

---
name: xlsx-report
description: Generate formatted Excel spreadsheets for financial reports, unit economics, product tracking, and inventory management. Use when the analyst agent needs to produce spreadsheet deliverables.
---

# XLSX Report Generator

Generate professional, formatted Excel spreadsheets for financial and business data.

## When to Use

- Unit economics models (cost, price, margin, break-even)
- Monthly P&L summaries
- Product tracking sheets (listings, sales, inventory)
- Venture performance dashboards
- Budget and expense tracking

## How to Generate

Use Python `openpyxl` via the `py` command. Never use `python` — always `py`.

### Standard Template

Every XLSX report must include:
1. **Title row** — document name, date, venture (merged across columns, bold)
2. **Header row** — column names (bold, coloured background, frozen pane)
3. **Data rows** — formatted numbers, dates, currencies
4. **Summary row** — totals, averages (bold, top border)

### Code Pattern

```python
py -c "
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, numbers
from openpyxl.utils import get_column_letter
from datetime import datetime

wb = Workbook()
ws = wb.active
ws.title = 'SHEET_NAME'

# Colours
header_fill = PatternFill(start_color='1A1A2E', end_color='1A1A2E', fill_type='solid')
header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
alt_fill = PatternFill(start_color='F8F8FC', end_color='F8F8FC', fill_type='solid')
title_font = Font(name='Calibri', size=14, bold=True, color='1A1A2E')
currency_format = '#,##0.00'
pct_format = '0.0%'
thin_border = Border(
    bottom=Side(style='thin', color='E0E0E0')
)

# Title
ws.merge_cells('A1:F1')
ws['A1'] = 'REPORT TITLE — ' + datetime.now().strftime('%d %b %Y')
ws['A1'].font = title_font
ws.row_dimensions[1].height = 30

# Headers (row 3)
headers = ['Column A', 'Column B', 'Column C']
for i, h in enumerate(headers, 1):
    cell = ws.cell(row=3, column=i, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal='center')

# Data rows
data = [
    ['Item 1', 24.99, 0.50],
    ['Item 2', 19.99, 0.45],
]
for row_idx, row_data in enumerate(data, 4):
    for col_idx, value in enumerate(row_data, 1):
        cell = ws.cell(row=row_idx, column=col_idx, value=value)
        cell.border = thin_border
        if row_idx % 2 == 0:
            cell.fill = alt_fill
        # Apply number format for currency/percentage columns
        if isinstance(value, (int, float)) and col_idx == 2:
            cell.number_format = currency_format
        elif isinstance(value, float) and col_idx == 3:
            cell.number_format = pct_format

# Auto-fit column widths
for col in range(1, len(headers) + 1):
    max_length = max(
        len(str(ws.cell(row=r, column=col).value or ''))
        for r in range(3, len(data) + 4)
    )
    ws.column_dimensions[get_column_letter(col)].width = max(max_length + 4, 12)

# Freeze panes (freeze header row)
ws.freeze_panes = 'A4'

wb.save(r'OUTPUT_PATH')
print('XLSX created successfully')
"
```

### Multi-Sheet Reports

For comprehensive reports (e.g., monthly P&L with breakdown):
```python
# Sheet 1: Summary
ws_summary = wb.active
ws_summary.title = 'Summary'

# Sheet 2: Revenue breakdown
ws_revenue = wb.create_sheet('Revenue')

# Sheet 3: Expenses breakdown
ws_expenses = wb.create_sheet('Expenses')
```

### Formulas

Use Excel formulas for calculated fields:
```python
ws.cell(row=10, column=2, value='=SUM(B4:B9)')    # Sum
ws.cell(row=10, column=3, value='=AVERAGE(C4:C9)') # Average
ws.cell(row=10, column=4, value='=B10/C10')         # Division
```

### Conditional Formatting

For highlighting positive/negative values:
```python
from openpyxl.formatting.rule import CellIsRule

green_font = Font(color='00A86B')
red_font = Font(color='FF5252')

ws.conditional_formatting.add('D4:D100',
    CellIsRule(operator='greaterThan', formula=['0'], font=green_font))
ws.conditional_formatting.add('D4:D100',
    CellIsRule(operator='lessThan', formula=['0'], font=red_font))
```

## Output Rules

- Save XLSX to the venture's `outputs/` folder or `for-review/` as appropriate
- Use descriptive sheet names (not "Sheet1")
- Always include date in filename: `FINANCIAL-MODEL-niche-name-YYYY-MM-DD.xlsx`
- Currency always in AUD (operator is Australia-based)
- Freeze header rows for easy scrolling
- Auto-fit column widths

## Common Report Types

### Unit Economics Model
Columns: Product, Sell Price, Production Cost, Etsy Fee (6.5%), Shipping, Margin, Margin %, Break-even Units

### Monthly P&L
Columns: Category, Budget, Actual, Variance, Notes
Rows: Revenue lines, COGS lines, Operating expenses, Net

### Product Tracker
Columns: Product, Niche, Status, Listed Date, Views, Favourites, Sales, Revenue, Conversion %

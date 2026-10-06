from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "stage6-kitchen-print-preview.pdf"
GREEN = colors.HexColor("#176B4D")
INK = colors.HexColor("#17352B")
MUTED = colors.HexColor("#587067")
PALE = colors.HexColor("#EAF4EF")
LINE = colors.HexColor("#BFD3CA")
ALERT = colors.HexColor("#9B2C2C")


pdfmetrics.registerFont(
    TTFont("JantokSans", "/System/Library/Fonts/Supplemental/Arial.ttf")
)
pdfmetrics.registerFont(
    TTFont("JantokSansBold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
)


def page_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.rect(0, A4[1] - 18 * mm, A4[0], 18 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("JantokSansBold", 12)
    canvas.drawString(14 * mm, A4[1] - 11.5 * mm, "JANTOK FOOD · КУХНЯ")
    canvas.setFont("JantokSans", 8)
    canvas.drawRightString(
        A4[0] - 14 * mm,
        A4[1] - 11.5 * mm,
        f"ТЕСТОВЫЙ МАКЕТ · стр. {doc.page}",
    )
    canvas.setFillColor(MUTED)
    canvas.drawString(14 * mm, 9 * mm, "Preview layout · printer model not selected")
    canvas.drawRightString(A4[0] - 14 * mm, 9 * mm, "Generated 24.09.2026")
    canvas.restoreState()


styles = getSampleStyleSheet()
title = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName="JantokSansBold",
    fontSize=22,
    leading=26,
    textColor=INK,
    alignment=TA_LEFT,
    spaceAfter=5 * mm,
)
h2 = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontName="JantokSansBold",
    fontSize=13,
    leading=16,
    textColor=GREEN,
    spaceBefore=3 * mm,
    spaceAfter=2 * mm,
)
body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName="JantokSans",
    fontSize=9,
    leading=12,
    textColor=INK,
)
small = ParagraphStyle(
    "Small", parent=body, fontSize=7.5, leading=9, textColor=MUTED
)
alert = ParagraphStyle(
    "Alert",
    parent=small,
    fontName="JantokSansBold",
    textColor=ALERT,
)


def p(value, style=body):
    return Paragraph(str(value), style)


def table(data, widths, header=True):
    result = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "JantokSans"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALE),
                ("FONTNAME", (0, 0), (-1, 0), "JantokSansBold"),
                ("TEXTCOLOR", (0, 0), (-1, 0), GREEN),
            ]
        )
    for row in range(1 if header else 0, len(data)):
        if row % 2 == 0:
            commands.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#F8FBF9")))
    result.setStyle(TableStyle(commands))
    return result


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc = BaseDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    leftMargin=14 * mm,
    rightMargin=14 * mm,
    topMargin=25 * mm,
    bottomMargin=16 * mm,
    title="JANTOK Stage 6 kitchen print preview",
    author="JANTOK Food",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates(
    [
        PageTemplate(id="production", frames=[frame], onPage=page_header),
        PageTemplate(id="packing", frames=[frame], onPage=page_header),
    ]
)

story = [
    p("Production list", title),
    p("25 сентября 2026 · FINAL revision v3 · LOCKED", h2),
    p(
        "Зафиксировано после cut-off. Индивидуальные варианты показаны отдельными строками; поздние изменения выпускаются новой DELTA-ревизией.",
        small,
    ),
    Spacer(1, 4 * mm),
    table(
        [
            [p("Блюдо / вариант", small), p("Порция", small), p("План", small), p("Факт", small), p("Статус", small)],
            [p("Овсяная каша · стандарт"), p("280 г"), "18", "18", p("ГОТОВО")],
            [p("Овсяная каша · без молока", alert), p("280 г"), "3", "3", p("ГОТОВО")],
            [p("Овсяная каша · детская"), p("180 г"), "5", "5", p("ГОТОВО")],
            [p("DEMO_OAT_SNACK · recurring add-on"), p("1 шт"), "7", "7", p("ГОТОВО")],
        ],
        [75 * mm, 25 * mm, 18 * mm, 18 * mm, 35 * mm],
    ),
    p("Потребность ингредиентов", h2),
    table(
        [
            [p("Ингредиент", small), p("План", small), p("Резерв", small), p("Факт", small), p("Ср. цена", small), p("Стоимость", small)],
            [p("Овёс"), "1 940 g", "1 940 g", "1 920 g", "0.50 KZT/g", "960 KZT"],
            [p("Молоко"), "4 320 ml", "4 320 ml", "4 280 ml", "0.42 KZT/ml", "1 797.60 KZT"],
            [p("Ягоды"), "650 g", "650 g", "640 g", "2.10 KZT/g", "1 344 KZT"],
        ],
        [44 * mm, 27 * mm, 27 * mm, 27 * mm, 27 * mm, 29 * mm],
    ),
    Spacer(1, 4 * mm),
    table(
        [[p("ПЛАН", small), p("ФАКТ", small), p("ОТХОДЫ", small), p("FOOD COST", small)],
         [p("3 988 KZT", h2), p("4 101.60 KZT", h2), p("125 KZT", h2), p("18.4%", h2)]],
        [45 * mm] * 4,
    ),
    PageBreak(),
    NextPageTemplate("packing"),
    p("Packing list & labels", title),
    p("Заказ JF-250926-0142 · Household delivery · слот 06:00–08:00", h2),
    table(
        [
            [p("Участник", small), p("Комплект", small), p("Кол-во", small), p("Маркировка", small), p("Готово", small)],
            [p("Алия"), p("Завтрак · Овсяная каша"), "1", "—", "ДА"],
            [p("Тимур"), p("Завтрак · Овсяная каша"), "1", p("БЕЗ МОЛОКА", alert), "ДА"],
            [p("Мира"), p("Завтрак · Детская порция"), "1", p("ДЕТСКАЯ ПОРЦИЯ", alert), "ДА"],
            [p("Household"), p("Recurring add-on · Oat snack"), "2", "—", "ДА"],
        ],
        [31 * mm, 65 * mm, 18 * mm, 48 * mm, 18 * mm],
    ),
    p("Label preview · 100×150 мм", h2),
]

label_style = TableStyle(
    [
        ("BOX", (0, 0), (-1, -1), 1.2, GREEN),
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "JantokSansBold"),
        ("FONTNAME", (0, 1), (-1, -1), "JantokSans"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
)
label = Table(
    [
        [p("JANTOK FOOD", ParagraphStyle("LabelHead", parent=body, fontName="JantokSansBold", textColor=colors.white))],
        [p("ТИМУР · 25.09.2026", h2)],
        [p("Заказ JF-250926-0142")],
        [p("Завтрак · Овсяная каша · 1 шт")],
        [p("ИНДИВИДУАЛЬНО: БЕЗ МОЛОКА", alert)],
        [p("Состав комплекта: каша, ягоды, ложка", small)],
    ],
    colWidths=[100 * mm],
)
label.setStyle(label_style)
story.extend(
    [
        label,
        Spacer(1, 5 * mm),
        p(
            "Минимизация данных: только имя/идентификатор участника, дата, заказ, состав комплекта и необходимая маркировка. Поля анкеты и QR отсутствуют.",
            small,
        ),
        Spacer(1, 5 * mm),
        p("Контроль", h2),
        table(
            [
                [p("Позиции", small), p("Упаковано", small), p("Missing", small), p("READY", small)],
                ["5", "5", "0", p("РАЗРЕШЕНО")],
            ],
            [45 * mm] * 4,
        ),
    ]
)

doc.build(story)
print(OUTPUT)

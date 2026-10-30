/**
 * PDF monthly report.
 *
 * jsPDF and jspdf-autotable together weigh around 400 kB, so both are loaded
 * with a dynamic `import()` the first time a PDF is requested. They never enter
 * the initial bundle that a phone downloads to tap one button.
 */

import type { jsPDF } from 'jspdf'
import type { MonthlyReport } from '../report'
import type { DayStatus } from '../attendance'
import {
  DAILY_COLUMNS,
  detailSections,
  policyLines,
  reportHeaderLines,
  summaryLines,
  toDailyRows,
} from './rows'

/** The jsPDF instance type, imported type-only so jspdf stays out of the bundle. */
type Doc = jsPDF

/** Report palette, matched to the app's design tokens. */
const INK = {
  heading: [30, 41, 59] as [number, number, number], // slate-800
  body: [51, 65, 85] as [number, number, number], // slate-700
  muted: [100, 116, 139] as [number, number, number], // slate-500
  primary: [67, 56, 202] as [number, number, number], // indigo-700
  rule: [226, 229, 234] as [number, number, number],
  zebra: [247, 248, 250] as [number, number, number],
}

/**
 * Status tints. Each cell also keeps its text label, so the document stays
 * readable in greyscale and for a colour-blind reader — colour is never the
 * only carrier of meaning.
 */
const STATUS_TINT: Partial<Record<DayStatus, [number, number, number]>> = {
  present: [22, 101, 52],
  late: [154, 52, 18],
  absent: [153, 27, 27],
  missing_check_in: [133, 77, 14],
  missing_check_out: [133, 77, 14],
  leave: [30, 64, 175],
}

export interface PdfOptions {
  /** Include the per-day table. On for the full report. */
  includeDailyTable?: boolean
  includeDetailSections?: boolean
}

export async function buildMonthlyReportPdf(
  report: MonthlyReport,
  generatedAt: Date,
  options: PdfOptions = {},
): Promise<Blob> {
  const { includeDailyTable = true, includeDetailSections = true } = options

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableModule.default

  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  const contentWidth = pageWidth - margin * 2

  // ---- Header band ---------------------------------------------------------
  doc.setFillColor(...INK.primary)
  doc.rect(0, 0, pageWidth, 86, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(report.policy.officeName, margin, 38)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Attendance Report — ${report.label}`, margin, 58)

  doc.setFontSize(9)
  const generatedLine = reportHeaderLines(report, generatedAt).find(
    (line) => line.label === 'Generated',
  )
  doc.text(`Generated ${generatedLine?.value ?? ''}`, margin, 74)

  let cursorY = 112

  // ---- Policy + summary, side by side -------------------------------------
  const colGap = 18
  const colWidth = (contentWidth - colGap) / 2

  cursorY = sectionTitle(doc, 'Attendance policy', margin, cursorY)
  const policyEndY = keyValueBlock(doc, policyLines(report), margin, cursorY, colWidth)

  let rightY = 112
  rightY = sectionTitle(doc, 'Monthly summary', margin + colWidth + colGap, rightY)
  const headlineStats = summaryLines(report).slice(0, 11)
  const summaryEndY = keyValueBlock(
    doc,
    headlineStats,
    margin + colWidth + colGap,
    rightY,
    colWidth,
  )

  cursorY = Math.max(policyEndY, summaryEndY) + 10

  // ---- Remaining statistics ------------------------------------------------
  const restStats = summaryLines(report).slice(11)
  if (restStats.length > 0) {
    cursorY = ensureSpace(doc, cursorY, 24 + restStats.length * 7)
    cursorY = sectionTitle(doc, 'Timing and corrections', margin, cursorY)
    cursorY = keyValueBlock(doc, restStats, margin, cursorY, contentWidth) + 10
  }

  // ---- Daily table ---------------------------------------------------------
  if (includeDailyTable) {
    const rows = toDailyRows(report)
    const statusColumnIndex = DAILY_COLUMNS.findIndex((c) => c.key === 'status')

    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: margin, right: margin, top: 48, bottom: 44 },
      head: [DAILY_COLUMNS.map((column) => column.header)],
      body: rows.map((row) => DAILY_COLUMNS.map((column) => row[column.key] ?? '')),
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 4,
        textColor: INK.body,
        lineColor: INK.rule,
        lineWidth: 0.5,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: INK.primary,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
      },
      alternateRowStyles: { fillColor: INK.zebra },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
        8: { halign: 'center' },
      },
      // Tint only the status cell, leaving the rest of the row readable.
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== statusColumnIndex) return
        const day = report.days[data.row.index]
        const tint = day ? STATUS_TINT[day.status] : undefined
        if (tint) {
          data.cell.styles.textColor = tint
          data.cell.styles.fontStyle = 'bold'
        }
      },
      didDrawPage: () => drawFooter(doc, report, margin),
    })

    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY
    cursorY = (finalY ?? cursorY) + 18
  }

  // ---- Late arrivals / missing days ---------------------------------------
  if (includeDetailSections) {
    for (const section of detailSections(report)) {
      cursorY = ensureSpace(doc, cursorY, 40)
      cursorY = sectionTitle(doc, section.title, margin, cursorY)
      if (section.rows.length === 0) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(9)
        doc.setTextColor(...INK.muted)
        doc.text(section.emptyMessage, margin, cursorY)
        cursorY += 20
      } else {
        for (const [date, detail] of section.rows) {
          cursorY = ensureSpace(doc, cursorY, 16)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...INK.heading)
          doc.text(date, margin, cursorY)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(...INK.body)
          doc.text(detail, margin + 76, cursorY, { maxWidth: contentWidth - 76 })
          cursorY += 14
        }
        cursorY += 8
      }
    }

    cursorY = ensureSpace(doc, cursorY, 56)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK.muted)
    doc.text(
      'Late By reports minutes past the scheduled arrival time, counted only on days that exceeded the ' +
        `grace period of ${report.policy.gracePeriodMinutes} minutes. Durations are derived from recorded ` +
        'timestamps and shown in the office time zone.',
      margin,
      cursorY,
      { maxWidth: contentWidth },
    )
  }

  drawFooter(doc, report, margin)
  return doc.output('blob')
}


function sectionTitle(doc: Doc, title: string, x: number, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK.heading)
  doc.text(title, x, y)
  doc.setDrawColor(...INK.rule)
  doc.setLineWidth(0.6)
  doc.line(x, y + 5, x + 120, y + 5)
  return y + 18
}

function keyValueBlock(
  doc: Doc,
  lines: Array<{ label: string; value: string }>,
  x: number,
  y: number,
  width: number,
): number {
  doc.setFontSize(8.5)
  let cursor = y
  for (const line of lines) {
    cursor = ensureSpace(doc, cursor, 14)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...INK.muted)
    doc.text(line.label, x, cursor, { maxWidth: width * 0.62 })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INK.heading)
    doc.text(line.value, x + width, cursor, { align: 'right', maxWidth: width * 0.36 })
    cursor += 13
  }
  return cursor
}

/** Starts a new page when the next block would not fit. */
function ensureSpace(doc: Doc, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed > pageHeight - 48) {
    doc.addPage()
    return 56
  }
  return y
}

function drawFooter(doc: Doc, report: MonthlyReport, margin: number): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const page = doc.getCurrentPageInfo().pageNumber

  doc.setDrawColor(...INK.rule)
  doc.setLineWidth(0.5)
  doc.line(margin, pageHeight - 32, pageWidth - margin, pageHeight - 32)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK.muted)
  doc.text(
    `${report.policy.officeName} — ${report.label} — personal attendance record`,
    margin,
    pageHeight - 20,
  )
  doc.text(`Page ${page}`, pageWidth - margin, pageHeight - 20, { align: 'right' })
}

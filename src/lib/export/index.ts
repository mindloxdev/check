/**
 * Export orchestration. The UI calls these four functions and nothing else.
 */

import type { MonthlyReport } from '../report'
import { downloadBlob } from '../utils'
import { csvBlob, dailyTableCsv, monthlyReportCsv } from './csv'
import { exportFileStem } from './rows'
import { monthlyReportWorkbook, xlsxBlob } from './xlsx'

export * from './rows'
export { csvEscape, toCsv, dailyTableCsv, monthlyReportCsv } from './csv'
export { buildWorkbook, columnLetter, sanitiseSheetName, xmlEscape } from './xlsx'

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export function downloadMonthlyCsv(report: MonthlyReport, generatedAt = new Date()): void {
  downloadBlob(
    csvBlob(monthlyReportCsv(report, generatedAt)),
    `${exportFileStem(report)}.csv`,
  )
}

/** Just the daily rows — what History's "export selection" produces. */
export function downloadDailyTableCsv(report: MonthlyReport, filename?: string): void {
  downloadBlob(
    csvBlob(dailyTableCsv(report)),
    filename ?? `${exportFileStem(report)}-daily.csv`,
  )
}

export function downloadMonthlyXlsx(report: MonthlyReport, generatedAt = new Date()): void {
  downloadBlob(
    xlsxBlob(monthlyReportWorkbook(report, generatedAt)),
    `${exportFileStem(report)}.xlsx`,
  )
}

export async function downloadMonthlyPdf(
  report: MonthlyReport,
  generatedAt = new Date(),
): Promise<void> {
  // Loaded on demand; jspdf is ~400 kB and most sessions never export a PDF.
  const { buildMonthlyReportPdf } = await import('./pdf')
  const blob = await buildMonthlyReportPdf(report, generatedAt)
  downloadBlob(blob, `${exportFileStem(report)}.pdf`)
}

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel (.xlsx)',
  pdf: 'PDF',
}

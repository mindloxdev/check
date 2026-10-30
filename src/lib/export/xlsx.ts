/**
 * Minimal SpreadsheetML (.xlsx) writer.
 *
 * Writing the six OOXML parts by hand keeps a 700 kB spreadsheet library out of
 * the bundle for what is, in the end, a styled table. The output opens natively
 * in Excel, LibreOffice, Numbers and Google Sheets.
 *
 * Strings are written as `inlineStr`, which skips the shared-string table
 * entirely — more bytes on disk, far less that can go subtly wrong.
 */

import { zipSync, strToU8 } from 'fflate'
import type { MonthlyReport } from '../report'
import {
  DAILY_COLUMNS,
  policyLines,
  reportHeaderLines,
  summaryLines,
  toDailyRows,
} from './rows'

export type CellValue = string | number | null | undefined

export interface Cell {
  value: CellValue
  /** Index into the cellXfs table declared in `STYLES_XML`. */
  style?: number
}

export interface SheetSpec {
  name: string
  /** Column widths in characters. */
  columnWidths?: number[]
  rows: Cell[][]
  /** Freeze the first row and add an autofilter over the used range. */
  freezeHeader?: boolean
}

// Style indices must match the order of <cellXfs> below.
export const STYLE = {
  default: 0,
  tableHeader: 1,
  title: 2,
  bodyBordered: 3,
  numeric: 4,
  label: 5,
} as const

/**
 * Characters XML 1.0 forbids outright: they cannot be escaped, only removed.
 * Built with escapes so no literal control byte appears in this file.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** Escapes text for an XML text node or attribute and drops illegal chars. */
export function xmlEscape(value: string): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 1 → 'A', 26 → 'Z', 27 → 'AA'. */
export function columnLetter(index1Based: number): string {
  let n = index1Based
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function cellXml(cell: Cell, ref: string): string {
  const style = cell.style ? ` s="${cell.style}"` : ''
  const { value } = cell

  if (value == null || value === '') {
    // An empty cell still needs to exist when it carries a style (borders).
    return cell.style ? `<c r="${ref}"${style}/>` : ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    String(value),
  )}</t></is></c>`
}

function sheetXml(spec: SheetSpec): string {
  const rowCount = Math.max(spec.rows.length, 1)
  const colCount = Math.max(1, ...spec.rows.map((r) => r.length))
  const dimension = `A1:${columnLetter(colCount)}${rowCount}`

  const cols =
    spec.columnWidths && spec.columnWidths.length > 0
      ? `<cols>${spec.columnWidths
          .map(
            (width, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${Math.max(
                4,
                Math.min(80, width),
              )}" customWidth="1"/>`,
          )
          .join('')}</cols>`
      : ''

  const views = spec.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'

  const body = spec.rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell, colIdx) => cellXml(cell, `${columnLetter(colIdx + 1)}${rowIdx + 1}`))
        .join('')
      return `<row r="${rowIdx + 1}">${cells}</row>`
    })
    .join('')

  // CT_Worksheet requires this child order: dimension, sheetViews, cols,
  // sheetData, then autoFilter.
  const autoFilter = spec.freezeHeader
    ? `<autoFilter ref="A1:${columnLetter(colCount)}${rowCount}"/>`
    : ''

  return (
    `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>${views}${cols}` +
    `<sheetData>${body}</sheetData>${autoFilter}</worksheet>`
  )
}

const STYLES_XML =
  `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="15"/><color rgb="FF1E293B"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FF475569"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  // Deep indigo header band, matching the app's primary token.
  '<fill><patternFill patternType="solid"><fgColor rgb="FF4338CA"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E5EA"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

/** Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters. */
export function sanitiseSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned.length > 0 ? cleaned : 'Sheet').slice(0, 31)
}

export function buildWorkbook(sheets: SheetSpec[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet')

  const names = new Set<string>()
  const safeSheets = sheets.map((sheet, index) => {
    let name = sanitiseSheetName(sheet.name)
    // Duplicate sheet names make the file unopenable, so de-duplicate.
    while (names.has(name.toLowerCase())) name = sanitiseSheetName(`${name} ${index + 1}`)
    names.add(name.toLowerCase())
    return { ...sheet, name }
  })

  const contentTypes =
    `${XML_DECL}<Types xmlns="${CONTENT_TYPES_NS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/xl/workbook.xml" ContentType="${SML}.sheet.main+xml"/>` +
    safeSheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SML}.worksheet+xml"/>`,
      )
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="${SML}.styles+xml"/>` +
    '</Types>'

  const rootRels =
    `${XML_DECL}<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'

  const workbook =
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="${DOC_REL}"><sheets>` +
    safeSheets
      .map(
        (sheet, i) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join('') +
    '</sheets></workbook>'

  const workbookRels =
    `${XML_DECL}<Relationships xmlns="${REL_NS}">` +
    safeSheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${DOC_REL}/worksheet" Target="worksheets/sheet${
            i + 1
          }.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${safeSheets.length + 1}" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>'

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  }
  safeSheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet))
  })

  return zipSync(files, { level: 6 })
}

// ---------------------------------------------------------------------------
// Report → workbook
// ---------------------------------------------------------------------------

const text = (value: string, style: number = STYLE.default): Cell => ({ value, style })

export function monthlyReportWorkbook(
  report: MonthlyReport,
  generatedAt: Date,
): Uint8Array {
  // --- Sheet 1: summary -----------------------------------------------------
  const summaryRows: Cell[][] = [
    [text('Office Attendance Report', STYLE.title)],
    [],
  ]
  for (const line of reportHeaderLines(report, generatedAt)) {
    summaryRows.push([text(line.label, STYLE.label), text(line.value)])
  }
  summaryRows.push([])
  summaryRows.push([text('Attendance policy', STYLE.title)])
  for (const line of policyLines(report)) {
    summaryRows.push([text(line.label, STYLE.label), text(line.value)])
  }
  summaryRows.push([])
  summaryRows.push([text('Monthly summary', STYLE.title)])
  for (const line of summaryLines(report)) {
    const numeric = /^-?\d+$/.test(line.value)
    summaryRows.push([
      text(line.label, STYLE.label),
      numeric ? { value: Number(line.value), style: STYLE.numeric } : text(line.value),
    ])
  }

  // --- Sheet 2: daily table -------------------------------------------------
  const dailyRows: Cell[][] = [
    DAILY_COLUMNS.map((column) => text(column.header, STYLE.tableHeader)),
  ]
  for (const row of toDailyRows(report)) {
    dailyRows.push(
      DAILY_COLUMNS.map((column) => ({
        value: row[column.key] ?? '',
        style: column.numeric ? STYLE.numeric : STYLE.bodyBordered,
      })),
    )
  }

  return buildWorkbook([
    { name: 'Summary', rows: summaryRows, columnWidths: [46, 34] },
    {
      name: report.label,
      rows: dailyRows,
      columnWidths: DAILY_COLUMNS.map((c) => c.width ?? 14),
      freezeHeader: true,
    },
  ])
}

export const XLSX_MIME = `${SML}.sheet`

export function xlsxBlob(bytes: Uint8Array): Blob {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a pooled view.
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: XLSX_MIME })
}

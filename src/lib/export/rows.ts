/**
 * The single table shape every export format renders.
 *
 * CSV, XLSX, PDF and the print view all read from here, so a column added once
 * appears everywhere and the four outputs can never drift apart.
 */

import type { MonthlyReport, MonthlyStats } from '../report'
import { lateArrivalItems, attentionItems } from '../report'
import type { DaySummary } from '../attendance'
import { STATUS_PRESENTATION, VERIFICATION_LABEL } from '../attendance'
import {
  WEEKDAY_NAMES,
  formatClockTime,
  formatDuration,
  formatTimeKey,
  formatZoneOffset,
} from '../tz'

export interface ExportColumn {
  key: string
  header: string
  /** Right-aligned numeric columns in XLSX/PDF. */
  numeric?: boolean
  /** Column width hint, in characters. */
  width?: number
}

export const DAILY_COLUMNS: readonly ExportColumn[] = [
  { key: 'date', header: 'Date', width: 12 },
  { key: 'day', header: 'Day', width: 11 },
  { key: 'checkIn', header: 'Check In', width: 11 },
  { key: 'checkOut', header: 'Check Out', width: 11 },
  { key: 'duration', header: 'Duration', width: 11 },
  { key: 'lateBy', header: 'Late By', width: 10 },
  { key: 'status', header: 'Status', width: 18 },
  { key: 'verification', header: 'Verification', width: 20 },
  { key: 'corrected', header: 'Corrected', width: 10 },
  { key: 'note', header: 'Note', width: 28 },
] as const

export type DailyExportRow = Record<string, string>

export function toDailyRow(day: DaySummary): DailyExportRow {
  const tz = day.policy.timeZone
  return {
    date: day.dateKey,
    day: WEEKDAY_NAMES[day.weekday],
    checkIn: day.checkInAt ? formatClockTime(day.checkInAt, tz) : '—',
    checkOut: day.checkOutAt ? formatClockTime(day.checkOutAt, tz) : '—',
    duration:
      day.status === 'missing_check_out' || day.status === 'checked_in'
        ? 'Incomplete'
        : formatDuration(day.workedMinutes),
    // "Late By" reports minutes past the *scheduled* arrival, and only on days
    // that actually breached the grace period. An arrival inside grace reads 0,
    // and the day detail shows the beyond-grace figure as well.
    lateBy: day.late.isLate ? `${day.late.minutesAfterSchedule}m` : '0m',
    status: statusLabel(day),
    verification: day.verification.checkIn
      ? VERIFICATION_LABEL[day.verification.checkIn]
      : '—',
    corrected: day.manuallyCorrected ? 'Yes' : '',
    note: day.primaryRecord?.note ?? '',
  }
}

function statusLabel(day: DaySummary): string {
  const base = STATUS_PRESENTATION[day.status].label
  if (day.status === 'holiday' && day.holidayName) return `Holiday — ${day.holidayName}`
  if (day.status === 'leave' && day.leaveType) return `Leave — ${day.leaveType}`
  if (day.workedOnNonWorkingDay) return `${base} (off-schedule day)`
  return base
}

export function toDailyRows(report: MonthlyReport): DailyExportRow[] {
  return report.days.map(toDailyRow)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface SummaryLine {
  label: string
  value: string
}

export function summaryLines(report: MonthlyReport): SummaryLine[] {
  const s: MonthlyStats = report.stats
  return [
    { label: 'Total scheduled working days', value: String(s.scheduledWorkingDays) },
    { label: 'Scheduled days elapsed', value: String(s.scheduledWorkingDaysElapsed) },
    { label: 'Days with recorded attendance', value: String(s.daysWithAttendance) },
    { label: 'Days absent', value: String(s.daysAbsent) },
    { label: 'Days arriving late', value: String(s.daysLate) },
    { label: 'Days with missing check-in', value: String(s.daysMissingCheckIn) },
    { label: 'Days with missing check-out', value: String(s.daysMissingCheckOut) },
    { label: 'Days on approved leave', value: String(s.daysOnLeave) },
    { label: 'Holidays', value: String(s.holidayCount) },
    { label: 'Weekend / non-working days', value: String(s.weekendCount) },
    { label: 'Total recorded working hours', value: formatDuration(s.totalWorkedMinutes) },
    {
      label: 'Average working day',
      value: s.averageWorkedMinutes == null ? '—' : formatDuration(s.averageWorkedMinutes),
    },
    {
      label: 'Average check-in time',
      value: s.averageCheckIn ? formatTimeKey(s.averageCheckIn) : '—',
    },
    {
      label: 'Average check-out time',
      value: s.averageCheckOut ? formatTimeKey(s.averageCheckOut) : '—',
    },
    {
      label: 'Total late-arrival minutes (after scheduled arrival)',
      value: `${s.totalLateMinutes}m`,
    },
    {
      label: 'Total late minutes beyond grace period',
      value: `${s.totalLateMinutesBeyondGrace}m`,
    },
    { label: 'Manually corrected days', value: String(s.manuallyCorrectedDays) },
    { label: 'Verified check-ins', value: String(s.verifiedCheckIns) },
    {
      label: 'Attendance rate',
      value: s.attendanceRate == null ? '—' : `${s.attendanceRate}%`,
    },
    {
      label: 'Punctuality rate',
      value: s.punctualityRate == null ? '—' : `${s.punctualityRate}%`,
    },
  ]
}

export function policyLines(report: MonthlyReport): SummaryLine[] {
  const p = report.policy
  const workingDayNames = p.workingDays.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')
  return [
    { label: 'Office', value: p.officeName },
    {
      label: 'Time zone',
      value: `${p.timeZone} (${formatZoneOffset(new Date(), p.timeZone)})`,
    },
    { label: 'Expected arrival', value: formatTimeKey(p.expectedCheckIn) },
    { label: 'Expected departure', value: formatTimeKey(p.expectedCheckOut) },
    { label: 'Grace period', value: `${p.gracePeriodMinutes} minutes` },
    { label: 'Working days', value: workingDayNames },
  ]
}

export interface DetailSection {
  title: string
  rows: Array<[string, string]>
  emptyMessage: string
}

export function detailSections(report: MonthlyReport): DetailSection[] {
  const late = lateArrivalItems(report)
  const attention = attentionItems(report)
  return [
    {
      title: 'Late arrivals',
      rows: late.map((item) => [item.dateKey, item.detail] as [string, string]),
      emptyMessage: 'No late arrivals this month.',
    },
    {
      title: 'Missing and absent days',
      rows: attention.map((item) => [item.dateKey, item.detail] as [string, string]),
      emptyMessage: 'No missing or absent days this month.',
    },
  ]
}

/** `attendance-october-2026` — used as the export filename stem. */
export function exportFileStem(report: MonthlyReport): string {
  const { year, month } = report.month
  return `attendance-${year}-${String(month).padStart(2, '0')}`
}

/** Header block shared by every export format. */
export function reportHeaderLines(report: MonthlyReport, generatedAt: Date): SummaryLine[] {
  return [
    { label: 'Office', value: report.policy.officeName },
    { label: 'Report month', value: report.label },
    {
      label: 'Generated',
      value: `${formatClockTime(generatedAt, report.policy.timeZone)} on ${
        report.today
      } (${report.policy.timeZone})`,
    },
  ]
}

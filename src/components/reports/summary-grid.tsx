import {
  CalendarCheck,
  CalendarX,
  Clock,
  Hourglass,
  LogIn,
  LogOut,
  PencilLine,
  Timer,
  TrendingUp,
  UserCheck,
} from 'lucide-react'
import type { MonthlyReport } from '@/lib/report'
import { StatCard } from '@/components/common/stat-card'
import { formatDuration, formatTimeKey } from '@/lib/tz'
import { cn } from '@/lib/utils'

/**
 * The monthly summary cards.
 *
 * A statistic that has no data renders an em dash, never a zero — "average
 * check-in: 00:00" would be a lie, and the difference matters when reviewing a
 * month that has barely started.
 */
export function SummaryGrid({
  report,
  loading,
  className,
}: {
  report: MonthlyReport | null
  loading?: boolean
  className?: string
}) {
  const s = report?.stats

  const cards = [
    {
      label: 'Scheduled days',
      value: s ? String(s.scheduledWorkingDays) : '—',
      hint: s ? `${s.scheduledWorkingDaysElapsed} elapsed so far` : undefined,
      icon: CalendarCheck,
      tone: 'default' as const,
    },
    {
      label: 'Days present',
      value: s ? String(s.daysWithAttendance) : '—',
      hint:
        s?.attendanceRate != null ? `${s.attendanceRate}% of elapsed days` : 'No data yet',
      icon: UserCheck,
      tone: 'success' as const,
    },
    {
      label: 'Days absent',
      value: s ? String(s.daysAbsent) : '—',
      hint: 'Scheduled days with no record',
      icon: CalendarX,
      tone: 'destructive' as const,
    },
    {
      label: 'Late arrivals',
      value: s ? String(s.daysLate) : '—',
      hint:
        s?.punctualityRate != null ? `${s.punctualityRate}% on time` : 'No arrivals recorded',
      icon: Clock,
      tone: 'warning' as const,
    },
    {
      label: 'Missing check-in',
      value: s ? String(s.daysMissingCheckIn) : '—',
      hint: 'Checked out with no arrival',
      icon: LogIn,
      tone: 'caution' as const,
    },
    {
      label: 'Missing check-out',
      value: s ? String(s.daysMissingCheckOut) : '—',
      hint: 'Never closed the session',
      icon: LogOut,
      tone: 'caution' as const,
    },
    {
      label: 'Total hours',
      value: s ? formatDuration(s.totalWorkedMinutes) : '—',
      hint:
        s?.averageWorkedMinutes != null
          ? `${formatDuration(s.averageWorkedMinutes)} average day`
          : 'No completed sessions',
      icon: Hourglass,
      tone: 'default' as const,
    },
    {
      label: 'Avg check-in',
      value: s?.averageCheckIn ? formatTimeKey(s.averageCheckIn) : '—',
      hint: report ? `Expected ${formatTimeKey(report.policy.expectedCheckIn)}` : undefined,
      icon: LogIn,
      tone: 'info' as const,
    },
    {
      label: 'Avg check-out',
      value: s?.averageCheckOut ? formatTimeKey(s.averageCheckOut) : '—',
      hint: report ? `Expected ${formatTimeKey(report.policy.expectedCheckOut)}` : undefined,
      icon: LogOut,
      tone: 'info' as const,
    },
    {
      label: 'Late minutes',
      value: s ? `${s.totalLateMinutes}m` : '—',
      hint: s ? `${s.totalLateMinutesBeyondGrace}m past the grace period` : undefined,
      icon: Timer,
      tone: 'warning' as const,
    },
    {
      label: 'Leave & holidays',
      value: s ? String(s.daysOnLeave + s.holidayCount) : '—',
      hint: s ? `${s.daysOnLeave} leave · ${s.holidayCount} holiday` : undefined,
      icon: TrendingUp,
      tone: 'info' as const,
    },
    {
      label: 'Corrected days',
      value: s ? String(s.manuallyCorrectedDays) : '—',
      hint: 'Edited by hand, fully audited',
      icon: PencilLine,
      tone: 'caution' as const,
    },
  ]

  return (
    <div className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {cards.map((card) => (
        <StatCard key={card.label} {...card} loading={loading} />
      ))}
    </div>
  )
}

import * as React from 'react'
import { AlertCircle, CalendarClock, FileX } from 'lucide-react'
import {
  useDefaultReportMonth,
  useMonthlyReport,
  useMonthlyReview,
  usePolicy,
} from '@/hooks/use-attendance'
import { useMinuteClock } from '@/providers/clock-provider'
import { MonthSwitcher } from '@/components/reports/month-switcher'
import { SummaryGrid } from '@/components/reports/summary-grid'
import { HoursChart } from '@/components/reports/hours-chart'
import { PunctualityChart } from '@/components/reports/punctuality-chart'
import { StatusBreakdown } from '@/components/reports/status-breakdown'
import { DailyTable } from '@/components/reports/daily-table'
import { ExportMenu } from '@/components/reports/export-menu'
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet'
import { PageHeader } from '@/components/common/page-header'
import { ConnectionBanner } from '@/components/common/connection-banner'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/common/status-badge'
import { attentionItems, lateArrivalItems, monthOf, type MonthRef } from '@/lib/report'
import {
  formatLongDate,
  formatTimeKey,
  resolveBusinessDate,
  type DateKey,
  WEEKDAY_NAMES,
} from '@/lib/tz'

export function ReportsPage() {
  const { policy } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone, {
    overnightEnabled: policy.overnightEnabled,
    dayCutoffHour: policy.dayCutoffHour,
  })

  const defaultMonth = useDefaultReportMonth()
  const review = useMonthlyReview()
  const [month, setMonth] = React.useState<MonthRef | null>(null)
  const activeMonth = month ?? defaultMonth

  const { report, isLoading, error, refetch } = useMonthlyReport(activeMonth)
  const [selectedDate, setSelectedDate] = React.useState<DateKey | null>(null)

  const attention = React.useMemo(() => (report ? attentionItems(report) : []), [report])
  const lateDays = React.useMemo(() => (report ? lateArrivalItems(report) : []), [report])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Monthly report"
        description="Pick any month to review. Reports are generated from recorded timestamps."
        actions={report ? <ExportMenu report={report} /> : undefined}
      />

      <ConnectionBanner />

      {/* The monthly closing reminder. */}
      {review.isAvailable && monthOf(today).month !== activeMonth.month ? null : null}
      {review.isDueToday ? (
        <div className="no-print flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary-soft px-3.5 py-3">
          <CalendarClock className="mt-px size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] font-semibold leading-tight text-primary">
              Time to review {review.label}
            </p>
            <p className="text-xs leading-relaxed text-primary/80">
              It is the {policyOrdinal(review.availableFrom)} — your configured monthly
              reporting day.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={() => setMonth(review.month)}
          >
            Open
          </Button>
        </div>
      ) : null}

      <Card className="p-3">
        <MonthSwitcher month={activeMonth} onChange={setMonth} today={today} />
      </Card>

      {error ? (
        <EmptyState
          icon={FileX}
          tone="error"
          title="The report could not be built"
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          }
        />
      ) : null}

      {/* The print view gets a header the screen does not need. */}
      {report ? (
        <div className="print-only mb-4">
          <h1 className="text-xl font-bold">{report.policy.officeName}</h1>
          <p className="text-sm">
            Attendance report — {report.label} · generated {today}
          </p>
          <p className="text-xs">
            Expected {formatTimeKey(report.policy.expectedCheckIn)}–
            {formatTimeKey(report.policy.expectedCheckOut)}, {report.policy.gracePeriodMinutes}{' '}
            min grace, {report.policy.timeZone}
          </p>
        </div>
      ) : null}

      <SummaryGrid report={report} loading={isLoading} />

      {isLoading ? (
        <>
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </>
      ) : report ? (
        <>
          <HoursChart report={report} onSelectDay={setSelectedDate} />
          <PunctualityChart report={report} />
          <StatusBreakdown report={report} />

          {attention.length > 0 ? (
            <section className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                <AlertCircle className="size-4 text-caution" aria-hidden="true" />
                Needs attention ({attention.length})
              </h2>
              <ul className="space-y-1.5">
                {attention.slice(0, 12).map((item) => (
                  <li key={`${item.dateKey}-${item.status}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(item.dateKey)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold leading-tight">
                          {formatLongDate(item.dateKey)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </button>
                  </li>
                ))}
              </ul>
              {attention.length > 12 ? (
                <p className="text-xs text-muted-foreground">
                  …and {attention.length - 12} more in the table below.
                </p>
              ) : null}
            </section>
          ) : null}

          {lateDays.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-bold tracking-tight">
                Late arrivals ({lateDays.length})
              </h2>
              <Card className="divide-y divide-border">
                {lateDays.map((item) => (
                  <div
                    key={item.dateKey}
                    className="flex items-baseline justify-between gap-3 px-3.5 py-2.5"
                  >
                    <p className="text-[13px] font-semibold">
                      {item.dateKey}{' '}
                      <span className="font-normal text-muted-foreground">
                        {WEEKDAY_NAMES[weekdayFromKey(item.dateKey)].slice(0, 3)}
                      </span>
                    </p>
                    <p className="tnum text-right text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </Card>
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-sm font-bold tracking-tight">Daily attendance</h2>
            <DailyTable days={report.days} onSelectDay={setSelectedDate} today={today} />
          </section>

          <p className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground">
            <strong className="font-semibold">Late By</strong> counts minutes after the
            scheduled arrival time of {formatTimeKey(report.policy.expectedCheckIn)}, on days
            that exceeded the {report.policy.gracePeriodMinutes}-minute grace period. Each day
            is classified against the schedule that was in force when it was recorded, so
            changing your settings never rewrites past months.
          </p>
        </>
      ) : null}

      <DayDetailSheet
        day={report?.days.find((day) => day.dateKey === selectedDate) ?? null}
        today={today}
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
      />
    </div>
  )
}

function policyOrdinal(dateKey: DateKey): string {
  const day = Number(dateKey.slice(8, 10))
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th'
  return `${day}${suffix}`
}

function weekdayFromKey(dateKey: DateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  const dow = date.getUTCDay()
  return (dow === 0 ? 7 : dow) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

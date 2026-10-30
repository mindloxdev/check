import * as React from 'react'
import { CalendarOff } from 'lucide-react'
import {
  useMonthlyReport,
  usePolicy,
} from '@/hooks/use-attendance'
import { useMinuteClock } from '@/providers/clock-provider'
import { MonthCalendar } from '@/components/calendar/month-calendar'
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet'
import { MonthSwitcher } from '@/components/reports/month-switcher'
import { StatusLegend } from '@/components/common/status-badge'
import { EmptyState } from '@/components/common/empty-state'
import { PageHeader } from '@/components/common/page-header'
import { ConnectionBanner } from '@/components/common/connection-banner'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/common/stat-card'
import { monthOf, type MonthRef } from '@/lib/report'
import { formatDuration, resolveBusinessDate, type DateKey } from '@/lib/tz'

export function CalendarPage() {
  const { policy } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone, {
    overnightEnabled: policy.overnightEnabled,
    dayCutoffHour: policy.dayCutoffHour,
  })

  const [month, setMonth] = React.useState<MonthRef>(() => monthOf(today))
  const [selectedDate, setSelectedDate] = React.useState<DateKey | null>(null)

  const { report, isLoading, error, refetch } = useMonthlyReport(month)
  const selectedDay = report?.days.find((day) => day.dateKey === selectedDate) ?? null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        description="Tap any day to see its recorded times and corrections."
      />

      <ConnectionBanner />

      <Card className="p-3 sm:p-4">
        <MonthSwitcher month={month} onChange={setMonth} today={today} className="mb-3" />

        {isLoading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, index) => (
              <Skeleton key={index} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={CalendarOff}
            tone="error"
            title="The calendar could not be loaded"
            description={error.message}
            action={
              <Button variant="outline" size="sm" onClick={refetch}>
                Try again
              </Button>
            }
          />
        ) : report ? (
          <>
            <MonthCalendar
              days={report.days}
              today={today}
              selected={selectedDate}
              onSelect={setSelectedDate}
            />
            <StatusLegend className="mt-3 border-t border-border pt-3" />
          </>
        ) : null}
      </Card>

      {report ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            label="Present"
            value={String(report.stats.daysWithAttendance)}
            tone="success"
          />
          <StatCard label="Late" value={String(report.stats.daysLate)} tone="warning" />
          <StatCard
            label="Absent"
            value={String(report.stats.daysAbsent)}
            tone="destructive"
          />
          <StatCard
            label="Hours"
            value={formatDuration(report.stats.totalWorkedMinutes)}
          />
        </div>
      ) : null}

      <DayDetailSheet
        day={selectedDay}
        today={today}
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
      />
    </div>
  )
}

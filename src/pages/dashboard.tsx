import * as React from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, FileBarChart, Inbox, PencilLine } from 'lucide-react'
import { useLiveAttendance, useMonthlyReview, usePolicy, useRangeSummaries } from '@/hooks/use-attendance'
import { useClock } from '@/providers/clock-provider'
import { LiveClock } from '@/components/attendance/live-clock'
import { StatusCard } from '@/components/attendance/status-card'
import { ActionButton } from '@/components/attendance/action-button'
import { PendingIntentsCard } from '@/components/attendance/pending-intents'
import { ManualCorrectionDialog } from '@/components/attendance/manual-correction-dialog'
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet'
import { ConnectionBanner } from '@/components/common/connection-banner'
import { StatCard } from '@/components/common/stat-card'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/common/status-badge'
import { computeStats, monthRange, monthOf } from '@/lib/report'
import {
  type DateKey,
  addDaysToDateKey,
  formatDuration,
  formatShortDate,
  formatClockTime,
  WEEKDAY_SHORT,
} from '@/lib/tz'
import type { DaySummary } from '@/lib/attendance'
import { cn } from '@/lib/utils'

/**
 * The dashboard.
 *
 * Mobile order follows the spec and, more importantly, the workflow: the time
 * and status first, then the single large action within thumb reach, then
 * today's recorded times, then the month summary and recent history.
 */
export function DashboardPage() {
  const { policy, profile } = usePolicy()
  const { now } = useClock()
  const { state, isLoading, businessDate } = useLiveAttendance()
  const review = useMonthlyReview()

  const [correcting, setCorrecting] = React.useState(false)
  const [selectedDate, setSelectedDate] = React.useState<DateKey | null>(null)

  // Recent history: the last two weeks, which is what fits without scrolling far.
  const recentFrom = addDaysToDateKey(businessDate, -13)
  const recent = useRangeSummaries(recentFrom, businessDate)

  // Month-to-date summary.
  const month = monthOf(businessDate)
  const { from: monthFrom, to: monthTo } = monthRange(month)
  const monthDays = useRangeSummaries(monthFrom, monthTo)
  const monthStats = React.useMemo(
    () =>
      monthDays.summaries.length > 0
        ? computeStats(monthDays.summaries, businessDate)
        : null,
    [monthDays.summaries, businessDate],
  )

  const todaySummary = recent.summaries.find((day) => day.dateKey === businessDate) ?? null
  const recentList = React.useMemo(
    () =>
      [...recent.summaries]
        .reverse()
        .filter((day) => day.status !== 'upcoming')
        .slice(0, 7),
    [recent.summaries],
  )

  return (
    <div className="space-y-4 pb-2">
      <ConnectionBanner />
      <PendingIntentsCard />

      <LiveClock />

      <StatusCard state={state} policy={policy} loading={isLoading} />

      <ActionButton
        state={state}
        policy={policy}
        wifiMode={profile?.wifi_mode ?? 'off'}
      />

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setCorrecting(true)}>
          <PencilLine aria-hidden="true" />
          {state.activeRecord ? 'Correct today’s times' : 'Add today’s times manually'}
        </Button>
      </div>

      {review.isAvailable ? (
        <Link
          to="/reports"
          className={cn(
            'flex items-center gap-3 rounded-xl border border-primary/25 bg-primary-soft',
            'px-4 py-3 transition-colors hover:bg-primary-soft/70',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <CalendarClock className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-tight text-primary">
              {review.label} is ready to review
            </span>
            <span className="block text-[11px] leading-tight text-primary/80">
              Available since {review.availableFrom}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
        </Link>
      ) : null}

      {/* ---- Month to date ------------------------------------------------ */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight">This month so far</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/reports">
              <FileBarChart aria-hidden="true" />
              Full report
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            label="Present"
            value={monthStats ? String(monthStats.daysWithAttendance) : '—'}
            hint={
              monthStats
                ? `of ${monthStats.scheduledWorkingDaysElapsed} scheduled`
                : undefined
            }
            tone="success"
            loading={monthDays.isLoading}
          />
          <StatCard
            label="Late"
            value={monthStats ? String(monthStats.daysLate) : '—'}
            hint={monthStats ? `${monthStats.totalLateMinutes}m total` : undefined}
            tone="warning"
            loading={monthDays.isLoading}
          />
          <StatCard
            label="Absent"
            value={monthStats ? String(monthStats.daysAbsent) : '—'}
            hint="Excludes weekends"
            tone="destructive"
            loading={monthDays.isLoading}
          />
          <StatCard
            label="Hours"
            value={monthStats ? formatDuration(monthStats.totalWorkedMinutes) : '—'}
            hint={
              monthStats?.averageWorkedMinutes != null
                ? `${formatDuration(monthStats.averageWorkedMinutes)} avg`
                : 'No completed days'
            }
            tone="default"
            loading={monthDays.isLoading}
          />
        </div>
      </section>

      {/* ---- Recent history ----------------------------------------------- */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold tracking-tight">Recent attendance</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/history">
              View all
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {recent.isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : recentList.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No attendance recorded yet"
            description="Tap Check In when you arrive at the office and your first day will appear here."
          />
        ) : (
          <ul className="space-y-1.5">
            {recentList.map((day) => (
              <li key={day.dateKey}>
                <RecentRow day={day} onSelect={setSelectedDate} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Policy reminder ---------------------------------------------- */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-[13px]">Your schedule</CardTitle>
          <CardDescription>
            {policy.workingDays.map((d) => WEEKDAY_SHORT[d]).join(', ')} ·{' '}
            {policy.expectedCheckIn}–{policy.expectedCheckOut} ·{' '}
            {policy.gracePeriodMinutes} min grace · {policy.timeZone}
            {' · '}
            <Link to="/settings" className="font-semibold text-primary hover:underline">
              Change
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>

      <ManualCorrectionDialog
        open={correcting}
        onOpenChange={setCorrecting}
        date={businessDate}
        record={todaySummary?.primaryRecord ?? state.activeRecord}
        today={businessDate}
      />

      <DayDetailSheet
        day={recent.summaries.find((day) => day.dateKey === selectedDate) ?? null}
        today={businessDate}
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
      />

      <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
        Recorded times come from the server clock at{' '}
        {formatClockTime(now, policy.timeZone)} — never from this device.
      </p>
    </div>
  )
}

function RecentRow({
  day,
  onSelect,
}: {
  day: DaySummary
  onSelect: (dateKey: DateKey) => void
}) {
  const tz = day.policy.timeZone
  return (
    <button
      type="button"
      onClick={() => onSelect(day.dateKey)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border',
        'bg-card px-3 py-2.5 text-left shadow-card transition-colors active:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="w-11 shrink-0">
        <p className="text-[13px] font-bold leading-tight">{formatShortDate(day.dateKey)}</p>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          {WEEKDAY_SHORT[day.weekday]}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <StatusBadge status={day.status} corrected={day.manuallyCorrected} />
        <p className="tnum truncate text-xs text-muted-foreground">
          {day.checkInAt ? formatClockTime(day.checkInAt, tz) : '—'}
          {' → '}
          {day.checkOutAt ? formatClockTime(day.checkOutAt, tz) : '—'}
        </p>
      </div>

      <p className="tnum shrink-0 text-right text-[13px] font-bold">
        {day.workedMinutes != null ? formatDuration(day.workedMinutes) : '—'}
      </p>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

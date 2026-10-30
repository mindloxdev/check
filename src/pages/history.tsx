import * as React from 'react'
import { Download, Inbox, Search, X } from 'lucide-react'
import { usePolicy, useRangeSummaries } from '@/hooks/use-attendance'
import { useMinuteClock } from '@/providers/clock-provider'
import { DailyTable } from '@/components/reports/daily-table'
import { DayDetailSheet } from '@/components/calendar/day-detail-sheet'
import { PageHeader } from '@/components/common/page-header'
import { ConnectionBanner } from '@/components/common/connection-banner'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { downloadDailyTableCsv } from '@/lib/export'
import { buildMonthlyReport, monthOf, type MonthRef } from '@/lib/report'
import {
  type DateKey,
  addDaysToDateKey,
  compareDateKeys,
  formatMonthLabel,
  isDateKey,
  monthKeysBack,
  resolveBusinessDate,
} from '@/lib/tz'
import type { DaySummary } from '@/lib/attendance'

type RangePreset = '30d' | '90d' | '6m' | '12m' | 'month'

const PRESET_LABEL: Record<RangePreset, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  month: 'A specific month',
}

/**
 * Attendance history.
 *
 * The window is bounded by a range preset rather than fetching everything: a
 * year of daily rows is ~250 records, which is a single cheap query, while an
 * unbounded "all time" would grow without limit. The selected range is what
 * gets exported, so the CSV always matches what is on screen.
 */
export function HistoryPage() {
  const { policy } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone, {
    overnightEnabled: policy.overnightEnabled,
    dayCutoffHour: policy.dayCutoffHour,
  })

  const [preset, setPreset] = React.useState<RangePreset>('30d')
  const [month, setMonth] = React.useState<MonthRef>(() => monthOf(today))
  const [search, setSearch] = React.useState('')
  const [selectedDate, setSelectedDate] = React.useState<DateKey | null>(null)

  const { from, to } = React.useMemo(
    () => resolveRange(preset, month, today),
    [preset, month, today],
  )

  const { summaries, isLoading, error } = useRangeSummaries(from, to)

  // Search matches any ISO prefix: '2026', '2026-10' or a full date.
  const filtered = React.useMemo(() => {
    const query = search.trim()
    if (query === '') return summaries
    return summaries.filter((day) => day.dateKey.includes(query))
  }, [summaries, search])

  // Only days with something recorded, or a status worth seeing.
  const meaningful = React.useMemo(
    () => filtered.filter((day) => day.status !== 'upcoming'),
    [filtered],
  )

  const monthOptions = React.useMemo(() => monthKeysBack(today, 24), [today])

  const exportVisible = () => {
    // Reuse the monthly-report pipeline so the CSV columns are identical to the
    // ones the Reports page exports.
    const pseudoReport = buildMonthlyReport({
      month: monthOf(from),
      records: [],
      holidays: [],
      leaves: [],
      policy,
      now,
    })
    downloadDailyTableCsv(
      { ...pseudoReport, days: meaningful, label: `${from} to ${to}` },
      `attendance-${from}-to-${to}.csv`,
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="History"
        description="Every recorded attendance session, searchable and exportable."
        actions={
          meaningful.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportVisible}>
              <Download aria-hidden="true" />
              Export
            </Button>
          ) : undefined
        }
      />

      <ConnectionBanner />

      <Card className="space-y-3 p-3 sm:p-4">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="history-range"
              className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              Range
            </label>
            <Select value={preset} onValueChange={(value) => setPreset(value as RangePreset)}>
              <SelectTrigger id="history-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESET_LABEL) as RangePreset[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {PRESET_LABEL[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preset === 'month' ? (
            <div className="space-y-1.5">
              <label
                htmlFor="history-month"
                className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
              >
                Month
              </label>
              <Select
                value={`${month.year}-${String(month.month).padStart(2, '0')}`}
                onValueChange={(value) => {
                  const [year, monthPart] = value.split('-')
                  setMonth({ year: Number(year), month: Number(monthPart) })
                }}
              >
                <SelectTrigger id="history-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {formatMonthLabel(
                        Number(option.slice(0, 4)),
                        Number(option.slice(5, 7)),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="history-search"
                className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
              >
                Search by date
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="history-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="2026-10 or 2026-10-14"
                  inputMode="numeric"
                  className="pl-9 pr-9"
                  invalid={search.length >= 10 && !isDateKey(search.trim())}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          {from} to {to} · {meaningful.length}{' '}
          {meaningful.length === 1 ? 'day' : 'days'}
        </p>
      </Card>

      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={Inbox}
          tone="error"
          title="History could not be loaded"
          description="Check your connection and try again."
        />
      ) : meaningful.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={search ? 'No days match that search' : 'Nothing recorded in this range'}
          description={
            search
              ? 'Try a shorter date fragment, such as 2026-10.'
              : 'Pick a wider range, or check in from the dashboard to start building your history.'
          }
          action={
            search ? (
              <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DailyTable days={meaningful} onSelectDay={setSelectedDate} today={today} />
      )}

      <DayDetailSheet
        day={summaries.find((day: DaySummary) => day.dateKey === selectedDate) ?? null}
        today={today}
        open={selectedDate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
      />
    </div>
  )
}

function resolveRange(
  preset: RangePreset,
  month: MonthRef,
  today: DateKey,
): { from: DateKey; to: DateKey } {
  if (preset === 'month') {
    const first = `${month.year}-${String(month.month).padStart(2, '0')}-01` as DateKey
    const last = addDaysToDateKey(
      `${month.month === 12 ? month.year + 1 : month.year}-${String(
        month.month === 12 ? 1 : month.month + 1,
      ).padStart(2, '0')}-01` as DateKey,
      -1,
    )
    return { from: first, to: compareDateKeys(last, today) > 0 ? today : last }
  }

  const days = preset === '30d' ? 29 : preset === '90d' ? 89 : preset === '6m' ? 182 : 364
  return { from: addDaysToDateKey(today, -days), to: today }
}

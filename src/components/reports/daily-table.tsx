import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Filter, ListFilter } from 'lucide-react'
import {
  DAY_STATUSES,
  STATUS_PRESENTATION,
  type DayStatus,
  type DaySummary,
} from '@/lib/attendance'
import { WEEKDAY_SHORT, formatClockTime, formatDuration, type DateKey } from '@/lib/tz'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/common/status-badge'
import { EmptyState } from '@/components/common/empty-state'
import { cn } from '@/lib/utils'

export type SortKey = 'date' | 'checkIn' | 'duration' | 'late'
export type SortDirection = 'asc' | 'desc'

export interface DailyTableProps {
  days: DaySummary[]
  onSelectDay: (dateKey: DateKey) => void
  today: DateKey
  className?: string
  /** Hides the filter bar for the print view. */
  compact?: boolean
}

/**
 * The daily attendance table.
 *
 * On a phone this renders as a list of tappable rows rather than a horizontally
 * scrolling grid — a 7-column table at 375 px is unreadable, and the page must
 * never scroll sideways. From `sm:` up it becomes a real table with a sortable
 * header. Both layouts come from the same data and the same sort.
 */
export function DailyTable({
  days,
  onSelectDay,
  today,
  className,
  compact,
}: DailyTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>('date')
  const [direction, setDirection] = React.useState<SortDirection>('asc')
  const [hidden, setHidden] = React.useState<Set<DayStatus>>(
    // Future days carry no information in a report table, so they start hidden.
    () => new Set<DayStatus>(['upcoming']),
  )

  const visible = React.useMemo(() => {
    const filtered = days.filter((day) => !hidden.has(day.status))
    return sortDays(filtered, sortKey, direction)
  }, [days, hidden, sortKey, direction])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setDirection(key === 'date' ? 'asc' : 'desc')
    }
  }

  const presentStatuses = React.useMemo(() => {
    const seen = new Set<DayStatus>()
    for (const day of days) seen.add(day.status)
    return DAY_STATUSES.filter((status) => seen.has(status))
  }, [days])

  return (
    <div className={cn('space-y-3', className)}>
      {!compact ? (
        <div className="no-print flex items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            {visible.length} of {days.length} days shown
          </p>
          <div className="flex items-center gap-1.5">
            <SortMenu sortKey={sortKey} direction={direction} onSort={toggleSort} />
            <StatusFilter
              statuses={presentStatuses}
              hidden={hidden}
              onChange={setHidden}
            />
          </div>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="Every row is filtered out"
          description="Clear a status filter to see attendance again."
          action={
            <Button variant="outline" size="sm" onClick={() => setHidden(new Set())}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Phone layout: a list of rows. */}
          <ul className="space-y-1.5 sm:hidden">
            {visible.map((day) => (
              <li key={day.dateKey}>
                <MobileRow
                  day={day}
                  isToday={day.dateKey === today}
                  onSelect={onSelectDay}
                />
              </li>
            ))}
          </ul>

          {/* Tablet and up: a real table. */}
          <div className="hidden overflow-hidden rounded-xl border border-border sm:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Daily attendance. Late By counts minutes after the scheduled arrival time on
                days that exceeded the grace period.
              </caption>
              <thead className="bg-muted/70">
                <tr>
                  <HeaderCell
                    label="Date"
                    sortKey="date"
                    active={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <th scope="col" className={headerClass}>
                    Day
                  </th>
                  <HeaderCell
                    label="Check In"
                    sortKey="checkIn"
                    active={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                  />
                  <th scope="col" className={headerClass}>
                    Check Out
                  </th>
                  <HeaderCell
                    label="Duration"
                    sortKey="duration"
                    active={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="right"
                  />
                  <HeaderCell
                    label="Late By"
                    sortKey="late"
                    active={sortKey}
                    direction={direction}
                    onSort={toggleSort}
                    align="right"
                  />
                  <th scope="col" className={headerClass}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((day) => (
                  <DesktopRow
                    key={day.dateKey}
                    day={day}
                    isToday={day.dateKey === today}
                    onSelect={onSelectDay}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const headerClass =
  'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground'

function HeaderCell({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === sortKey
  return (
    <th
      scope="col"
      className={cn(headerClass, align === 'right' && 'text-right')}
      aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded uppercase tracking-wide',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive ? 'text-foreground' : 'hover:text-foreground',
        )}
      >
        {label}
        {isActive ? (
          direction === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  )
}

function DesktopRow({
  day,
  isToday,
  onSelect,
}: {
  day: DaySummary
  isToday: boolean
  onSelect: (dateKey: DateKey) => void
}) {
  const tz = day.policy.timeZone
  return (
    <tr
      onClick={() => onSelect(day.dateKey)}
      tabIndex={0}
      role="button"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(day.dateKey)
        }
      }}
      className={cn(
        'cursor-pointer border-t border-border transition-colors',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-inset focus-visible:ring-ring',
        isToday && 'bg-primary-soft/60',
      )}
    >
      <td className="tnum px-3 py-2.5 font-semibold">{day.dateKey.slice(5)}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{WEEKDAY_SHORT[day.weekday]}</td>
      <td className="tnum px-3 py-2.5">
        {day.checkInAt ? formatClockTime(day.checkInAt, tz) : '—'}
      </td>
      <td className="tnum px-3 py-2.5">
        {day.checkOutAt ? formatClockTime(day.checkOutAt, tz) : '—'}
      </td>
      <td className="tnum px-3 py-2.5 text-right">
        {day.status === 'missing_check_out' || day.status === 'checked_in'
          ? 'Incomplete'
          : formatDuration(day.workedMinutes)}
      </td>
      <td className="tnum px-3 py-2.5 text-right">
        {day.late.isLate ? (
          <span className="font-semibold text-warning-soft-foreground">
            {day.late.minutesAfterSchedule}m
          </span>
        ) : (
          <span className="text-muted-foreground">0m</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={day.status} corrected={day.manuallyCorrected} />
      </td>
    </tr>
  )
}

function MobileRow({
  day,
  isToday,
  onSelect,
}: {
  day: DaySummary
  isToday: boolean
  onSelect: (dateKey: DateKey) => void
}) {
  const tz = day.policy.timeZone
  return (
    <button
      type="button"
      onClick={() => onSelect(day.dateKey)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border',
        'bg-card px-3 py-2.5 text-left transition-colors active:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isToday && 'border-primary/40 bg-primary-soft/50',
      )}
    >
      <div className="w-10 shrink-0 text-center">
        <p className="tnum text-base font-bold leading-none">
          {Number(day.dateKey.slice(8, 10))}
        </p>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">
          {WEEKDAY_SHORT[day.weekday]}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={day.status} corrected={day.manuallyCorrected} />
          {day.late.isLate ? (
            <Badge variant="warning" className="border">
              {day.late.minutesAfterSchedule}m late
            </Badge>
          ) : null}
        </div>
        <p className="tnum truncate text-xs text-muted-foreground">
          {day.checkInAt ? formatClockTime(day.checkInAt, tz) : '—'}
          {' → '}
          {day.checkOutAt ? formatClockTime(day.checkOutAt, tz) : '—'}
          {day.workedMinutes != null ? ` · ${formatDuration(day.workedMinutes)}` : ''}
        </p>
      </div>

      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

function SortMenu({
  sortKey,
  direction,
  onSort,
}: {
  sortKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
}) {
  const options: Array<{ key: SortKey; label: string }> = [
    { key: 'date', label: 'Date' },
    { key: 'checkIn', label: 'Check-in time' },
    { key: 'duration', label: 'Duration' },
    { key: 'late', label: 'Late by' },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilter aria-hidden="true" />
          Sort
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Sort by
        </p>
        <div className="space-y-0.5">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onSort(option.key)}
              className={cn(
                'flex min-h-10 w-full cursor-pointer items-center justify-between rounded-lg',
                'px-2.5 text-sm transition-colors hover:bg-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                sortKey === option.key && 'font-semibold text-primary',
              )}
            >
              {option.label}
              {sortKey === option.key ? (
                direction === 'asc' ? (
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                )
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function StatusFilter({
  statuses,
  hidden,
  onChange,
}: {
  statuses: readonly DayStatus[]
  hidden: Set<DayStatus>
  onChange: (next: Set<DayStatus>) => void
}) {
  const activeCount = statuses.filter((status) => !hidden.has(status)).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter aria-hidden="true" />
          Filter
          {hidden.size > 0 ? (
            <Badge variant="default" className="ml-0.5 border-0 px-1.5">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Show statuses
          </p>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="cursor-pointer text-[11px] font-semibold text-primary hover:underline"
          >
            All
          </button>
        </div>
        <div className="space-y-0.5">
          {statuses.map((status) => {
            const id = `filter-${status}`
            return (
              <div
                key={status}
                className="flex min-h-10 items-center gap-2.5 rounded-lg px-1.5"
              >
                <Checkbox
                  id={id}
                  checked={!hidden.has(status)}
                  onCheckedChange={(checked) => {
                    const next = new Set(hidden)
                    if (checked === true) next.delete(status)
                    else next.add(status)
                    onChange(next)
                  }}
                />
                <Label htmlFor={id} className="flex-1 cursor-pointer font-medium">
                  {STATUS_PRESENTATION[status].label}
                </Label>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Sorts without mutating, pushing days that have no value for the key last. */
export function sortDays(
  days: DaySummary[],
  key: SortKey,
  direction: SortDirection,
): DaySummary[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...days].sort((a, b) => {
    if (key === 'date') return sign * a.dateKey.localeCompare(b.dateKey)

    const valueA = metric(a, key)
    const valueB = metric(b, key)
    // A missing value sorts last whichever way the column is pointing, so the
    // top of the table is always the interesting end.
    if (valueA == null && valueB == null) return a.dateKey.localeCompare(b.dateKey)
    if (valueA == null) return 1
    if (valueB == null) return -1
    if (valueA === valueB) return a.dateKey.localeCompare(b.dateKey)
    return sign * (valueA - valueB)
  })
}

function metric(day: DaySummary, key: SortKey): number | null {
  switch (key) {
    case 'checkIn':
      return day.checkInAt ? day.checkInAt.getTime() : null
    case 'duration':
      return day.workedMinutes
    case 'late':
      return day.late.isLate ? day.late.minutesAfterSchedule : null
    default:
      return null
  }
}

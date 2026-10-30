import * as React from 'react'
import { STATUS_PRESENTATION, type DaySummary } from '@/lib/attendance'
import { WEEKDAY_SHORT, type DateKey, type IsoWeekday, weekdayOfDateKey } from '@/lib/tz'
import { cn } from '@/lib/utils'

export interface MonthCalendarProps {
  days: DaySummary[]
  /** Business date of today, highlighted with a ring. */
  today: DateKey
  selected?: DateKey | null
  onSelect: (dateKey: DateKey) => void
  className?: string
}

/**
 * The attendance calendar.
 *
 * Accessibility and interaction notes:
 *   - Rendered as a real `<table>` with a `columnheader` row, which is how a
 *     screen reader announces "Thursday, 29" rather than a bare number.
 *   - Each day is a button sized at least 44 px, with the status spelled out in
 *     its accessible name — the colour is a shortcut for sighted users, not the
 *     only signal.
 *   - Arrow keys move by day and week, so the grid is navigable without a
 *     pointer. Only one cell is in the tab order at a time (a roving tabindex),
 *     so Tab does not have to cross 31 stops to leave the calendar.
 */
export function MonthCalendar({
  days,
  today,
  selected,
  onSelect,
  className,
}: MonthCalendarProps) {
  const containerRef = React.useRef<HTMLTableSectionElement>(null)
  const [focusedDate, setFocusedDate] = React.useState<DateKey | null>(null)

  const byDate = React.useMemo(() => {
    const map = new Map<DateKey, DaySummary>()
    for (const day of days) map.set(day.dateKey, day)
    return map
  }, [days])

  // The roving tab stop: the selection, else today if it is in this month,
  // else the first day.
  const tabStop =
    (selected && byDate.has(selected) ? selected : null) ??
    (byDate.has(today) ? today : null) ??
    days[0]?.dateKey ??
    null

  const weeks = React.useMemo(() => buildWeeks(days), [days])

  const moveFocus = (from: DateKey, deltaDays: number) => {
    const index = days.findIndex((day) => day.dateKey === from)
    if (index < 0) return
    const target = days[index + deltaDays]
    if (!target) return
    setFocusedDate(target.dateKey)
    const button = containerRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${target.dateKey}"]`,
    )
    button?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, dateKey: DateKey) => {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const delta = deltas[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      moveFocus(dateKey, delta)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      const first = days[0]
      if (first) moveFocus(dateKey, days.indexOf(first) - days.findIndex((d) => d.dateKey === dateKey))
    }
    if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = days.length - 1
      moveFocus(dateKey, lastIndex - days.findIndex((d) => d.dateKey === dateKey))
    }
  }

  return (
    <table className={cn('w-full border-separate border-spacing-1', className)}>
      <thead>
        <tr>
          {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((weekday) => (
            <th
              key={weekday}
              scope="col"
              className="pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              <span aria-hidden="true">{WEEKDAY_SHORT[weekday].slice(0, 1)}</span>
              <span className="sr-only">{WEEKDAY_SHORT[weekday]}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody ref={containerRef}>
        {weeks.map((week, weekIndex) => (
          <tr key={weekIndex}>
            {week.map((dateKey, dayIndex) =>
              dateKey === null ? (
                <td key={`pad-${weekIndex}-${dayIndex}`} />
              ) : (
                <td key={dateKey} className="p-0 align-top">
                  <DayCell
                    day={byDate.get(dateKey)!}
                    isToday={dateKey === today}
                    isSelected={dateKey === selected}
                    tabIndex={
                      (focusedDate ?? tabStop) === dateKey ? 0 : -1
                    }
                    onSelect={onSelect}
                    onKeyDown={onKeyDown}
                  />
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface DayCellProps {
  day: DaySummary
  isToday: boolean
  isSelected: boolean
  tabIndex: number
  onSelect: (dateKey: DateKey) => void
  onKeyDown: (event: React.KeyboardEvent, dateKey: DateKey) => void
}

const DayCell = React.memo(function DayCell({
  day,
  isToday,
  isSelected,
  tabIndex,
  onSelect,
  onKeyDown,
}: DayCellProps) {
  const presentation = STATUS_PRESENTATION[day.status]
  const dayOfMonth = Number(day.dateKey.slice(8, 10))
  const empty = day.status === 'upcoming'

  return (
    <button
      type="button"
      data-date={day.dateKey}
      tabIndex={tabIndex}
      onClick={() => onSelect(day.dateKey)}
      onKeyDown={(event) => onKeyDown(event, day.dateKey)}
      aria-pressed={isSelected}
      // The accessible name carries the status, so colour is never the only cue.
      aria-label={`${dayOfMonth} ${presentation.label}${isToday ? ', today' : ''}${
        day.manuallyCorrected ? ', manually corrected' : ''
      }`}
      className={cn(
        // A 44 px minimum square: the WCAG and platform target size.
        'relative flex aspect-square min-h-11 w-full cursor-pointer flex-col items-center',
        'justify-center gap-1 rounded-xl border text-sm font-semibold',
        'transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        empty
          ? 'border-transparent bg-transparent text-muted-foreground/50'
          : cn('border', presentation.badgeClass, 'hover:brightness-[0.97]'),
        isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        isToday && !isSelected && 'ring-2 ring-foreground/25 ring-offset-1 ring-offset-background',
      )}
    >
      <span className="tnum leading-none">{dayOfMonth}</span>

      {/* A second, non-colour signal: a filled dot for a recorded day, a hollow
          one for a day that still needs attention. */}
      {empty ? null : (
        <span
          className={cn(
            'size-1.5 rounded-full',
            day.status === 'weekend' || day.status === 'holiday'
              ? 'bg-current opacity-30'
              : 'bg-current opacity-80',
          )}
          aria-hidden="true"
        />
      )}

      {day.manuallyCorrected ? (
        <span
          className="absolute right-1 top-1 size-1.5 rotate-45 bg-current opacity-60"
          aria-hidden="true"
          title="Manually corrected"
        />
      ) : null}
    </button>
  )
})

/** Lays the month out into Monday-first weeks, padding the leading/trailing gaps. */
function buildWeeks(days: DaySummary[]): Array<Array<DateKey | null>> {
  if (days.length === 0) return []
  const first = days[0]!.dateKey
  const leading = weekdayOfDateKey(first) - 1 // Monday = 0 pads

  const cells: Array<DateKey | null> = [
    ...Array.from({ length: leading }, () => null),
    ...days.map((day) => day.dateKey),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: Array<Array<DateKey | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

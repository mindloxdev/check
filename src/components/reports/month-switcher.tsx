import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type MonthRef,
  compareMonths,
  isCurrentOrPastMonth,
  monthOf,
  shiftMonth,
} from '@/lib/report'
import { formatMonthLabel, type DateKey } from '@/lib/tz'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface MonthSwitcherProps {
  month: MonthRef
  onChange: (month: MonthRef) => void
  today: DateKey
  className?: string
}

/**
 * Month navigation.
 *
 * Forward navigation stops at the current month: there is no attendance to
 * report on a month that has not happened, and offering it would only produce a
 * grid of empty "upcoming" days.
 */
export function MonthSwitcher({ month, onChange, today, className }: MonthSwitcherProps) {
  const next = shiftMonth(month, 1)
  const canGoForward = isCurrentOrPastMonth(next, today)
  const isCurrent = compareMonths(month, monthOf(today)) === 0

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label={`Previous month, ${formatMonthLabel(
          shiftMonth(month, -1).year,
          shiftMonth(month, -1).month,
        )}`}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-1 flex-col items-center">
        <p
          className="truncate text-sm font-bold tracking-tight"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatMonthLabel(month.year, month.month)}
        </p>
        {!isCurrent ? (
          <button
            type="button"
            onClick={() => onChange(monthOf(today))}
            className="cursor-pointer text-[11px] font-semibold text-primary hover:underline"
          >
            Back to this month
          </button>
        ) : (
          <p className="text-[11px] text-muted-foreground">Current month</p>
        )}
      </div>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onChange(next)}
        disabled={!canGoForward}
        aria-label={
          canGoForward
            ? `Next month, ${formatMonthLabel(next.year, next.month)}`
            : 'Next month is not available yet'
        }
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}

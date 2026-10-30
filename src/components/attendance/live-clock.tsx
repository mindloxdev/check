import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { useClock } from '@/providers/clock-provider'
import { usePolicy } from '@/hooks/use-attendance'
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  formatClockTimeWithSeconds,
  formatZoneOffset,
  zonedParts,
} from '@/lib/tz'
import { cn } from '@/lib/utils'

/**
 * The live clock.
 *
 * The time comes from the server-anchored clock, never from `Date.now()`, and
 * the badge states plainly which source is in use. `tabular-nums` keeps the
 * digits from shifting width as the seconds tick, which would otherwise make
 * the whole card jitter once a second.
 */
export function LiveClock({ className }: { className?: string }) {
  const { now, trust } = useClock()
  const { policy } = usePolicy()
  const parts = zonedParts(now, policy.timeZone)

  const weekday = WEEKDAY_NAMES[parts.weekday]
  const month = MONTH_NAMES[parts.month - 1]

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-semibold text-muted-foreground">
          {weekday}, {month} {parts.day}, {parts.year}
        </p>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
            trust === 'server'
              ? 'border-success/20 bg-success-soft text-success-soft-foreground'
              : 'border-caution/20 bg-caution-soft text-caution-soft-foreground',
          )}
          title={
            trust === 'server'
              ? 'The time shown comes from the server clock.'
              : 'The server clock is unreachable, so this device’s clock is shown.'
          }
        >
          {trust === 'server' ? (
            <ShieldCheck className="size-3" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-3" aria-hidden="true" />
          )}
          {trust === 'server' ? 'Server time' : 'Device time'}
        </span>
      </div>

      <p
        className="tnum text-display-clock text-foreground"
        // The seconds change every second; announcing that would be hostile to
        // a screen-reader user, so the live clock is not a live region.
        aria-live="off"
      >
        {formatClockTimeWithSeconds(now, policy.timeZone)}
      </p>

      <p className="text-[11px] text-muted-foreground">
        {policy.timeZone} · {formatZoneOffset(now, policy.timeZone)}
      </p>
    </div>
  )
}

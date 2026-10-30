import { AlertTriangle, ShieldCheck, ShieldX, Timer } from 'lucide-react'
import {
  LIVE_STATUS_LABEL,
  VERIFICATION_LABEL,
  type AttendancePolicy,
  type LiveState,
} from '@/lib/attendance'
import { formatClockTime, formatDuration, formatLongDate, formatTimeKey } from '@/lib/tz'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<
  LiveState['status'],
  { badge: string; rail: string; icon: string }
> = {
  not_checked_in: {
    badge: 'border-border bg-muted text-muted-foreground',
    rail: 'bg-muted-foreground/30',
    icon: 'bg-muted text-muted-foreground',
  },
  checked_in: {
    badge: 'border-success/25 bg-success-soft text-success-soft-foreground',
    rail: 'bg-success',
    icon: 'bg-success-soft text-success-soft-foreground',
  },
  checked_out: {
    badge: 'border-primary/25 bg-primary-soft text-primary',
    rail: 'bg-primary',
    icon: 'bg-primary-soft text-primary',
  },
  incomplete: {
    badge: 'border-caution/25 bg-caution-soft text-caution-soft-foreground',
    rail: 'bg-caution',
    icon: 'bg-caution-soft text-caution-soft-foreground',
  },
}

export interface StatusCardProps {
  state: LiveState
  policy: AttendancePolicy
  loading?: boolean
  className?: string
}

/**
 * The prominent status card: what today looks like, in one glance.
 *
 * Every value is either a real recorded time or an em dash. Nothing is ever
 * guessed or filled in optimistically — "—" means "not recorded".
 */
export function StatusCard({ state, policy, loading, className }: StatusCardProps) {
  const style = STATUS_STYLE[state.status]
  const tz = policy.timeZone

  if (loading) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <div className="space-y-4 p-4 sm:p-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-7 w-36" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      {/* A colour rail gives the card its state at a glance; the text badge
          below carries the same information for anyone who cannot see it. */}
      <span className={cn('absolute inset-y-0 left-0 w-1', style.rail)} aria-hidden="true" />

      <div className="space-y-4 p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] font-medium text-muted-foreground">
              {formatLongDate(state.businessDate)}
            </p>
            <h2 className="text-lg font-bold leading-tight tracking-tight">
              {LIVE_STATUS_LABEL[state.status]}
            </h2>
          </div>
          <Badge className={cn('border shrink-0', style.badge)}>
            {LIVE_STATUS_LABEL[state.status]}
          </Badge>
        </div>

        {state.staleOpenSessionFrom ? (
          <div className="flex items-start gap-2 rounded-lg border border-caution/25 bg-caution-soft px-3 py-2 text-caution-soft-foreground">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              This session started on{' '}
              <strong className="font-semibold">{state.staleOpenSessionFrom}</strong> and was
              never closed. Checking out now records a very long day — consider correcting it
              from History instead.
            </p>
          </div>
        ) : null}

        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <Metric
            label="Check in"
            value={state.checkInAt ? formatClockTime(state.checkInAt, tz) : '—'}
            sub={
              state.late.isLate
                ? `${state.late.minutesAfterSchedule}m late`
                : state.checkInAt
                  ? 'On time'
                  : `Due ${formatTimeKey(policy.expectedCheckIn)}`
            }
            subTone={state.late.isLate ? 'warning' : 'muted'}
          />
          <Metric
            label="Check out"
            value={state.checkOutAt ? formatClockTime(state.checkOutAt, tz) : '—'}
            sub={
              state.checkOutAt ? 'Recorded' : `Due ${formatTimeKey(policy.expectedCheckOut)}`
            }
            subTone="muted"
          />
          <Metric
            label={state.status === 'checked_in' ? 'Elapsed' : 'Total'}
            value={formatDuration(state.elapsedMinutes)}
            sub={state.status === 'checked_in' ? 'Still running' : 'Working time'}
            subTone="muted"
            icon={state.status === 'checked_in' ? Timer : undefined}
          />
        </dl>

        {state.activeRecord ? (
          <VerificationRow state={state} />
        ) : null}
      </div>
    </Card>
  )
}

function Metric({
  label,
  value,
  sub,
  subTone,
  icon: Icon,
}: {
  label: string
  value: string
  sub: string
  subTone: 'muted' | 'warning'
  icon?: typeof Timer
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd className="tnum mt-0.5 truncate text-[15px] font-bold leading-tight text-foreground">
        {value}
      </dd>
      <dd
        className={cn(
          'mt-0.5 truncate text-[10px] leading-tight',
          subTone === 'warning'
            ? 'font-semibold text-warning-soft-foreground'
            : 'text-muted-foreground',
        )}
      >
        {sub}
      </dd>
    </div>
  )
}

function VerificationRow({ state }: { state: LiveState }) {
  const status = state.activeRecord?.check_in_verification_status
  if (!status) return null

  const verified = status === 'verified'
  const failed = status === 'failed'

  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      {verified ? (
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <ShieldX
          className={cn('size-4 shrink-0', failed ? 'text-warning' : 'text-muted-foreground')}
          aria-hidden="true"
        />
      )}
      <p className="text-xs text-muted-foreground">
        {VERIFICATION_LABEL[status]}
        {state.activeRecord?.check_in_source === 'manual' ? ' · entered manually' : ''}
        {state.activeRecord?.check_in_source === 'offline_sync'
          ? ' · reconciled from an offline tap'
          : ''}
      </p>
    </div>
  )
}

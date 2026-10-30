import { ArrowRight, FileClock } from 'lucide-react'
import { useAuditLog } from '@/hooks/use-attendance'
import { usePolicy } from '@/hooks/use-attendance'
import { Skeleton } from '@/components/ui/skeleton'
import { formatClockTime } from '@/lib/tz'
import type { AuditAction, AuditLogRow } from '@/types/database'
import { cn } from '@/lib/utils'

const ACTION_LABEL: Record<AuditAction, string> = {
  check_in: 'Checked in',
  check_out: 'Checked out',
  manual_correction: 'Manually corrected',
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
}

const ACTION_TONE: Record<AuditAction, string> = {
  check_in: 'bg-success-soft text-success-soft-foreground',
  check_out: 'bg-primary-soft text-primary',
  manual_correction: 'bg-caution-soft text-caution-soft-foreground',
  create: 'bg-muted text-muted-foreground',
  update: 'bg-muted text-muted-foreground',
  delete: 'bg-destructive-soft text-destructive-soft-foreground',
}

/** Fields worth rendering as a before/after pair, in a sensible reading order. */
const TRACKED_FIELDS: Array<{ key: string; label: string; kind: 'time' | 'text' | 'minutes' }> = [
  { key: 'check_in_at', label: 'Check in', kind: 'time' },
  { key: 'check_out_at', label: 'Check out', kind: 'time' },
  { key: 'attendance_date', label: 'Date', kind: 'text' },
  { key: 'duration_minutes', label: 'Duration', kind: 'minutes' },
  { key: 'note', label: 'Note', kind: 'text' },
]

export function AuditTrail({
  recordId,
  className,
}: {
  recordId: string
  className?: string
}) {
  const { data, isLoading, error } = useAuditLog(recordId)
  const { policy } = usePolicy()

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    )
  }

  if (error) {
    return (
      <p className={cn('text-xs text-destructive', className)}>
        The change history could not be loaded.
      </p>
    )
  }

  if (!data || data.length === 0) {
    return (
      <p className={cn('text-xs text-muted-foreground', className)}>
        No changes recorded for this day yet.
      </p>
    )
  }

  return (
    <ol className={cn('space-y-2', className)}>
      {data.map((entry) => (
        <li
          key={entry.id}
          className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                ACTION_TONE[entry.action],
              )}
            >
              <FileClock className="size-3" aria-hidden="true" />
              {ACTION_LABEL[entry.action]}
            </span>
            <time
              dateTime={entry.created_at}
              className="tnum text-[11px] text-muted-foreground"
            >
              {formatClockTime(new Date(entry.created_at), policy.timeZone)} ·{' '}
              {entry.created_at.slice(0, 10)}
            </time>
          </div>

          <Changes entry={entry} timeZone={policy.timeZone} />

          {entry.reason ? (
            <p className="mt-1.5 text-xs italic leading-relaxed text-muted-foreground">
              “{entry.reason}”
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Changes({ entry, timeZone }: { entry: AuditLogRow; timeZone: string }) {
  const previous = entry.previous_values ?? {}
  const next = entry.new_values ?? {}
  const rows = TRACKED_FIELDS.filter(
    (field) => field.key in previous || field.key in next,
  )

  if (rows.length === 0) return null

  return (
    <dl className="mt-1.5 space-y-1">
      {rows.map((field) => (
        <div key={field.key} className="flex flex-wrap items-baseline gap-1.5 text-xs">
          <dt className="font-semibold text-muted-foreground">{field.label}</dt>
          <dd className="tnum text-muted-foreground line-through decoration-muted-foreground/60">
            {render(previous[field.key], field.kind, timeZone)}
          </dd>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="tnum font-semibold text-foreground">
            {render(next[field.key], field.kind, timeZone)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function render(value: unknown, kind: 'time' | 'text' | 'minutes', timeZone: string): string {
  if (value == null || value === '') return '—'
  if (kind === 'time' && typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : formatClockTime(date, timeZone)
  }
  if (kind === 'minutes' && typeof value === 'number') {
    const hours = Math.floor(value / 60)
    const minutes = value % 60
    return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
  }
  return String(value)
}

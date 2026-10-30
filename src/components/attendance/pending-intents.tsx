import * as React from 'react'
import { CloudUpload, Trash2, TriangleAlert } from 'lucide-react'
import {
  buildReconciliationPlans,
  clearPendingIntents,
  listPendingIntents,
  removePendingIntent,
  type PendingIntent,
} from '@/lib/offline'
import { useManualCorrection } from '@/hooks/use-attendance'
import { useOnline } from '@/providers/online-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatLongDate, formatTimeKey } from '@/lib/tz'
import { cn } from '@/lib/utils'

/**
 * Offline reconciliation.
 *
 * An offline tap is stored as an *intent*, never as attendance. This card is
 * where those intents are resolved once the connection is back: the user
 * confirms, and each one is written through the manual-correction path with the
 * device time and a reason that says exactly where the value came from. The
 * record is therefore flagged as corrected and fully traceable, rather than
 * masquerading as a trusted server timestamp.
 */
export function PendingIntentsCard({ className }: { className?: string }) {
  const [intents, setIntents] = React.useState<PendingIntent[]>(listPendingIntents)
  const { isOnline, hasRecentFailure } = useOnline()
  const correction = useManualCorrection()

  const refresh = React.useCallback(() => setIntents(listPendingIntents()), [])

  // Another tab may have queued or cleared an intent.
  React.useEffect(() => {
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [refresh])

  if (intents.length === 0) return null

  const plans = buildReconciliationPlans(intents)
  const canSubmit = isOnline && !hasRecentFailure

  const submit = (planIndex: number) => {
    const plan = plans[planIndex]
    if (!plan) return
    correction.mutate(
      {
        date: plan.dateKey,
        checkInLocal: plan.checkInTimeKey,
        checkOutLocal: plan.checkOutTimeKey,
        reason: plan.reason.slice(0, 500),
      },
      {
        onSuccess: () => {
          for (const id of plan.intentIds) removePendingIntent(id)
          refresh()
        },
      },
    )
  }

  return (
    <Card
      className={cn('border-caution/30 bg-caution-soft/40', className)}
      role="region"
      aria-label="Offline taps awaiting confirmation"
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2.5">
          <TriangleAlert
            className="mt-px size-4 shrink-0 text-caution-soft-foreground"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {intents.length === 1
                ? '1 offline tap was not recorded'
                : `${intents.length} offline taps were not recorded`}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              These were saved on this device only, using this device&rsquo;s clock. Confirm
              each one to write it as a manual correction with its origin noted in the audit
              log.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {plans.map((plan, index) => (
            <li
              key={plan.dateKey}
              className="rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <p className="text-[13px] font-semibold leading-tight">
                {formatLongDate(plan.dateKey)}
              </p>
              <p className="tnum mt-0.5 text-xs text-muted-foreground">
                In: {plan.checkInTimeKey ? formatTimeKey(plan.checkInTimeKey) : '—'} · Out:{' '}
                {plan.checkOutTimeKey ? formatTimeKey(plan.checkOutTimeKey) : '—'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => submit(index)}
                  disabled={!canSubmit}
                  loading={correction.isPending}
                  loadingText="Saving…"
                >
                  <CloudUpload aria-hidden="true" />
                  Confirm and record
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    for (const id of plan.intentIds) removePendingIntent(id)
                    refresh()
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Discard
                </Button>
              </div>
              {!canSubmit ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Waiting for a connection.
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {plans.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearPendingIntents()
              refresh()
            }}
          >
            Discard all
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

/** Lets other components refresh the card after queueing an intent. */
export function notifyPendingIntentsChanged(): void {
  window.dispatchEvent(new StorageEvent('storage', { key: 'oat.pending-intents.v1' }))
}

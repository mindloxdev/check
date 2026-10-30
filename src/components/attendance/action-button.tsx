import * as React from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Clock4,
  CloudOff,
  LogIn,
  LogOut,
  ShieldAlert,
  Wifi,
} from 'lucide-react'
import type { AttendancePolicy, LiveState } from '@/lib/attendance'
import { useCheckIn, useCheckOut } from '@/hooks/use-attendance'
import { useOnline } from '@/providers/online-provider'
import { queuePendingIntent, type IntentKind } from '@/lib/offline'
import { notifyPendingIntentsChanged } from './pending-intents'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatTimeKey, resolveBusinessDate, toTimeKey } from '@/lib/tz'
import { cn } from '@/lib/utils'
import type { WifiMode } from '@/types/database'

export interface ActionButtonProps {
  state: LiveState
  policy: AttendancePolicy
  wifiMode: WifiMode
  className?: string
}

/**
 * The one-tap primary action.
 *
 * Rules enforced here, on top of the server's own guards:
 *   - Exactly one action is ever offered, so there is nothing to misread.
 *   - It is disabled while a write is in flight, which is what stops a
 *     double-tap from reaching the server twice.
 *   - Offline, the tap is blocked with an explanation rather than appearing to
 *     succeed. Nothing is written and nothing is claimed.
 */
export function ActionButton({ state, policy, wifiMode, className }: ActionButtonProps) {
  const checkIn = useCheckIn()
  const checkOut = useCheckOut()
  const { isOnline, hasRecentFailure } = useOnline()
  const [confirmOverride, setConfirmOverride] = React.useState(false)

  const busy = checkIn.isPending || checkOut.isPending
  const offline = !isOnline || hasRecentFailure

  const handleCheckIn = () => {
    if (wifiMode === 'required') {
      // Probe first so the warning, if any, is shown before anything is written.
      setConfirmOverride(true)
      return
    }
    checkIn.mutate({})
  }

  if (offline) {
    const kind: IntentKind | null = state.canCheckOut
      ? 'check_out'
      : state.canCheckIn
        ? 'check_in'
        : null

    const queue = () => {
      if (!kind) return
      const deviceTime = new Date()
      const intent = queuePendingIntent({
        kind,
        deviceTime,
        deviceTimeKey: toTimeKey(deviceTime, policy.timeZone),
        businessDateGuess: resolveBusinessDate(deviceTime, policy.timeZone, {
          overnightEnabled: policy.overnightEnabled,
          dayCutoffHour: policy.dayCutoffHour,
        }),
        timeZone: policy.timeZone,
      })

      if (!intent) {
        toast.error('Nothing could be saved', {
          description:
            'This device refused to store the reminder, so there is no record of the tap at all.',
        })
        return
      }

      notifyPendingIntentsChanged()
      toast.warning('Saved on this device only — not recorded yet', {
        description:
          'Attendance has NOT been saved to the server. Confirm it from the dashboard once you are back online.',
      })
    }

    return (
      <div className={cn('space-y-2', className)}>
        <Button size="xl" block disabled variant="secondary">
          <CloudOff aria-hidden="true" />
          Offline — cannot record
        </Button>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Your attendance has <strong className="font-semibold">not</strong> been recorded.
          There is no trusted clock offline, so nothing is written until the server confirms
          it.
        </p>
        {kind ? (
          <Button variant="outline" size="sm" block onClick={queue}>
            <Clock4 aria-hidden="true" />
            Note the time on this device for later
          </Button>
        ) : null}
      </div>
    )
  }

  if (state.canCheckOut) {
    return (
      <div className={cn('space-y-2', className)}>
        <Button
          size="xl"
          block
          variant="success"
          loading={busy}
          loadingText="Checking out…"
          onClick={() => checkOut.mutate({})}
          className="shadow-action"
        >
          <LogOut aria-hidden="true" />
          Check Out
        </Button>
        <ActionHint wifiMode={wifiMode} />
      </div>
    )
  }

  if (state.canCheckIn) {
    return (
      <div className={cn('space-y-2', className)}>
        <Button
          size="xl"
          block
          loading={busy}
          loadingText="Checking in…"
          onClick={handleCheckIn}
          className="shadow-action"
        >
          <LogIn aria-hidden="true" />
          Check In
        </Button>
        <ActionHint wifiMode={wifiMode} />

        <RequiredVerificationDialog
          open={confirmOverride}
          onOpenChange={setConfirmOverride}
          onConfirm={() => {
            setConfirmOverride(false)
            checkIn.mutate({})
          }}
        />
      </div>
    )
  }

  // Already closed for the day in single-session mode.
  return (
    <div className={cn('space-y-2', className)}>
      <Button size="xl" block disabled variant="secondary">
        <CheckCircle2 aria-hidden="true" />
        {state.status === 'checked_out' ? 'Day complete' : 'No action available'}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {state.status === 'checked_out' ? (
          <>
            Today is recorded. Expected hours were{' '}
            {formatTimeKey(policy.expectedCheckIn)} to {formatTimeKey(policy.expectedCheckOut)}.
            Need a change? Use a manual correction below.
          </>
        ) : (
          <>
            This day has a check-out with no arrival. Add the missing time with a manual
            correction.
          </>
        )}
      </p>
    </div>
  )
}

function ActionHint({ wifiMode }: { wifiMode: WifiMode }) {
  if (wifiMode === 'off') return null
  return (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
      <Wifi className="size-3.5 shrink-0" aria-hidden="true" />
      The office network is checked as you tap, and the result is saved with the record.
    </p>
  )
}

function RequiredVerificationDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-caution" aria-hidden="true" />
            Record even if verification fails?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Network verification is set to <strong>required</strong>. The office endpoint will
            be checked now. If it cannot be reached, your check-in is still recorded and
            clearly marked as unverified — attendance is never discarded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Check in anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

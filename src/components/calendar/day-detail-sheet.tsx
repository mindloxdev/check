import * as React from 'react'
import {
  CalendarClock,
  Clock,
  Hourglass,
  PencilLine,
  ShieldCheck,
  ShieldX,
  StickyNote,
} from 'lucide-react'
import type { DaySummary } from '@/lib/attendance'
import { VERIFICATION_LABEL } from '@/lib/attendance'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/common/status-badge'
import { AuditTrail } from '@/components/attendance/audit-trail'
import { ManualCorrectionDialog } from '@/components/attendance/manual-correction-dialog'
import {
  formatClockTime,
  formatDuration,
  formatLongDate,
  formatTimeKey,
  type DateKey,
} from '@/lib/tz'

export interface DayDetailSheetProps {
  day: DaySummary | null
  today: DateKey
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Everything recorded about one day: the timestamps, the derived duration and
 * lateness, the verification result, and the full correction history.
 */
export function DayDetailSheet({ day, today, open, onOpenChange }: DayDetailSheetProps) {
  const [correcting, setCorrecting] = React.useState(false)

  if (!day) return null

  const tz = day.policy.timeZone
  const record = day.primaryRecord

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{formatLongDate(day.dateKey)}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
              <StatusBadge status={day.status} corrected={day.manuallyCorrected} />
              {day.workedOnNonWorkingDay ? (
                <span className="text-[11px] text-muted-foreground">
                  Recorded on a non-working day
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <dl className="space-y-0.5">
            <Row
              icon={Clock}
              label="Check in"
              value={day.checkInAt ? formatClockTime(day.checkInAt, tz) : '—'}
              meta={
                day.checkInAt
                  ? day.late.isLate
                    ? `${day.late.minutesAfterSchedule} min after ${formatTimeKey(
                        day.policy.expectedCheckIn,
                      )} · ${day.late.minutesAfterGrace} min past the ${
                        day.policy.gracePeriodMinutes
                      }-min grace`
                    : `On time (expected ${formatTimeKey(day.policy.expectedCheckIn)})`
                  : undefined
              }
            />
            <Row
              icon={Clock}
              label="Check out"
              value={day.checkOutAt ? formatClockTime(day.checkOutAt, tz) : '—'}
              meta={
                day.checkOutAt
                  ? day.earlyDepartureMinutes > 0
                    ? `${day.earlyDepartureMinutes} min before ${formatTimeKey(
                        day.policy.expectedCheckOut,
                      )}`
                    : `Expected ${formatTimeKey(day.policy.expectedCheckOut)}`
                  : undefined
              }
            />
            <Row
              icon={Hourglass}
              label="Working time"
              value={
                day.status === 'missing_check_out' || day.status === 'checked_in'
                  ? 'Incomplete'
                  : formatDuration(day.workedMinutes)
              }
              meta={
                day.records.length > 1
                  ? `${day.records.length} sessions on this day`
                  : undefined
              }
            />
            <Row
              icon={day.verification.checkIn === 'verified' ? ShieldCheck : ShieldX}
              label="Verification"
              value={
                day.verification.checkIn
                  ? VERIFICATION_LABEL[day.verification.checkIn]
                  : '—'
              }
              meta={
                record?.check_in_source
                  ? `Source: ${sourceLabel(record.check_in_source)}`
                  : undefined
              }
            />
            {day.holidayName ? (
              <Row icon={CalendarClock} label="Holiday" value={day.holidayName} />
            ) : null}
            {day.leaveType ? (
              <Row icon={CalendarClock} label="Leave type" value={day.leaveType} />
            ) : null}
            {record?.note ? (
              <Row icon={StickyNote} label="Note" value={record.note} />
            ) : null}
          </dl>

          {record?.correction_reason ? (
            <div className="rounded-lg border border-caution/25 bg-caution-soft px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-caution-soft-foreground">
                Correction reason
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-caution-soft-foreground">
                {record.correction_reason}
              </p>
            </div>
          ) : null}

          <Button variant="outline" block onClick={() => setCorrecting(true)}>
            <PencilLine aria-hidden="true" />
            {record ? 'Correct this day' : 'Add attendance for this day'}
          </Button>

          {record ? (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Change history
                </p>
                <AuditTrail recordId={record.id} />
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ManualCorrectionDialog
        open={correcting}
        onOpenChange={setCorrecting}
        date={day.dateKey}
        record={record}
        today={today}
      />
    </>
  )
}

function Row({
  icon: Icon,
  label,
  value,
  meta,
}: {
  icon: typeof Clock
  label: string
  value: string
  meta?: string
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd className="tnum text-sm font-semibold leading-snug text-foreground">{value}</dd>
        {meta ? (
          <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{meta}</dd>
        ) : null}
      </div>
    </div>
  )
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'app':
      return 'tapped in the app (server timestamp)'
    case 'manual':
      return 'entered manually'
    case 'offline_sync':
      return 'reconciled from an offline tap'
    default:
      return source
  }
}

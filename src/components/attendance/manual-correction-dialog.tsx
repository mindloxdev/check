import * as React from 'react'
import { History, Info, PencilLine, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useDeleteRecord, useManualCorrection, usePolicy } from '@/hooks/use-attendance'
import { AuditTrail } from './audit-trail'
import {
  type DateKey,
  compareDateKeys,
  formatLongDate,
  isDateKey,
  isTimeKey,
  timeKeyToMinutes,
  toTimeKey,
} from '@/lib/tz'
import type { AttendanceRecordRow } from '@/types/database'

export interface ManualCorrectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The date being corrected. */
  date: DateKey
  /** Existing record for that date, if any. */
  record?: AttendanceRecordRow | null
  /** Today's business date — corrections may not be dated in the future. */
  today: DateKey
}

interface FormErrors {
  date?: string
  checkIn?: string
  checkOut?: string
  reason?: string
}

/**
 * The manual correction workflow.
 *
 * The three requirements this screen exists to satisfy:
 *   1. Nothing changes without an explicit action — this dialog, never a side
 *      effect of some other screen.
 *   2. A reason is mandatory. The field is validated here and the constraint is
 *      also enforced in the database, so no code path can skip it.
 *   3. The previous values are preserved. The server writes a before/after pair
 *      into the audit log, which is shown at the bottom of this dialog.
 *
 * Times are entered and submitted as office-local wall clock strings; the
 * conversion to UTC happens server-side using the office time zone.
 */
export function ManualCorrectionDialog({
  open,
  onOpenChange,
  date,
  record,
  today,
}: ManualCorrectionDialogProps) {
  const { policy } = usePolicy()
  const correction = useManualCorrection()
  const deletion = useDeleteRecord()

  const [dateValue, setDateValue] = React.useState<string>(date)
  const [checkInValue, setCheckInValue] = React.useState('')
  const [checkOutValue, setCheckOutValue] = React.useState('')
  const [nextDay, setNextDay] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [errors, setErrors] = React.useState<FormErrors>({})
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [showAudit, setShowAudit] = React.useState(false)

  // Re-seed the form whenever a different day is opened.
  React.useEffect(() => {
    if (!open) return
    setDateValue(date)
    setCheckInValue(
      record?.check_in_at ? toTimeKey(new Date(record.check_in_at), policy.timeZone) : '',
    )
    setCheckOutValue(
      record?.check_out_at ? toTimeKey(new Date(record.check_out_at), policy.timeZone) : '',
    )
    setNextDay(isOvernight(record, policy.timeZone, date))
    setReason('')
    setNote(record?.note ?? '')
    setErrors({})
    setShowAudit(false)
  }, [open, date, record, policy.timeZone])

  const validate = (): FormErrors => {
    const next: FormErrors = {}

    if (!isDateKey(dateValue)) {
      next.date = 'Enter a valid date.'
    } else if (compareDateKeys(dateValue, today) > 0) {
      next.date = 'Attendance cannot be recorded for a future date.'
    }

    if (checkInValue && !isTimeKey(checkInValue)) next.checkIn = 'Use a 24-hour time, e.g. 09:05.'
    if (checkOutValue && !isTimeKey(checkOutValue)) {
      next.checkOut = 'Use a 24-hour time, e.g. 17:30.'
    }

    if (!checkInValue && !checkOutValue) {
      next.checkIn = 'Enter a check-in time, a check-out time, or both.'
    }

    if (
      !next.checkIn &&
      !next.checkOut &&
      checkInValue &&
      checkOutValue &&
      !nextDay &&
      timeKeyToMinutes(checkOutValue) <= timeKeyToMinutes(checkInValue)
    ) {
      next.checkOut =
        'Check-out must be later than check-in. Tick “ends the next day” for an overnight shift.'
    }

    const trimmedReason = reason.trim()
    if (trimmedReason.length < 3) {
      next.reason = 'Describe why this record is being changed (at least 3 characters).'
    }

    return next
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      // Move focus to the first field in error so a keyboard or screen-reader
      // user is taken straight to it.
      const firstKey = Object.keys(found)[0]
      document.getElementById(`correction-${firstKey}`)?.focus()
      return
    }

    correction.mutate(
      {
        date: dateValue as DateKey,
        checkInLocal: checkInValue || null,
        checkOutLocal: checkOutValue || null,
        reason: reason.trim(),
        sessionIndex: record?.session_index ?? 1,
        note: note.trim() || null,
        checkOutNextDay: nextDay,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const isEdit = Boolean(record)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PencilLine className="size-5 text-primary" aria-hidden="true" />
              {isEdit ? 'Correct attendance' : 'Add missing attendance'}
            </DialogTitle>
            <DialogDescription>{formatLongDate(date)}</DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-info-soft-foreground">
            <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
            <p className="text-xs leading-relaxed">
              The original values are kept in the audit log and this day is flagged as
              manually corrected. Times are in {policy.timeZone}.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field
              label="Attendance date"
              htmlFor="correction-date"
              error={errors.date}
              required
            >
              <Input
                type="date"
                value={dateValue}
                max={today}
                invalid={Boolean(errors.date)}
                onChange={(event) => setDateValue(event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Check in"
                htmlFor="correction-checkIn"
                error={errors.checkIn}
                hint="Leave blank if there was no arrival."
              >
                <Input
                  type="time"
                  value={checkInValue}
                  invalid={Boolean(errors.checkIn)}
                  onChange={(event) => setCheckInValue(event.target.value)}
                />
              </Field>

              <Field
                label="Check out"
                htmlFor="correction-checkOut"
                error={errors.checkOut}
                hint="Leave blank to record a missing check-out."
              >
                <Input
                  type="time"
                  value={checkOutValue}
                  invalid={Boolean(errors.checkOut)}
                  onChange={(event) => setCheckOutValue(event.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2.5">
              <Checkbox
                id="correction-next-day"
                checked={nextDay}
                onCheckedChange={(checked) => setNextDay(checked === true)}
              />
              <Label htmlFor="correction-next-day" className="font-medium">
                Check-out is on the next day (overnight shift)
              </Label>
            </div>

            <Field
              label="Reason for the correction"
              htmlFor="correction-reason"
              error={errors.reason}
              required
              hint="Stored in the audit log alongside the before and after values."
            >
              <Textarea
                rows={2}
                value={reason}
                placeholder="Forgot to tap Check Out before leaving."
                invalid={Boolean(errors.reason)}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>

            <Field label="Note (optional)" htmlFor="correction-note">
              <Input
                value={note}
                placeholder="Client visit, worked from the north office"
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={correction.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={correction.isPending} loadingText="Saving…">
                {isEdit ? 'Save correction' : 'Add record'}
              </Button>
            </DialogFooter>
          </form>

          {record ? (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAudit((value) => !value)}
                  >
                    <History aria-hidden="true" />
                    {showAudit ? 'Hide change history' : 'Show change history'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive-soft hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete record
                  </Button>
                </div>
                {showAudit ? <AuditTrail recordId={record.id} /> : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this attendance record?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatLongDate(date)} will become an unrecorded day. The deletion and the
              values being removed are written to the audit log, so the history survives.
              This cannot be undone from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep record</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!record) return
                const deleteReason = reason.trim() || 'Record deleted by the user.'
                deletion.mutate(
                  { id: record.id, reason: deleteReason },
                  {
                    onSuccess: () => {
                      setConfirmDelete(false)
                      onOpenChange(false)
                    },
                  },
                )
              }}
            >
              Delete record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** True when the record's check-out falls on a later calendar day than its date. */
function isOvernight(
  record: AttendanceRecordRow | null | undefined,
  timeZone: string,
  dateKey: DateKey,
): boolean {
  if (!record?.check_out_at) return false
  const checkOutDate = new Date(record.check_out_at)
  // Compare the local calendar date of the check-out with the attendance date.
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(checkOutDate)
  return localDate > dateKey
}

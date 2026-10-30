import * as React from 'react'
import { CalendarPlus, PartyPopper, Plane, Trash2 } from 'lucide-react'
import {
  LEAVE_TYPE_LABEL,
  useAddHoliday,
  useAddLeave,
  useDeleteHoliday,
  useDeleteLeave,
  useHolidays,
  useLeaves,
} from '@/hooks/use-exceptions'
import { usePolicy } from '@/hooks/use-attendance'
import { useMinuteClock } from '@/providers/clock-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/empty-state'
import {
  compareDateKeys,
  formatLongDate,
  isDateKey,
  resolveBusinessDate,
  type DateKey,
} from '@/lib/tz'
import type { LeaveType } from '@/types/database'

/**
 * Holidays and approved leave — the exception workflow.
 *
 * This is what makes the absence calculation honest without needing an
 * administrator: a scheduled working day marked as a holiday or as leave is
 * excluded from both the absence count and the scheduled-days denominator.
 */
export function ExceptionSettings() {
  const { policy } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px]">Holidays and leave</CardTitle>
        <CardDescription>
          Days marked here are never counted as absences, and are excluded from the scheduled
          working days in your reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="holidays">
          <TabsList>
            <TabsTrigger value="holidays">
              <PartyPopper aria-hidden="true" className="size-3.5" />
              Holidays
            </TabsTrigger>
            <TabsTrigger value="leave">
              <Plane aria-hidden="true" className="size-3.5" />
              Leave
            </TabsTrigger>
          </TabsList>

          <TabsContent value="holidays">
            <HolidaysPanel today={today} />
          </TabsContent>
          <TabsContent value="leave">
            <LeavePanel today={today} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function HolidaysPanel({ today }: { today: DateKey }) {
  const { data, isLoading } = useHolidays()
  const add = useAddHoliday()
  const remove = useDeleteHoliday()

  const [date, setDate] = React.useState('')
  const [name, setName] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!isDateKey(date)) found.date = 'Pick a date.'
    if (name.trim().length === 0) found.name = 'Name the holiday.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    add.mutate(
      { date: date as DateKey, name: name.trim() },
      {
        onSuccess: () => {
          setDate('')
          setName('')
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="holiday-date" error={errors.date} required>
            <Input
              type="date"
              value={date}
              invalid={Boolean(errors.date)}
              onChange={(event) => {
                setDate(event.target.value)
                setErrors({})
              }}
            />
          </Field>
          <Field label="Holiday name" htmlFor="holiday-name" error={errors.name} required>
            <Input
              value={name}
              placeholder="Independence Day"
              maxLength={120}
              invalid={Boolean(errors.name)}
              onChange={(event) => {
                setName(event.target.value)
                setErrors({})
              }}
            />
          </Field>
        </div>
        <Button type="submit" size="sm" loading={add.isPending} loadingText="Adding…">
          <CalendarPlus aria-hidden="true" />
          Add holiday
        </Button>
      </form>

      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="No holidays yet"
          description="Add the days your office is closed so they are not reported as absences."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {data.map((holiday) => (
            <li key={holiday.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{holiday.holiday_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatLongDate(holiday.holiday_date)}
                  {compareDateKeys(holiday.holiday_date, today) > 0 ? ' · upcoming' : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${holiday.holiday_name}`}
                onClick={() => remove.mutate(holiday.id)}
                className="shrink-0 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LeavePanel({ today }: { today: DateKey }) {
  const { data, isLoading } = useLeaves()
  const add = useAddLeave()
  const remove = useDeleteLeave()

  const [start, setStart] = React.useState('')
  const [end, setEnd] = React.useState('')
  const [type, setType] = React.useState<LeaveType>('annual')
  const [notes, setNotes] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!isDateKey(start)) found.start = 'Pick a start date.'
    if (!isDateKey(end)) found.end = 'Pick an end date.'
    if (!found.start && !found.end && compareDateKeys(end, start) < 0) {
      found.end = 'The end date cannot be before the start date.'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    add.mutate(
      {
        startDate: start as DateKey,
        endDate: end as DateKey,
        leaveType: type,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          setStart('')
          setEnd('')
          setNotes('')
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor="leave-start" error={errors.start} required>
            <Input
              type="date"
              value={start}
              invalid={Boolean(errors.start)}
              onChange={(event) => {
                setStart(event.target.value)
                // A single-day leave is the common case, so mirror the date.
                if (!end || compareDateKeys(end, event.target.value) < 0) {
                  setEnd(event.target.value)
                }
                setErrors({})
              }}
            />
          </Field>
          <Field label="To" htmlFor="leave-end" error={errors.end} required>
            <Input
              type="date"
              value={end}
              min={start || undefined}
              invalid={Boolean(errors.end)}
              onChange={(event) => {
                setEnd(event.target.value)
                setErrors({})
              }}
            />
          </Field>
        </div>

        <Field label="Leave type" htmlFor="leave-type">
          <Select value={type} onValueChange={(value) => setType(value as LeaveType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {LEAVE_TYPE_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Notes (optional)" htmlFor="leave-notes">
          <Input
            value={notes}
            maxLength={500}
            placeholder="Approved by email on 12 Oct"
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        <Button type="submit" size="sm" loading={add.isPending} loadingText="Adding…">
          <CalendarPlus aria-hidden="true" />
          Record leave
        </Button>
      </form>

      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Plane}
          title="No leave recorded"
          description="Record approved leave so those days are excluded from absences."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {data.map((leave) => (
            <li key={leave.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">
                  {LEAVE_TYPE_LABEL[leave.leave_type]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {leave.start_date === leave.end_date
                    ? formatLongDate(leave.start_date)
                    : `${leave.start_date} → ${leave.end_date}`}
                  {compareDateKeys(leave.start_date, today) > 0 ? ' · upcoming' : ''}
                </p>
                {leave.notes ? (
                  <p className="truncate text-[11px] italic text-muted-foreground">
                    {leave.notes}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove leave starting ${leave.start_date}`}
                onClick={() => remove.mutate(leave.id)}
                className="shrink-0 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

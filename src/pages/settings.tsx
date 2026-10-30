import * as React from 'react'
import { toast } from 'sonner'
import {
  Bell,
  Building2,
  CalendarDays,
  Clock,
  Info,
  LogOut,
  Moon,
  Palette,
  Save,
  Wifi,
} from 'lucide-react'
import { usePolicy, useUpdateProfile } from '@/hooks/use-attendance'
import { useTheme } from '@/providers/theme-provider'
import { useAuth } from '@/providers/auth-provider'
import { useClock } from '@/providers/clock-provider'
import { signOut } from '@/lib/api'
import { PageHeader } from '@/components/common/page-header'
import { ConnectionBanner } from '@/components/common/connection-banner'
import { WifiSettings } from '@/components/settings/wifi-settings'
import { ExceptionSettings } from '@/components/settings/exception-settings'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  formatZoneOffset,
  isTimeKey,
  isValidTimeZone,
  minutesToTimeKey,
  timeKeyToMinutes,
  type IsoWeekday,
} from '@/lib/tz'
import type { ThemePreference } from '@/types/database'
import { cn } from '@/lib/utils'

/** Common zones, with anything the user already has appended if it is missing. */
const COMMON_ZONES = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Riyadh',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]

interface FormState {
  officeName: string
  timezone: string
  expectedCheckIn: string
  expectedCheckOut: string
  gracePeriodMinutes: string
  workingDays: IsoWeekday[]
  reportingDay: string
  multiSessionEnabled: boolean
  overnightEnabled: boolean
  dayCutoffHour: string
  notifyMonthlyReview: boolean
  notifyMissingCheckout: boolean
  notifyLateArrival: boolean
}

export function SettingsPage() {
  const { profile } = usePolicy()
  const update = useUpdateProfile()
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()
  const { now } = useClock()

  const [form, setForm] = React.useState<FormState | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  // Seed the form once the profile arrives, and whenever it is replaced by a
  // successful save, so the inputs always reflect what is stored.
  React.useEffect(() => {
    if (!profile) return
    setForm({
      officeName: profile.office_name,
      timezone: profile.timezone,
      expectedCheckIn: minutesToTimeKey(timeKeyToMinutes(profile.expected_check_in)),
      expectedCheckOut: minutesToTimeKey(timeKeyToMinutes(profile.expected_check_out)),
      gracePeriodMinutes: String(profile.grace_period_minutes),
      workingDays: [...profile.working_days].sort((a, b) => a - b) as IsoWeekday[],
      reportingDay: String(profile.reporting_day),
      multiSessionEnabled: profile.multi_session_enabled,
      overnightEnabled: profile.overnight_enabled,
      dayCutoffHour: String(profile.day_cutoff_hour),
      notifyMonthlyReview: profile.notify_monthly_review,
      notifyMissingCheckout: profile.notify_missing_checkout,
      notifyLateArrival: profile.notify_late_arrival,
    })
  }, [profile])

  if (!profile || !form) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key as string]
      return next
    })
  }

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}

    if (form.officeName.trim().length === 0) {
      found.officeName = 'Give your office a name.'
    } else if (form.officeName.trim().length > 120) {
      found.officeName = 'Keep the name under 120 characters.'
    }

    if (!isValidTimeZone(form.timezone)) {
      found.timezone = 'Choose a valid IANA time zone.'
    }
    if (!isTimeKey(form.expectedCheckIn)) {
      found.expectedCheckIn = 'Enter a valid time, e.g. 09:00.'
    }
    if (!isTimeKey(form.expectedCheckOut)) {
      found.expectedCheckOut = 'Enter a valid time, e.g. 17:00.'
    }

    const grace = Number(form.gracePeriodMinutes)
    if (!Number.isInteger(grace) || grace < 0 || grace > 480) {
      found.gracePeriodMinutes = 'Use a whole number of minutes between 0 and 480.'
    }

    if (form.workingDays.length === 0) {
      found.workingDays = 'Select at least one working day.'
    }

    const reporting = Number(form.reportingDay)
    if (!Number.isInteger(reporting) || reporting < 1 || reporting > 28) {
      found.reportingDay =
        'Pick a day between 1 and 28, so the reminder exists in every month.'
    }

    const cutoff = Number(form.dayCutoffHour)
    if (form.overnightEnabled && (!Number.isInteger(cutoff) || cutoff < 0 || cutoff > 12)) {
      found.dayCutoffHour = 'Use an hour between 0 and 12.'
    }

    return found
  }

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const firstKey = Object.keys(found)[0]
      document.getElementById(`settings-${firstKey}`)?.focus()
      toast.error('Some settings need fixing', {
        description: 'The highlighted fields were not saved.',
      })
      return
    }

    update.mutate(
      {
        office_name: form.officeName.trim(),
        timezone: form.timezone,
        expected_check_in: form.expectedCheckIn,
        expected_check_out: form.expectedCheckOut,
        grace_period_minutes: Number(form.gracePeriodMinutes),
        working_days: form.workingDays,
        reporting_day: Number(form.reportingDay),
        multi_session_enabled: form.multiSessionEnabled,
        overnight_enabled: form.overnightEnabled,
        day_cutoff_hour: Number(form.dayCutoffHour),
        notify_monthly_review: form.notifyMonthlyReview,
        notify_missing_checkout: form.notifyMissingCheckout,
        notify_late_arrival: form.notifyLateArrival,
      },
      {
        onSuccess: () =>
          toast.success('Settings saved', {
            description:
              'Days already recorded keep the schedule they were recorded under.',
          }),
      },
    )
  }

  const zones = COMMON_ZONES.includes(form.timezone)
    ? COMMON_ZONES
    : [form.timezone, ...COMMON_ZONES]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Your attendance rules. Changes apply from now on."
      />

      <ConnectionBanner />

      <form onSubmit={handleSave} className="space-y-4" noValidate>
        {/* ---- Office ----------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Building2 className="size-4 text-primary" aria-hidden="true" />
              Office
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Office name"
              htmlFor="settings-officeName"
              error={errors.officeName}
              required
              hint="Appears on the dashboard and on every exported report."
            >
              <Input
                value={form.officeName}
                maxLength={120}
                invalid={Boolean(errors.officeName)}
                onChange={(event) => set('officeName', event.target.value)}
              />
            </Field>

            <Field
              label="Office time zone"
              htmlFor="settings-timezone"
              error={errors.timezone}
              required
              hint={
                isValidTimeZone(form.timezone)
                  ? `Currently ${formatZoneOffset(now, form.timezone)}. Attendance dates and report boundaries are resolved in this zone.`
                  : undefined
              }
            >
              <Select value={form.timezone} onValueChange={(value) => set('timezone', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                      {isValidTimeZone(zone) ? ` · ${formatZoneOffset(now, zone)}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* ---- Schedule --------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Clock className="size-4 text-primary" aria-hidden="true" />
              Schedule
            </CardTitle>
            <CardDescription>
              Used to decide whether an arrival is late and which days count as scheduled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Expected arrival"
                htmlFor="settings-expectedCheckIn"
                error={errors.expectedCheckIn}
                required
              >
                <Input
                  type="time"
                  value={form.expectedCheckIn}
                  invalid={Boolean(errors.expectedCheckIn)}
                  onChange={(event) => set('expectedCheckIn', event.target.value)}
                />
              </Field>
              <Field
                label="Expected departure"
                htmlFor="settings-expectedCheckOut"
                error={errors.expectedCheckOut}
                required
              >
                <Input
                  type="time"
                  value={form.expectedCheckOut}
                  invalid={Boolean(errors.expectedCheckOut)}
                  onChange={(event) => set('expectedCheckOut', event.target.value)}
                />
              </Field>
            </div>

            <Field
              label="Late-arrival grace period"
              htmlFor="settings-gracePeriodMinutes"
              error={errors.gracePeriodMinutes}
              required
              hint={graceHint(form.expectedCheckIn, form.gracePeriodMinutes)}
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={480}
                  step={1}
                  value={form.gracePeriodMinutes}
                  invalid={Boolean(errors.gracePeriodMinutes)}
                  onChange={(event) => set('gracePeriodMinutes', event.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            </Field>

            <div className="space-y-1.5">
              <Label htmlFor="settings-workingDays">Working days</Label>
              <div
                id="settings-workingDays"
                role="group"
                aria-label="Working days"
                aria-describedby="settings-workingDays-hint"
                className="flex flex-wrap gap-1.5"
              >
                {([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).map((day) => {
                  const active = form.workingDays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      // The accessible name says which day and whether it is on,
                      // so the toggle does not rely on fill colour alone.
                      aria-label={`${WEEKDAY_NAMES[day]}${active ? ', working day' : ', not a working day'}`}
                      onClick={() =>
                        set(
                          'workingDays',
                          active
                            ? form.workingDays.filter((value) => value !== day)
                            : [...form.workingDays, day].sort((a, b) => a - b),
                        )
                      }
                      className={cn(
                        'min-h-11 min-w-11 flex-1 cursor-pointer rounded-lg border px-2 text-[13px] font-semibold',
                        'transition-colors duration-fast focus-visible:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {WEEKDAY_SHORT[day]}
                    </button>
                  )
                })}
              </div>
              <p
                id="settings-workingDays-hint"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Unselected days are treated as weekend and never counted as absences.
              </p>
              {errors.workingDays ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {errors.workingDays}
                </p>
              ) : null}
            </div>

            <Field
              label="Monthly reporting day"
              htmlFor="settings-reportingDay"
              error={errors.reportingDay}
              required
              hint={`On day ${form.reportingDay || '5'} of each month the previous month becomes available to review.`}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                step={1}
                value={form.reportingDay}
                invalid={Boolean(errors.reportingDay)}
                onChange={(event) => set('reportingDay', event.target.value)}
                className="w-24"
              />
            </Field>
          </CardContent>
        </Card>

        {/* ---- Sessions --------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <CalendarDays className="size-4 text-primary" aria-hidden="true" />
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow
              id="settings-multiSession"
              label="Allow several sessions a day"
              description="Off means one check-in and one check-out per day, which is what prevents accidental duplicates. On lets you record a lunch break as two sessions."
              checked={form.multiSessionEnabled}
              onChange={(value) => set('multiSessionEnabled', value)}
            />
            <ToggleRow
              id="settings-overnight"
              label="Overnight shifts"
              description="Treat an early-morning time as belonging to the previous working day, so a shift that ends after midnight stays on one record."
              checked={form.overnightEnabled}
              onChange={(value) => set('overnightEnabled', value)}
              icon={Moon}
            />
            {form.overnightEnabled ? (
              <div className="pt-2">
                <Field
                  label="Day boundary hour"
                  htmlFor="settings-dayCutoffHour"
                  error={errors.dayCutoffHour}
                  hint={`Times before ${String(Number(form.dayCutoffHour) || 0).padStart(2, '0')}:00 belong to the previous day.`}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={12}
                    step={1}
                    value={form.dayCutoffHour}
                    invalid={Boolean(errors.dayCutoffHour)}
                    onChange={(event) => set('dayCutoffHour', event.target.value)}
                    className="w-24"
                  />
                </Field>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ---- Notifications --------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Bell className="size-4 text-primary" aria-hidden="true" />
              Reminders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <ToggleRow
              id="settings-notifyMonthlyReview"
              label="Monthly review reminder"
              description="Shows a prompt on the dashboard on your reporting day."
              checked={form.notifyMonthlyReview}
              onChange={(value) => set('notifyMonthlyReview', value)}
            />
            <ToggleRow
              id="settings-notifyMissingCheckout"
              label="Missing check-out warning"
              description="Flags a session that was never closed."
              checked={form.notifyMissingCheckout}
              onChange={(value) => set('notifyMissingCheckout', value)}
            />
            <ToggleRow
              id="settings-notifyLateArrival"
              label="Late-arrival notice"
              description="Mentions how late you were in the check-in confirmation."
              checked={form.notifyLateArrival}
              onChange={(value) => set('notifyLateArrival', value)}
            />

            <div className="mt-2 flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-info-soft-foreground">
              <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
              <p className="text-xs leading-relaxed">
                These reminders appear while the app is open. A website cannot reliably
                notify you when it is closed — see{' '}
                <code className="rounded bg-card/60 px-1 py-0.5 text-[11px]">
                  docs/MONTHLY_REMINDERS.md
                </code>{' '}
                for how to add a scheduled email instead.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---- Appearance ------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Palette className="size-4 text-primary" aria-hidden="true" />
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Theme" htmlFor="settings-theme">
              <Select
                value={theme}
                onValueChange={(value) => setTheme(value as ThemePreference)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Follow my device</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* A sticky save bar: on a long form the action must stay reachable. */}
        <div
          className={cn(
            'no-print sticky bottom-[calc(theme(spacing.navbar)+env(safe-area-inset-bottom,0px))]',
            'z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6',
          )}
        >
          <Button type="submit" block size="lg" loading={update.isPending} loadingText="Saving…">
            <Save aria-hidden="true" />
            Save settings
          </Button>
        </div>
      </form>

      {/* ---- Wi-Fi verification (own form) ------------------------------- */}
      <Card id="wifi">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <Wifi className="size-4 text-primary" aria-hidden="true" />
            Office Wi-Fi verification
          </CardTitle>
          <CardDescription>
            Confirms you are on the office network when you check in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WifiSettings profile={profile} />
        </CardContent>
      </Card>

      {/* ---- Holidays and leave ----------------------------------------- */}
      <ExceptionSettings />

      {/* ---- Account ----------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">Account</CardTitle>
          <CardDescription className="truncate">{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  icon: Icon,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  icon?: typeof Moon
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="flex items-center gap-1.5">
          {Icon ? (
            <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          ) : null}
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

/** Worked example, so the grace-period rule is never ambiguous. */
function graceHint(expectedCheckIn: string, grace: string): string {
  if (!isTimeKey(expectedCheckIn)) return 'Minutes after the expected arrival that still count as on time.'
  const minutes = Number(grace)
  if (!Number.isInteger(minutes) || minutes < 0) {
    return 'Minutes after the expected arrival that still count as on time.'
  }
  const onTime = minutesToTimeKey(timeKeyToMinutes(expectedCheckIn) + minutes)
  const late = minutesToTimeKey(timeKeyToMinutes(expectedCheckIn) + minutes + 1)
  return `Arriving at ${onTime} is on time; ${late} is late. Reports show minutes after ${expectedCheckIn}, and separately how far past the grace period you were.`
}

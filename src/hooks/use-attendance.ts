/**
 * Attendance data hooks.
 *
 * All query keys live in `queryKeys` so an invalidation after a write can never
 * miss a view that is showing the same data.
 */

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as api from '@/lib/api'
import {
  type AttendancePolicy,
  type DaySummary,
  type LiveState,
  deriveLiveState,
  policyFromProfile,
} from '@/lib/attendance'
import {
  type MonthRef,
  type MonthlyReport,
  buildMonthlyReport,
  monthOf,
  monthRange,
  monthlyReviewState,
  summariseRange,
} from '@/lib/report'
import {
  type DateKey,
  datesBetween,
  formatClockTime,
  formatDurationLong,
  resolveBusinessDate,
} from '@/lib/tz'
import { describeError, toAppError, type AppError } from '@/lib/errors'
import { probeOfficeNetwork, wifiConfigFromProfile, type WifiProbeResult } from '@/lib/wifi'
import { haptic } from '@/lib/utils'
import type { AttendanceRecordRow, ProfileRow, VerificationStatus } from '@/types/database'
import { useAuth, useUserId } from '@/providers/auth-provider'
import { useClock, useMinuteClock } from '@/providers/clock-provider'
import { useOnline } from '@/providers/online-provider'

export const queryKeys = {
  profile: ['profile'] as const,
  openSession: ['attendance', 'open-session'] as const,
  day: (date: DateKey) => ['attendance', 'day', date] as const,
  range: (from: DateKey, to: DateKey) => ['attendance', 'range', from, to] as const,
  holidays: (from: DateKey, to: DateKey) => ['holidays', from, to] as const,
  allHolidays: ['holidays', 'all'] as const,
  leaves: (from: DateKey, to: DateKey) => ['leaves', from, to] as const,
  allLeaves: ['leaves', 'all'] as const,
  history: (key: string) => ['attendance', 'history', key] as const,
  audit: (recordId: string) => ['audit', recordId] as const,
  auditForDate: (date: DateKey) => ['audit', 'date', date] as const,
}

/** Invalidates everything that could be showing attendance for a given date. */
function invalidateAttendance(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['attendance'] })
  void client.invalidateQueries({ queryKey: ['audit'] })
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useProfile() {
  const { user, isConfigured } = useAuth()
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: api.ensureProfile,
    enabled: Boolean(user) && isConfigured,
    staleTime: 5 * 60_000,
  })
}

/** The live policy, with documented defaults until the profile arrives. */
export function usePolicy(): { policy: AttendancePolicy; profile: ProfileRow | undefined } {
  const { data: profile } = useProfile()
  const policy = React.useMemo(
    () => (profile ? policyFromProfile(profile) : undefined),
    [profile],
  )
  return {
    policy: policy ?? FALLBACK_POLICY,
    profile,
  }
}

const FALLBACK_POLICY: AttendancePolicy = {
  timeZone: 'Asia/Karachi',
  expectedCheckIn: '09:00',
  expectedCheckOut: '17:00',
  gracePeriodMinutes: 10,
  workingDays: [1, 2, 3, 4, 5],
  officeName: 'My Office',
  overnightEnabled: false,
  dayCutoffHour: 4,
  multiSessionEnabled: false,
}

export function useUpdateProfile() {
  const client = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateProfile>[1]) => {
      if (!userId) throw toAppError(new Error('AUTH_REQUIRED: not signed in'))
      return api.updateProfile(userId, patch)
    },
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.profile, profile)
      // A schedule change re-classifies every day that has no snapshot of its
      // own, so every derived view must be recomputed.
      invalidateAttendance(client)
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error('Could not save settings', { description: describeError(appError) })
    },
  })
}

// ---------------------------------------------------------------------------
// Today / live state
// ---------------------------------------------------------------------------

export function useOpenSession() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.openSession,
    queryFn: api.fetchOpenSession,
    enabled: Boolean(user),
    staleTime: 10_000,
  })
}

export function useDayRecords(date: DateKey | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.day(date ?? 'none'),
    queryFn: () => api.fetchRecordsForDate(date!),
    enabled: Boolean(user) && Boolean(date),
    staleTime: 15_000,
  })
}

export interface LiveAttendance {
  state: LiveState
  isLoading: boolean
  error: AppError | null
  businessDate: DateKey
}

/** The dashboard's single source of truth for what the buttons may do. */
export function useLiveAttendance(): LiveAttendance {
  const { now } = useClock()
  const { policy } = usePolicy()

  const businessDate = React.useMemo(
    () =>
      resolveBusinessDate(now, policy.timeZone, {
        overnightEnabled: policy.overnightEnabled,
        dayCutoffHour: policy.dayCutoffHour,
      }),
    // Only the business date matters here, and it changes at most once a day;
    // recomputing it each second is cheap but re-rendering on it is not, so the
    // dependency is the day-resolution inputs rather than `now` itself.
    [now, policy.timeZone, policy.overnightEnabled, policy.dayCutoffHour],
  )

  const openSession = useOpenSession()
  const todayRecords = useDayRecords(businessDate)

  const state = React.useMemo(
    () =>
      deriveLiveState({
        now,
        todayRecords: todayRecords.data ?? [],
        openSession: openSession.data ?? null,
        policy,
      }),
    [now, todayRecords.data, openSession.data, policy],
  )

  const rawError = openSession.error ?? todayRecords.error
  return {
    state,
    isLoading: openSession.isLoading || todayRecords.isLoading,
    error: rawError ? toAppError(rawError) : null,
    businessDate,
  }
}

// ---------------------------------------------------------------------------
// Check in / check out
// ---------------------------------------------------------------------------

export interface CheckActionResult {
  record: AttendanceRecordRow
  probe: WifiProbeResult | null
}

/**
 * Runs the Wi-Fi probe, then writes through the server RPC.
 *
 * Order matters: the probe result is part of the record, so it has to resolve
 * first. A failed probe is recorded, never fatal.
 */
export function useCheckIn() {
  const client = useQueryClient()
  const { profile, policy } = usePolicy()
  const { reportFailure, reportSuccess } = useOnline()

  return useMutation<CheckActionResult, unknown, { skipProbe?: boolean; note?: string }>({
    mutationFn: async ({ skipProbe, note }) => {
      const probe = profile && !skipProbe
        ? await probeOfficeNetwork(wifiConfigFromProfile(profile))
        : null
      const verification: VerificationStatus = probe?.status ?? 'unverified'
      const record = await api.checkIn({ verification, note: note ?? null })
      return { record, probe }
    },
    onSuccess: ({ record, probe }) => {
      reportSuccess()
      haptic()
      invalidateAttendance(client)

      const time = record.check_in_at
        ? formatClockTime(new Date(record.check_in_at), policy.timeZone)
        : ''
      toast.success(`Checked in successfully at ${time}.`, {
        description:
          probe?.status === 'verified'
            ? 'Office network verified.'
            : probe?.status === 'failed'
              ? 'Recorded, but the office network could not be verified.'
              : undefined,
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      if (appError.code === 'OFFLINE') reportFailure()
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

export function useCheckOut() {
  const client = useQueryClient()
  const { profile, policy } = usePolicy()
  const { reportFailure, reportSuccess } = useOnline()

  return useMutation<CheckActionResult, unknown, { skipProbe?: boolean } | void>({
    mutationFn: async (args) => {
      const probe = profile && !args?.skipProbe
        ? await probeOfficeNetwork(wifiConfigFromProfile(profile))
        : null
      const record = await api.checkOut({ verification: probe?.status ?? 'unverified' })
      return { record, probe }
    },
    onSuccess: ({ record }) => {
      reportSuccess()
      haptic()
      invalidateAttendance(client)

      const time = record.check_out_at
        ? formatClockTime(new Date(record.check_out_at), policy.timeZone)
        : ''
      toast.success(`Checked out successfully at ${time}.`, {
        description:
          record.duration_minutes != null
            ? `Total duration: ${formatDurationLong(record.duration_minutes)}.`
            : undefined,
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      if (appError.code === 'OFFLINE') reportFailure()
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

export function useManualCorrection() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: (args: api.ManualCorrectionArgs) => api.manualCorrection(args),
    onSuccess: (record) => {
      invalidateAttendance(client)
      toast.success('Attendance corrected', {
        description: `${record.attendance_date} updated and recorded in the audit log.`,
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

export function useDeleteRecord() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.deleteRecord(id, reason),
    onSuccess: () => {
      invalidateAttendance(client)
      toast.success('Attendance record deleted', {
        description: 'The deletion is recorded in the audit log.',
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

// ---------------------------------------------------------------------------
// Monthly report
// ---------------------------------------------------------------------------

export interface MonthlyReportQuery {
  report: MonthlyReport | null
  isLoading: boolean
  isFetching: boolean
  error: AppError | null
  refetch: () => void
}

export function useMonthlyReport(month: MonthRef): MonthlyReportQuery {
  const { user } = useAuth()
  const { policy } = usePolicy()
  // A month view re-renders on the minute, not the second.
  const now = useMinuteClock()
  const range = React.useMemo(() => monthRange(month), [month])

  // The window is widened by a day on each side so an overnight session that
  // started on the last day of the previous month is still available.
  const fetchFrom = range.from
  const fetchTo = range.to

  const records = useQuery({
    queryKey: queryKeys.range(fetchFrom, fetchTo),
    queryFn: () => api.fetchRecordsBetween(fetchFrom, fetchTo),
    enabled: Boolean(user),
  })
  const holidays = useQuery({
    queryKey: queryKeys.holidays(fetchFrom, fetchTo),
    queryFn: () => api.fetchHolidaysBetween(fetchFrom, fetchTo),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const leaves = useQuery({
    queryKey: queryKeys.leaves(fetchFrom, fetchTo),
    queryFn: () => api.fetchLeavesOverlapping(fetchFrom, fetchTo),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })

  const report = React.useMemo(() => {
    if (!records.data || !holidays.data || !leaves.data) return null
    return buildMonthlyReport({
      month,
      records: records.data,
      holidays: holidays.data,
      leaves: leaves.data,
      policy,
      now,
    })
  }, [records.data, holidays.data, leaves.data, month, policy, now])

  const rawError = records.error ?? holidays.error ?? leaves.error

  return {
    report,
    isLoading: records.isLoading || holidays.isLoading || leaves.isLoading,
    isFetching: records.isFetching || holidays.isFetching || leaves.isFetching,
    error: rawError ? toAppError(rawError) : null,
    refetch: () => {
      void records.refetch()
      void holidays.refetch()
      void leaves.refetch()
    },
  }
}

/** Day summaries for an arbitrary range — used by History. */
export function useRangeSummaries(from: DateKey, to: DateKey) {
  const { user } = useAuth()
  const { policy } = usePolicy()
  const now = useMinuteClock()

  const records = useQuery({
    queryKey: queryKeys.range(from, to),
    queryFn: () => api.fetchRecordsBetween(from, to),
    enabled: Boolean(user),
  })
  const holidays = useQuery({
    queryKey: queryKeys.holidays(from, to),
    queryFn: () => api.fetchHolidaysBetween(from, to),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const leaves = useQuery({
    queryKey: queryKeys.leaves(from, to),
    queryFn: () => api.fetchLeavesOverlapping(from, to),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })

  const summaries = React.useMemo<DaySummary[]>(() => {
    if (!records.data || !holidays.data || !leaves.data) return []
    return summariseRange({
      dates: datesBetween(from, to),
      records: records.data,
      holidays: holidays.data,
      leaves: leaves.data,
      policy,
      now,
    })
  }, [records.data, holidays.data, leaves.data, from, to, policy, now])

  return {
    summaries,
    isLoading: records.isLoading || holidays.isLoading || leaves.isLoading,
    error: records.error ?? holidays.error ?? leaves.error,
  }
}

// ---------------------------------------------------------------------------
// Monthly review reminder
// ---------------------------------------------------------------------------

export function useMonthlyReview() {
  const { policy, profile } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone, {
    overnightEnabled: policy.overnightEnabled,
    dayCutoffHour: policy.dayCutoffHour,
  })
  return React.useMemo(
    () => monthlyReviewState(today, profile?.reporting_day ?? 5),
    [today, profile?.reporting_day],
  )
}

/** The month the Reports page opens on. */
export function useDefaultReportMonth(): MonthRef {
  const review = useMonthlyReview()
  const { policy } = usePolicy()
  const now = useMinuteClock()
  const today = resolveBusinessDate(now, policy.timeZone)
  // On or after the reporting day, open on the month now due for review;
  // otherwise open on the current month.
  return review.isDueToday || review.isAvailable ? review.month : monthOf(today)
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function useAuditLog(recordId: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.audit(recordId ?? 'none'),
    queryFn: () => api.fetchAuditLog(recordId!),
    enabled: Boolean(user) && Boolean(recordId),
  })
}

export function useAuditLogForDate(date: DateKey | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.auditForDate(date ?? 'none'),
    queryFn: () => api.fetchAuditLogForDate(date!),
    enabled: Boolean(user) && Boolean(date),
  })
}

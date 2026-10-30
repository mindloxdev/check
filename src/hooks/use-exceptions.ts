/**
 * Holidays and approved leave — the "administrator-free" exception workflow.
 * The user marks their own holidays and leave, and the report calculations stop
 * treating those days as absences.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as api from '@/lib/api'
import { toAppError } from '@/lib/errors'
import type { DateKey } from '@/lib/tz'
import type { LeaveType } from '@/types/database'
import { useAuth, useUserId } from '@/providers/auth-provider'
import { queryKeys } from './use-attendance'

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  casual: 'Casual leave',
  unpaid: 'Unpaid leave',
  other: 'Other',
}

function invalidateExceptions(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['holidays'] })
  void client.invalidateQueries({ queryKey: ['leaves'] })
  // Day classification depends on both, so every attendance view is stale now.
  void client.invalidateQueries({ queryKey: ['attendance'] })
}

export function useHolidays() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.allHolidays,
    queryFn: api.fetchAllHolidays,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
}

export function useAddHoliday() {
  const client = useQueryClient()
  const userId = useUserId()
  return useMutation({
    mutationFn: ({ date, name }: { date: DateKey; name: string }) => {
      if (!userId) throw toAppError(new Error('AUTH_REQUIRED: not signed in'))
      return api.addHoliday(userId, date, name)
    },
    onSuccess: (holiday) => {
      invalidateExceptions(client)
      toast.success('Holiday added', {
        description: `${holiday.holiday_name} on ${holiday.holiday_date} is excluded from absences.`,
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error(appError.message, {
        description:
          appError.code === 'DUPLICATE'
            ? 'That date is already marked as a holiday.'
            : appError.hint,
      })
    },
  })
}

export function useDeleteHoliday() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteHoliday(id),
    onSuccess: () => {
      invalidateExceptions(client)
      toast.success('Holiday removed')
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

export function useLeaves() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.allLeaves,
    queryFn: api.fetchAllLeaves,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
}

export function useAddLeave() {
  const client = useQueryClient()
  const userId = useUserId()
  return useMutation({
    mutationFn: (args: {
      startDate: DateKey
      endDate: DateKey
      leaveType: LeaveType
      notes?: string | null
    }) => {
      if (!userId) throw toAppError(new Error('AUTH_REQUIRED: not signed in'))
      return api.addLeave({ userId, ...args })
    },
    onSuccess: (leave) => {
      invalidateExceptions(client)
      toast.success('Leave recorded', {
        description:
          leave.start_date === leave.end_date
            ? `${LEAVE_TYPE_LABEL[leave.leave_type]} on ${leave.start_date}.`
            : `${LEAVE_TYPE_LABEL[leave.leave_type]} from ${leave.start_date} to ${leave.end_date}.`,
      })
    },
    onError: (error) => {
      const appError = toAppError(error)
      // The database has an exclusion constraint against overlapping leave, so
      // say what actually happened rather than showing a raw constraint name.
      const overlapping = /leave_no_overlap|exclusion/i.test(String(appError.cause ?? ''))
      toast.error(overlapping ? 'That leave overlaps an existing entry.' : appError.message, {
        description: overlapping
          ? 'Edit or remove the existing leave first.'
          : appError.hint,
      })
    },
  })
}

export function useDeleteLeave() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteLeave(id),
    onSuccess: () => {
      invalidateExceptions(client)
      toast.success('Leave removed')
    },
    onError: (error) => {
      const appError = toAppError(error)
      toast.error(appError.message, { description: appError.hint })
    },
  })
}

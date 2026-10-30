import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildReconciliationPlans,
  clearPendingIntents,
  listPendingIntents,
  queuePendingIntent,
  reconciliationReason,
  removePendingIntent,
} from './offline'
import { toAppError, describeError, isNetworkFailure } from './errors'

beforeEach(() => {
  clearPendingIntents()
})

const draft = (kind: 'check_in' | 'check_out', time: string, date = '2026-10-29') => ({
  kind,
  deviceTime: new Date(`${date}T${time}:00Z`),
  deviceTimeKey: time,
  businessDateGuess: date,
  timeZone: 'Asia/Karachi',
})

describe('pending intent queue', () => {
  it('starts empty', () => {
    expect(listPendingIntents()).toEqual([])
  })

  it('queues and returns the persisted intent', () => {
    const intent = queuePendingIntent(draft('check_in', '09:05'))
    expect(intent).not.toBeNull()
    expect(intent?.kind).toBe('check_in')
    expect(intent?.deviceTimeKey).toBe('09:05')
    expect(listPendingIntents()).toHaveLength(1)
  })

  it('survives a reload by reading back from storage', () => {
    queuePendingIntent(draft('check_in', '09:05'))
    // listPendingIntents always re-reads localStorage, so this models a reload.
    expect(listPendingIntents()).toHaveLength(1)
  })

  it('removes a single intent', () => {
    const a = queuePendingIntent(draft('check_in', '09:05'))!
    queuePendingIntent(draft('check_out', '17:30'))
    removePendingIntent(a.id)
    const remaining = listPendingIntents()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.kind).toBe('check_out')
  })

  it('ignores corrupt storage instead of crashing', () => {
    localStorage.setItem('oat.pending-intents.v1', 'not json')
    expect(listPendingIntents()).toEqual([])
  })

  it('drops entries that do not match the expected shape', () => {
    localStorage.setItem(
      'oat.pending-intents.v1',
      JSON.stringify([{ id: 'x' }, { nope: true }]),
    )
    expect(listPendingIntents()).toEqual([])
  })

  it('reports null when storage refuses the write, so nothing is claimed saved', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
    try {
      expect(queuePendingIntent(draft('check_in', '09:05'))).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })
})

describe('reconciliation', () => {
  it('names the device clock in the audit reason', () => {
    const intent = queuePendingIntent(draft('check_in', '09:05'))!
    const reason = reconciliationReason(intent)
    expect(reason).toContain('Check-in tapped offline at 09:05')
    expect(reason).toContain('device clock, unverified')
  })

  it('pairs an offline check-in and check-out on the same date', () => {
    queuePendingIntent(draft('check_in', '09:05'))
    queuePendingIntent(draft('check_out', '17:30'))
    const plans = buildReconciliationPlans(listPendingIntents())

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      dateKey: '2026-10-29',
      checkInTimeKey: '09:05',
      checkOutTimeKey: '17:30',
    })
    expect(plans[0]?.intentIds).toHaveLength(2)
  })

  it('produces one plan per business date, in date order', () => {
    queuePendingIntent(draft('check_in', '09:00', '2026-10-30'))
    queuePendingIntent(draft('check_in', '09:00', '2026-10-28'))
    const plans = buildReconciliationPlans(listPendingIntents())
    expect(plans.map((p) => p.dateKey)).toEqual(['2026-10-28', '2026-10-30'])
  })

  it('keeps the latest check-out when a day has several', () => {
    queuePendingIntent(draft('check_in', '09:00'))
    queuePendingIntent(draft('check_out', '12:00'))
    queuePendingIntent(draft('check_out', '18:00'))
    const plan = buildReconciliationPlans(listPendingIntents())[0]
    expect(plan?.checkOutTimeKey).toBe('18:00')
  })

  it('handles a check-out with no matching check-in', () => {
    queuePendingIntent(draft('check_out', '17:30'))
    const plan = buildReconciliationPlans(listPendingIntents())[0]
    expect(plan?.checkInTimeKey).toBeNull()
    expect(plan?.checkOutTimeKey).toBe('17:30')
  })
})

describe('error translation', () => {
  it('maps database codes to actionable copy', () => {
    const error = toAppError(
      new Error('ALREADY_CHECKED_IN: an open session started at 2026-10-29 09:00 is still running'),
    )
    expect(error.code).toBe('ALREADY_CHECKED_IN')
    expect(error.message).toBe('You are already checked in.')
    // The database sentence carries the specific time, so it becomes the hint.
    expect(error.hint).toContain('2026-10-29 09:00')
  })

  it('falls back to the preset hint when the database adds no detail', () => {
    const error = toAppError(new Error('NOT_CHECKED_IN:'))
    expect(error.code).toBe('NOT_CHECKED_IN')
    expect(error.hint).toMatch(/Check in first/)
  })

  it('detects a lost network before anything else', () => {
    const error = toAppError(new TypeError('Failed to fetch'))
    expect(error.code).toBe('OFFLINE')
    expect(describeError(error)).toContain('was not recorded')
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkFailure(new Error('ALREADY_CHECKED_IN: x'))).toBe(false)
  })

  it('maps a unique-violation to the duplicate message', () => {
    expect(toAppError({ code: '23505', message: 'duplicate key value' }).code).toBe(
      'DUPLICATE',
    )
  })

  it('maps a permission failure to a re-authentication prompt', () => {
    expect(toAppError({ code: '42501', message: 'permission denied' }).code).toBe(
      'AUTH_REQUIRED',
    )
    expect(toAppError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe(
      'AUTH_REQUIRED',
    )
  })

  it('surfaces an unrecognised message rather than hiding it', () => {
    const error = toAppError(new Error('column "foo" does not exist'))
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('Column "foo" does not exist')
  })

  it('ignores an unknown CODE: prefix it does not recognise', () => {
    const error = toAppError(new Error('WAT_IS_THIS: something odd'))
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('Something odd')
  })

  it('handles a completely empty error', () => {
    expect(toAppError({}).message).toBe('The request could not be completed.')
  })

  it('composes message and hint for a toast', () => {
    const error = toAppError(new Error('REASON_REQUIRED: '))
    expect(describeError(error)).toBe(
      'A correction needs a reason. Describe why the record is being changed (at least 3 characters).',
    )
  })
})

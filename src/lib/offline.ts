/**
 * Offline attendance intents.
 *
 * The rule this module exists to enforce: **an offline tap is never reported as
 * a successful check-in.** There is no trusted clock offline, so the app cannot
 * honestly claim a time was recorded. Instead the tap is stored as a *pending
 * intent* carrying the device clock, clearly labelled as unconfirmed, and the
 * user is asked to confirm it as a manual correction once the connection
 * returns. The resulting record is flagged `offline_sync` and carries a reason
 * naming the device time, so the provenance survives in the audit log.
 */

import type { DateKey } from './tz'

const STORAGE_KEY = 'oat.pending-intents.v1'
const MAX_INTENTS = 50

export type IntentKind = 'check_in' | 'check_out'

export interface PendingIntent {
  id: string
  kind: IntentKind
  /** Device clock at the moment of the tap. Explicitly untrusted. */
  deviceTimeIso: string
  /** 'HH:mm' in the office zone according to the device clock. */
  deviceTimeKey: string
  /** Business date the device believed it was. May be wrong. */
  businessDateGuess: DateKey
  timeZone: string
  createdAt: string
}

export interface PendingIntentDraft {
  kind: IntentKind
  deviceTime: Date
  deviceTimeKey: string
  businessDateGuess: DateKey
  timeZone: string
}

function readStore(): PendingIntent[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPendingIntent)
  } catch {
    // Corrupt or blocked storage (private mode, cleared site data). An empty
    // queue is the safe reading: nothing is claimed to have been saved.
    return []
  }
}

function writeStore(intents: PendingIntent[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(intents.slice(-MAX_INTENTS)))
  } catch {
    // Quota or private-mode failure. The caller is told nothing was queued by
    // re-reading the store, so no false "saved" claim can reach the UI.
  }
}

function isPendingIntent(value: unknown): value is PendingIntent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    (v.kind === 'check_in' || v.kind === 'check_out') &&
    typeof v.deviceTimeIso === 'string' &&
    typeof v.deviceTimeKey === 'string' &&
    typeof v.businessDateGuess === 'string' &&
    typeof v.timeZone === 'string' &&
    typeof v.createdAt === 'string'
  )
}

export function listPendingIntents(): PendingIntent[] {
  return readStore().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Queues an intent and returns what was actually persisted, or null when
 * storage is unavailable — the caller must then tell the user nothing was saved.
 */
export function queuePendingIntent(draft: PendingIntentDraft): PendingIntent | null {
  const intent: PendingIntent = {
    id: `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: draft.kind,
    deviceTimeIso: draft.deviceTime.toISOString(),
    deviceTimeKey: draft.deviceTimeKey,
    businessDateGuess: draft.businessDateGuess,
    timeZone: draft.timeZone,
    createdAt: new Date().toISOString(),
  }
  const next = [...readStore(), intent]
  writeStore(next)
  // Verify it survived the write before claiming success.
  return readStore().some((i) => i.id === intent.id) ? intent : null
}

export function removePendingIntent(id: string): void {
  writeStore(readStore().filter((intent) => intent.id !== id))
}

export function clearPendingIntents(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

/** Correction reason written into the audit log when an intent is reconciled. */
export function reconciliationReason(intent: PendingIntent): string {
  const label = intent.kind === 'check_in' ? 'Check-in' : 'Check-out'
  return `${label} tapped offline at ${intent.deviceTimeKey} on ${intent.businessDateGuess} (device clock, unverified) and confirmed on reconnect.`
}

/**
 * Groups queued intents into one correction per business date, pairing an
 * offline check-in with a later offline check-out on the same date.
 */
export interface ReconciliationPlan {
  dateKey: DateKey
  checkInTimeKey: string | null
  checkOutTimeKey: string | null
  intentIds: string[]
  reason: string
}

export function buildReconciliationPlans(intents: PendingIntent[]): ReconciliationPlan[] {
  const byDate = new Map<DateKey, PendingIntent[]>()
  for (const intent of intents) {
    const list = byDate.get(intent.businessDateGuess)
    if (list) list.push(intent)
    else byDate.set(intent.businessDateGuess, [intent])
  }

  const plans: ReconciliationPlan[] = []
  for (const [dateKey, list] of byDate) {
    const ordered = [...list].sort((a, b) => a.deviceTimeIso.localeCompare(b.deviceTimeIso))
    const checkIn = ordered.find((i) => i.kind === 'check_in') ?? null
    const checkOut = [...ordered].reverse().find((i) => i.kind === 'check_out') ?? null
    plans.push({
      dateKey,
      checkInTimeKey: checkIn?.deviceTimeKey ?? null,
      checkOutTimeKey: checkOut?.deviceTimeKey ?? null,
      intentIds: ordered.map((i) => i.id),
      reason: ordered.map(reconciliationReason).join(' '),
    })
  }

  return plans.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

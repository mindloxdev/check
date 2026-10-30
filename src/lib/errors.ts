/**
 * Error translation.
 *
 * The SQL functions raise messages of the form `CODE: human sentence`. This maps
 * them to copy the user can act on. Anything unrecognised falls back to the raw
 * message rather than a vague "something went wrong", because a real message is
 * more useful than a reassuring one.
 */

export type AppErrorCode =
  | 'AUTH_REQUIRED'
  | 'ALREADY_CHECKED_IN'
  | 'ALREADY_CHECKED_OUT'
  | 'ALREADY_RECORDED'
  | 'NOT_CHECKED_IN'
  | 'RATE_LIMITED'
  | 'REASON_REQUIRED'
  | 'DATE_REQUIRED'
  | 'FUTURE_DATE'
  | 'EMPTY_RECORD'
  | 'ORDER_INVALID'
  | 'SESSION_LIMIT'
  | 'NOT_FOUND'
  | 'OFFLINE'
  | 'DUPLICATE'
  | 'UNKNOWN'

export interface AppError {
  code: AppErrorCode
  /** One short sentence, safe to show in a toast. */
  message: string
  /** Optional second line with what to do about it. */
  hint?: string
  /** The raw error, kept for the console. */
  cause?: unknown
}

const MESSAGES: Partial<Record<AppErrorCode, { message: string; hint?: string }>> = {
  AUTH_REQUIRED: {
    message: 'Your session has expired.',
    hint: 'Sign in again to continue.',
  },
  ALREADY_CHECKED_IN: {
    message: 'You are already checked in.',
    hint: 'Use Check Out to close the session, or edit it from History.',
  },
  ALREADY_CHECKED_OUT: {
    message: 'This session is already checked out.',
    hint: 'Open History to review or correct it.',
  },
  ALREADY_RECORDED: {
    message: 'Today already has an attendance session.',
    hint: 'Use a manual correction to change the recorded times.',
  },
  NOT_CHECKED_IN: {
    message: 'There is no open session to check out of.',
    hint: 'Check in first, or add the missing arrival with a manual correction.',
  },
  RATE_LIMITED: {
    message: 'Too many attempts in a short time.',
    hint: 'Wait a few seconds and try again.',
  },
  REASON_REQUIRED: {
    message: 'A correction needs a reason.',
    hint: 'Describe why the record is being changed (at least 3 characters).',
  },
  DATE_REQUIRED: { message: 'Pick the attendance date you are correcting.' },
  FUTURE_DATE: {
    message: 'Attendance cannot be recorded for a future date.',
  },
  EMPTY_RECORD: {
    message: 'Enter a check-in time, a check-out time, or both.',
  },
  ORDER_INVALID: {
    message: 'Check-out must be later than check-in.',
    hint: 'For a shift that ends after midnight, tick "ends next day".',
  },
  SESSION_LIMIT: { message: 'This day already has the maximum of 12 sessions.' },
  NOT_FOUND: { message: 'That attendance record no longer exists.' },
  OFFLINE: {
    message: 'No connection, so nothing was saved.',
    hint: 'Your attendance was not recorded. Try again once you are back online.',
  },
  DUPLICATE: {
    message: 'A record already exists for that date.',
    hint: 'Edit the existing record instead of adding a second one.',
  },
}

const KNOWN_CODES = new Set<string>(Object.keys(MESSAGES))

interface PostgrestLike {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

function rawMessageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const candidate = error as PostgrestLike
    if (typeof candidate.message === 'string') return candidate.message
    if (typeof candidate.details === 'string') return candidate.details
  }
  return ''
}

/** True when the failure is a lost network rather than a rejected request. */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = rawMessageOf(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('err_internet_disconnected')
  )
}

export function toAppError(error: unknown): AppError {
  const raw = rawMessageOf(error)

  if (isNetworkFailure(error)) {
    return { ...MESSAGES.OFFLINE!, code: 'OFFLINE', cause: error }
  }

  // `CODE: sentence` as raised by the SQL functions.
  const match = /^([A-Z_]{3,30}):\s*(.*)$/.exec(raw)
  if (match && KNOWN_CODES.has(match[1]!)) {
    const code = match[1] as AppErrorCode
    const detail = match[2]?.trim()
    const preset = MESSAGES[code]!
    return {
      code,
      message: preset.message,
      // The database sentence often carries the specific date or time, which is
      // more useful than the generic hint.
      hint: detail && detail.length > 0 ? capitalise(detail) : preset.hint,
      cause: error,
    }
  }

  // Postgres error codes that can surface without passing through an RPC.
  const pgCode =
    error && typeof error === 'object' ? (error as PostgrestLike).code : undefined
  if (pgCode === '23505') {
    return { ...MESSAGES.DUPLICATE!, code: 'DUPLICATE', cause: error }
  }
  if (pgCode === '23514') {
    return {
      code: 'UNKNOWN',
      message: 'That value is not allowed.',
      hint: 'Check the times and try again.',
      cause: error,
    }
  }
  if (pgCode === 'PGRST301' || pgCode === '42501') {
    return { ...MESSAGES.AUTH_REQUIRED!, code: 'AUTH_REQUIRED', cause: error }
  }

  return {
    code: 'UNKNOWN',
    message: raw.length > 0 ? stripPrefix(raw) : 'The request could not be completed.',
    cause: error,
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Drops a leading `CODE: ` from an unrecognised database message. */
function stripPrefix(message: string): string {
  return capitalise(message.replace(/^[A-Z_]{3,30}:\s*/, '').trim())
}

/** Formats an AppError as a single string for a toast description. */
export function describeError(error: AppError): string {
  return error.hint ? `${error.message} ${error.hint}` : error.message
}

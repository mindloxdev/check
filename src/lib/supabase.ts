import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Supabase browser client.
 *
 * Only the anon (publishable) key is ever present in this bundle. It carries no
 * privileges of its own: every table is protected by Row Level Security, so the
 * key is useless without a signed-in session. The service-role key must never
 * appear in any file under `src/`.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export class MissingSupabaseConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Supabase is not configured. Missing ${missing.join(' and ')}. ` +
        'Copy .env.example to .env.local and fill in the values from your project settings.',
    )
    this.name = 'MissingSupabaseConfigError'
  }
}

function missingKeys(): string[] {
  const missing: string[] = []
  if (!url) missing.push('VITE_SUPABASE_URL')
  if (!anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  return missing
}

/** True when both environment variables are present. */
export const isSupabaseConfigured = missingKeys().length === 0

export const supabaseConfigError: MissingSupabaseConfigError | null = isSupabaseConfigured
  ? null
  : new MissingSupabaseConfigError(missingKeys())

if (anonKey && /service_role/i.test(anonKey)) {
  // A service-role key bypasses RLS entirely. Shipping one to a browser would
  // expose every row to anyone who opens devtools, so refuse to start.
  throw new Error(
    'VITE_SUPABASE_ANON_KEY looks like a service-role key. Never ship a service-role key ' +
      'to the browser — use the anon/publishable key.',
  )
}

let client: SupabaseClient<Database> | null = null

/**
 * Lazily created singleton. Returns null when the app is unconfigured, which
 * lets the UI render a setup screen instead of crashing on a blank page.
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    client = createClient<Database>(url!, anonKey!, {
      auth: {
        // Keeps the user signed in across app restarts — a daily-use phone app
        // must never ask for a password at the office door.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'oat.auth',
        flowType: 'pkce',
      },
      global: {
        headers: { 'x-application-name': 'office-attendance-tracker' },
      },
      db: { schema: 'public' },
    })
  }
  return client
}

/** Throws a descriptive error instead of returning null, for call sites that need a client. */
export function requireSupabase(): SupabaseClient<Database> {
  const instance = getSupabase()
  if (!instance) throw supabaseConfigError ?? new MissingSupabaseConfigError(missingKeys())
  return instance
}

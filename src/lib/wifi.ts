/**
 * Office network verification.
 *
 * ## What a browser can and cannot do
 *
 * A web page **cannot** read the Wi-Fi SSID, the BSSID, the signal strength, or
 * the name of the network the phone is attached to. There is no such web API on
 * Android Chrome or iOS Safari, and there is no permission that unlocks one.
 * `navigator.connection` exposes only a coarse effective type ('4g', 'wifi'
 * is *not* reliably reported) and is purely a performance hint.
 *
 * A public IP address is not proof of presence either: it is shared by everyone
 * behind the office NAT but it is equally visible from a VPN, a hotspot that
 * routes through the same ISP, or a colleague's tethered phone.
 *
 * ## What this module actually does
 *
 * It performs a **reachability probe against a host that only exists on the
 * office LAN**. The office machine runs a tiny endpoint (see
 * `docs/WIFI_VERIFICATION.md` and `scripts/office-verifier.mjs`) that answers
 * with a shared secret token. If the phone can reach that host and the token
 * matches, the phone is on a network with a route to the office LAN. That is a
 * strong, honest signal — and the app labels it exactly as what it is.
 *
 * The probe is advisory. A failed probe never discards attendance: the record is
 * still written, flagged `failed`, and the UI says so.
 */

import type { VerificationStatus, WifiMode } from '@/types/database'

export interface WifiConfig {
  mode: WifiMode
  endpointUrl: string | null
  expectedToken: string | null
  timeoutMs: number
}

export interface WifiProbeResult {
  status: VerificationStatus
  /** Short sentence for the UI. */
  message: string
  /** Round-trip time in milliseconds, when the probe completed. */
  latencyMs: number | null
  /** True when the user may still check in. */
  allowsCheckIn: boolean
  /** True when the UI should warn before allowing the check-in anyway. */
  requiresOverride: boolean
}

export const WIFI_MODE_LABEL: Record<WifiMode, string> = {
  off: 'Off',
  optional: 'Check and record',
  required: 'Required (with override)',
}

export const WIFI_MODE_DESCRIPTION: Record<WifiMode, string> = {
  off: 'Never probe the network. Check-ins are recorded as “not verified”.',
  optional:
    'Probe the office endpoint and store the result. The check-in always goes through.',
  required:
    'Probe the office endpoint and warn before recording an unverified check-in. You can still override it — attendance is never lost.',
}

/**
 * Probes the configured office endpoint.
 *
 * Implementation notes that matter:
 *   - `AbortController` enforces the timeout. A LAN host that is simply absent
 *     makes the browser hang until its own TCP timeout, which is far too long
 *     for a button tap.
 *   - `cache: 'no-store'` plus a cache-busting query parameter, so a success
 *     from this morning cannot be replayed from the HTTP cache this evening.
 *   - `mode: 'cors'`. The endpoint must send `Access-Control-Allow-Origin`.
 *     A no-cors probe would succeed opaquely for *any* reachable host, which
 *     would make the result meaningless.
 */
export async function probeOfficeNetwork(
  config: WifiConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<WifiProbeResult> {
  if (config.mode === 'off') {
    return {
      status: 'unverified',
      message: 'Network verification is turned off.',
      latencyMs: null,
      allowsCheckIn: true,
      requiresOverride: false,
    }
  }

  const endpoint = config.endpointUrl?.trim()
  if (!endpoint) {
    return {
      status: 'not_configured',
      message: 'No office verification endpoint configured yet.',
      latencyMs: null,
      allowsCheckIn: true,
      requiresOverride: config.mode === 'required',
    }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'failed',
      message: 'The device reports no network connection.',
      latencyMs: null,
      allowsCheckIn: config.mode !== 'required',
      requiresOverride: config.mode === 'required',
    }
  }

  const controller = new AbortController()
  // A 500 ms floor: anything shorter aborts before a LAN round trip can finish.
  // The same value is used for the abort and for the message, so the two agree.
  const timeoutMs = Math.max(500, config.timeoutMs)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const url = new URL(endpoint)
    url.searchParams.set('t', String(startedAt))

    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain' },
    })

    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      return {
        status: 'failed',
        message: `Office endpoint replied ${response.status}.`,
        latencyMs,
        allowsCheckIn: config.mode !== 'required',
        requiresOverride: config.mode === 'required',
      }
    }

    const body = (await response.text()).trim()
    const expected = config.expectedToken?.trim()

    if (expected) {
      if (!tokenMatches(body, expected)) {
        return {
          status: 'failed',
          // Reaching *a* server on this address is not the same as reaching the
          // office server, so a token mismatch is a failure, not a pass.
          message: 'Reached the endpoint but the verification token did not match.',
          latencyMs,
          allowsCheckIn: config.mode !== 'required',
          requiresOverride: config.mode === 'required',
        }
      }
    }

    return {
      status: 'verified',
      message: expected
        ? `Office network verified in ${latencyMs} ms.`
        : `Office endpoint reachable in ${latencyMs} ms.`,
      latencyMs,
      allowsCheckIn: true,
      requiresOverride: false,
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      status: 'failed',
      message: aborted
        ? `Office endpoint did not answer within ${timeoutMs} ms.`
        : 'Could not reach the office endpoint from this network.',
      latencyMs: aborted ? null : Date.now() - startedAt,
      allowsCheckIn: config.mode !== 'required',
      requiresOverride: config.mode === 'required',
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Compares the endpoint's reply with the expected token.
 *
 * Accepts either a bare token or a JSON body of the shape `{ "token": "..." }`,
 * so the office script can evolve without breaking old clients.
 */
export function tokenMatches(body: string, expected: string): boolean {
  if (body === expected) return true
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const token = (parsed as { token?: unknown }).token
      if (typeof token === 'string') return token === expected
    }
  } catch {
    // Not JSON; the plain comparison above already failed.
  }
  return false
}

export function wifiConfigFromProfile(profile: {
  wifi_mode: WifiMode
  wifi_endpoint_url: string | null
  wifi_expected_token: string | null
  wifi_timeout_ms: number
}): WifiConfig {
  return {
    mode: profile.wifi_mode,
    endpointUrl: profile.wifi_endpoint_url,
    expectedToken: profile.wifi_expected_token,
    timeoutMs: profile.wifi_timeout_ms,
  }
}

/** The protocol the app itself is served over. Injectable so it can be tested. */
function currentPageProtocol(): string {
  return typeof window !== 'undefined' ? window.location.protocol : 'http:'
}

/**
 * Validates an endpoint URL before it is saved.
 *
 * `pageProtocol` defaults to the protocol the app is served over and exists so
 * the mixed-content rule can be exercised without a real https origin.
 */
export function validateEndpointUrl(
  value: string,
  pageProtocol: string = currentPageProtocol(),
): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'Enter a full URL, for example http://192.168.1.50:8787/verify'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'The URL must start with http:// or https://'
  }
  if (
    pageProtocol === 'https:' &&
    parsed.protocol === 'http:' &&
    !isLocalHostname(parsed.hostname)
  ) {
    // Browsers block plain-HTTP subresources from an HTTPS page. A private-IP
    // target is exempt under the Private Network Access rules, but a public
    // hostname is not, so warn before the probe silently fails forever.
    return 'An https:// page cannot call a plain http:// address unless it is a private IP. Use https, or a private address such as 192.168.x.x.'
  }
  return null
}

/** True for loopback and RFC1918/RFC4193 private addresses. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

/** Generates a token suggestion for the settings screen. */
export function suggestToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

import { describe, expect, it, vi } from 'vitest'
import {
  isLocalHostname,
  probeOfficeNetwork,
  suggestToken,
  tokenMatches,
  validateEndpointUrl,
  wifiConfigFromProfile,
  type WifiConfig,
} from './wifi'

const base: WifiConfig = {
  mode: 'optional',
  endpointUrl: 'http://192.168.1.50:8787/verify',
  expectedToken: 'secret-token',
  timeoutMs: 1000,
}

const okResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })

describe('probeOfficeNetwork', () => {
  it('skips the probe entirely when verification is off', async () => {
    const fetchMock = vi.fn()
    const result = await probeOfficeNetwork({ ...base, mode: 'off' }, fetchMock as never)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.status).toBe('unverified')
    expect(result.allowsCheckIn).toBe(true)
  })

  it('reports not_configured when no endpoint is set', async () => {
    const result = await probeOfficeNetwork({ ...base, endpointUrl: null })
    expect(result.status).toBe('not_configured')
    expect(result.allowsCheckIn).toBe(true)
  })

  it('verifies when the endpoint returns the expected token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('secret-token'))
    const result = await probeOfficeNetwork(base, fetchMock as never)
    expect(result.status).toBe('verified')
    expect(result.allowsCheckIn).toBe(true)
    expect(result.latencyMs).not.toBeNull()
  })

  it('accepts a JSON body carrying the token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(JSON.stringify({ token: 'secret-token', ok: true })))
    expect((await probeOfficeNetwork(base, fetchMock as never)).status).toBe('verified')
  })

  it('fails on a token mismatch — reachability alone is not proof', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('wrong'))
    const result = await probeOfficeNetwork(base, fetchMock as never)
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/token did not match/)
    // Optional mode still lets attendance through.
    expect(result.allowsCheckIn).toBe(true)
  })

  it('fails on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }))
    const result = await probeOfficeNetwork(base, fetchMock as never)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('503')
  })

  it('fails on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await probeOfficeNetwork(base, fetchMock as never)
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/Could not reach/)
  })

  it('times out rather than hanging on an absent LAN host', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const result = await probeOfficeNetwork(
      { ...base, timeoutMs: 600 },
      fetchMock as never,
    )
    expect(result.status).toBe('failed')
    expect(result.message).toMatch(/did not answer within 600 ms/)
  })

  it('never blocks a check-in outright, even in required mode', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await probeOfficeNetwork(
      { ...base, mode: 'required' },
      fetchMock as never,
    )
    expect(result.status).toBe('failed')
    // Required mode asks for an explicit override instead of discarding the day.
    expect(result.allowsCheckIn).toBe(false)
    expect(result.requiresOverride).toBe(true)
  })

  it('sends a CORS, no-store request with a cache-busting parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('secret-token'))
    await probeOfficeNetwork(base, fetchMock as never)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^http:\/\/192\.168\.1\.50:8787\/verify\?t=\d+$/)
    expect(init.mode).toBe('cors')
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('treats a verified probe as verified even with no token configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('anything'))
    const result = await probeOfficeNetwork(
      { ...base, expectedToken: null },
      fetchMock as never,
    )
    expect(result.status).toBe('verified')
    expect(result.message).toMatch(/reachable/)
  })
})

describe('tokenMatches', () => {
  it('matches a bare token and a JSON wrapper', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('{"token":"abc"}', 'abc')).toBe(true)
    expect(tokenMatches('{"token":"abc","host":"pc"}', 'abc')).toBe(true)
  })

  it('rejects mismatches and malformed bodies', () => {
    expect(tokenMatches('abd', 'abc')).toBe(false)
    expect(tokenMatches('{"token":123}', 'abc')).toBe(false)
    expect(tokenMatches('<html>login</html>', 'abc')).toBe(false)
    expect(tokenMatches('', 'abc')).toBe(false)
  })
})

describe('validateEndpointUrl', () => {
  it('accepts a blank value and valid URLs', () => {
    expect(validateEndpointUrl('')).toBeNull()
    expect(validateEndpointUrl('   ')).toBeNull()
    expect(validateEndpointUrl('http://192.168.1.50:8787/verify')).toBeNull()
    expect(validateEndpointUrl('https://office.example.com/verify')).toBeNull()
  })

  it('rejects malformed URLs and unsupported schemes', () => {
    expect(validateEndpointUrl('192.168.1.50')).toMatch(/full URL/)
    expect(validateEndpointUrl('ftp://host/verify')).toMatch(/http:\/\/ or https:\/\//)
  })

  it('warns about mixed content from an https page to a public http host', () => {
    expect(validateEndpointUrl('http://office.example.com/verify', 'https:')).toMatch(
      /cannot call a plain http/,
    )
    // A private address is exempt under the Private Network Access rules.
    expect(validateEndpointUrl('http://192.168.1.50:8787/verify', 'https:')).toBeNull()
    expect(validateEndpointUrl('https://office.example.com/verify', 'https:')).toBeNull()
  })

  it('allows a plain http endpoint when the app itself is served over http', () => {
    expect(validateEndpointUrl('http://office.example.com/verify', 'http:')).toBeNull()
  })
})

describe('isLocalHostname', () => {
  it('recognises loopback and private ranges', () => {
    for (const host of [
      'localhost',
      'office.localhost',
      'printer.local',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.50',
      '172.16.0.1',
      '172.31.255.254',
      '169.254.1.1',
      '::1',
      'fd00::1',
    ]) {
      expect(isLocalHostname(host), host).toBe(true)
    }
  })

  it('rejects public hosts', () => {
    for (const host of [
      'example.com',
      '8.8.8.8',
      '172.32.0.1', // just outside the 172.16/12 block
      '172.15.0.1',
      '11.0.0.1',
      '193.168.1.1',
    ]) {
      expect(isLocalHostname(host), host).toBe(false)
    }
  })
})

describe('wifiConfigFromProfile', () => {
  it('maps profile columns onto the probe config', () => {
    expect(
      wifiConfigFromProfile({
        wifi_mode: 'required',
        wifi_endpoint_url: 'http://10.0.0.1/verify',
        wifi_expected_token: 'tok',
        wifi_timeout_ms: 2500,
      }),
    ).toEqual({
      mode: 'required',
      endpointUrl: 'http://10.0.0.1/verify',
      expectedToken: 'tok',
      timeoutMs: 2500,
    })
  })
})

describe('suggestToken', () => {
  it('produces a 32-character hex token that differs each call', () => {
    const a = suggestToken()
    const b = suggestToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

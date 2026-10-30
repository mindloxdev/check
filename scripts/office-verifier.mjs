#!/usr/bin/env node
/**
 * Office network verification endpoint.
 *
 * Run this on a machine that lives on the office LAN — a desktop that is
 * always on, a Raspberry Pi, a NAS. It answers a single GET with a shared
 * secret token, and the attendance app uses "can I reach this host and does it
 * return my token?" as its proof that the phone is on the office network.
 *
 *   OFFICE_VERIFY_TOKEN=<token> node scripts/office-verifier.mjs
 *
 * Options (environment variables):
 *   OFFICE_VERIFY_TOKEN    required — must match the token saved in Settings
 *   PORT                   default 8787
 *   HOST                   default 0.0.0.0 (all interfaces, so phones can reach it)
 *   ALLOWED_ORIGIN         default '*' — set to your deployed app origin to lock it down
 *
 * ---------------------------------------------------------------------------
 * What this does and does not prove
 * ---------------------------------------------------------------------------
 * It proves the phone has a network route to this machine and knows the token.
 * On a normal office Wi-Fi that means "on the office network".
 *
 * It does NOT prove physical presence. Anyone on a VPN into the office network,
 * or forwarding this port, would also pass. For a personal attendance tracker
 * that is the right trade: it is a strong hint, recorded honestly, and the app
 * never treats it as proof.
 *
 * See docs/WIFI_VERIFICATION.md for the full set-up walkthrough.
 */

import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { timingSafeEqual } from 'node:crypto'

const TOKEN = process.env.OFFICE_VERIFY_TOKEN ?? ''
const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

if (!TOKEN) {
  console.error(
    'OFFICE_VERIFY_TOKEN is not set.\n\n' +
      'Generate one in the app (Settings → Office Wi-Fi verification → the dice button),\n' +
      'then start this script with the same value:\n\n' +
      '    OFFICE_VERIFY_TOKEN=<token> node scripts/office-verifier.mjs\n',
  )
  process.exit(1)
}

if (TOKEN.length < 16) {
  console.warn('Warning: a token shorter than 16 characters is easy to guess.\n')
}

/**
 * CORS matters here. The app runs on a different origin (your Vercel domain),
 * so the browser will not let it read this response without these headers. A
 * no-cors request would "succeed" opaquely against literally any reachable
 * host, which would make the whole check meaningless — so the app deliberately
 * uses mode: 'cors' and needs a real answer.
 */
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '600',
    // The app cache-busts with ?t=, but belt and braces: a cached success from
    // this morning must not satisfy a probe made from a café this evening.
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Origin',
    ...(ALLOWED_ORIGIN !== '*' && origin && origin !== ALLOWED_ORIGIN
      ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      : {}),
  }
}

const server = createServer((request, response) => {
  const origin = request.headers.origin ?? ''
  const headers = corsHeaders(origin)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers)
    response.end()
    return
  }

  if (request.method !== 'GET') {
    response.writeHead(405, { ...headers, Allow: 'GET, OPTIONS' })
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname !== '/verify' && url.pathname !== '/') {
    response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' })
    response.end('Not found. The endpoint is /verify')
    return
  }

  // The reply is the same for everyone who can reach the host; the token is not
  // a secret from the LAN, it is a marker that this is *your* endpoint and not
  // some other server that happens to answer on that address.
  const body = JSON.stringify({
    token: TOKEN,
    ok: true,
    service: 'office-attendance-verifier',
    at: new Date().toISOString(),
  })

  response.writeHead(200, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)

  console.log(
    `${new Date().toISOString()}  verified  ${request.socket.remoteAddress ?? '?'}`,
  )
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT to something else.`)
  } else {
    console.error(error)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log('Office attendance verifier is running.\n')
  console.log('Reachable at:')
  for (const address of localAddresses()) {
    console.log(`    http://${address}:${PORT}/verify`)
  }
  console.log(
    '\nPaste one of the above into the app under\n' +
      '    Settings → Office Wi-Fi verification → Verification endpoint URL\n' +
      'and use the matching token. Then tap "Test now".\n',
  )
  console.log(
    'Tip: give this machine a static or DHCP-reserved IP, or the URL will change\n' +
      'the next time it reconnects.\n',
  )
})

/** Every non-internal IPv4 address this machine answers on. */
function localAddresses() {
  const found = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address)
    }
  }
  return found.length > 0 ? found : ['localhost']
}

// Exported for the sake of documentation completeness; the comparison below is
// not currently used because the endpoint returns the token rather than
// receiving one. Kept so the "receive a token" variant in the docs is a
// one-line change rather than a rewrite.
export function constantTimeEquals(a, b) {
  const bufferA = Buffer.from(String(a))
  const bufferB = Buffer.from(String(b))
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

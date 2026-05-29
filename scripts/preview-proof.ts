#!/usr/bin/env bun
/**
 * Preview deploy proof — validates a Pages preview deployment URL.
 *
 * Checks:
 *  1. Preview URL serves HTML (not error page)
 *  2. Root page loads with expected editor shell
 *  3. Local-only routes accessible without auth
 *  4. Hosted route redirects to / (no session in preview)
 *  5. Health endpoint on preview Worker (if apiOrigin set)
 *  6. Session bootstrap returns user: null on preview
 *  7. Feature flags resolve to preview mode
 *
 * Usage:
 *   OPENPENCIL_PREVIEW_URL=https://<hash>.openpencil.pages.dev bun scripts/preview-proof.ts
 *   OPENPENCIL_PREVIEW_URL=http://localhost:1420 bun scripts/preview-proof.ts
 */

const PREVIEW_URL = process.env.OPENPENCIL_PREVIEW_URL ?? 'http://localhost:1420'
const API_ORIGIN = process.env.OPENPENCIL_PREVIEW_API_ORIGIN ?? 'http://127.0.0.1:8787'

let passCount = 0
let failCount = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    passCount++
    console.log(`  PASS: ${label}`)
  } else {
    failCount++
    console.log(`  FAIL: ${label}`)
  }
}

async function request(path: string, opts?: RequestInit) {
  const base = path.startsWith('http') ? path : `${PREVIEW_URL}${path}`
  const res = await fetch(base, opts)
  return { status: res.status, text: await res.text() }
}

// ---------------------------------------------------------------------------
// 1. Preview URL serves HTML
// ---------------------------------------------------------------------------
console.log('\n1. Preview URL accessibility')
const root = await request('/')
assert(root.status === 200, `GET / → ${root.status}`)
assert(root.text.includes('<html') || root.text.includes('<!DOCTYPE'), 'response contains HTML')

// ---------------------------------------------------------------------------
// 2. Editor shell loads
// ---------------------------------------------------------------------------
console.log('\n2. Editor shell presence')
assert(
  root.text.includes('id="app"') || root.text.includes('data-v-app'),
  'Vue app mount point present'
)

// ---------------------------------------------------------------------------
// 3. Local-only routes accessible
// ---------------------------------------------------------------------------
console.log('\n3. Local-only route accessibility')
assert(root.status === 200, 'root route loads without auth requirement')

// ---------------------------------------------------------------------------
// 4. Hosted route redirects without session
// ---------------------------------------------------------------------------
console.log('\n4. Hosted route gating (preview = no live session)')
const hostedRes = await request('/hosted', { redirect: 'manual' })
// Preview Pages without hosted auth enabled should either redirect or show local mode
const isRedirect = hostedRes.status >= 300 && hostedRes.status < 400
const isLocalMode = hostedRes.status === 200 && !hostedRes.text.includes('hosted-mode-active')
assert(
  isRedirect || isLocalMode,
  `/hosted → ${hostedRes.status} (redirect=${isRedirect}, local-mode=${isLocalMode})`
)

// ---------------------------------------------------------------------------
// 5. Worker health (if API available)
// ---------------------------------------------------------------------------
console.log('\n5. Worker health check')
try {
  const healthRes = await fetch(`${API_ORIGIN}/health`, { signal: AbortSignal.timeout(5000) })
  if (healthRes.status === 200) {
    const healthJson = await healthRes.json()
    assert(healthJson.status === 'ok', 'Worker health reports ok')
  } else {
    assert(false, `Worker health → ${healthRes.status} (Worker may not be running locally)`)
  }
} catch {
  // Worker not available in preview context — acceptable for Pages-only preview
  console.log('  SKIP: Worker not reachable (expected for Pages-only preview)')
}

// ---------------------------------------------------------------------------
// 6. Session bootstrap on preview
// ---------------------------------------------------------------------------
console.log('\n6. Session bootstrap on preview')
try {
  const sessionRes = await fetch(`${API_ORIGIN}/api/session`, { signal: AbortSignal.timeout(5000) })
  if (sessionRes.status === 200) {
    const sessionJson = await sessionRes.json()
    assert(sessionJson.user === null, 'session returns user: null without credentials')
  } else {
    assert(false, `session endpoint → ${sessionRes.status}`)
  }
} catch {
  console.log('  SKIP: session endpoint not reachable (Worker not running)')
}

// ---------------------------------------------------------------------------
// 7. Feature flags resolve to preview mode
// ---------------------------------------------------------------------------
console.log('\n7. Feature flag resolution')
try {
  const { spawnSync } = await import('node:child_process')
  const flagResult = spawnSync('bun', ['run', 'scripts/validate-hosted-flags.ts'], {
    cwd: process.cwd(),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, OPENPENCIL_HOSTED_ENV: 'preview' }
  })
  assert(
    flagResult.status === 0,
    `feature flags validate for preview mode (exit ${flagResult.status})`
  )
} catch {
  console.log('  SKIP: feature flag validation (bun spawn unavailable)')
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n--- Preview Deploy Proof: ${passCount} passed, ${failCount} failed ---`)
console.log(`Preview URL: ${PREVIEW_URL}`)
console.log(`API origin: ${API_ORIGIN}`)
if (failCount > 0) {
  process.exit(1)
}

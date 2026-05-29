#!/usr/bin/env bun
/**
 * Preview deploy proof — validates a Pages preview deployment URL.
 *
 * Checks:
 *  1. Preview URL serves HTML (not error page)
 *  2. Root page loads with expected editor shell
 *  3. Local-only routes accessible without auth
 *  4. Hosted route redirects to / (no session in preview)
 *  5. Feature flags resolve to preview mode
 *  6. Worker health (if apiOrigin set)
 *  7. Session bootstrap returns user: null on preview
 *  8. Hosted document create/read/save/delete via paired Worker (if Worker reachable)
 *  9. Hosted collab room via paired Worker (if Worker reachable)
 *
 * Usage:
 *   bun scripts/preview-proof.ts
 *   https://<hash>.openpencil.pages.dev bun scripts/preview-proof.ts
 *   OPENPENCIL_PREVIEW_URL=http://localhost:1420 bun scripts/preview-proof.ts
 */

export {} // Force TypeScript module mode (top-level await in script)

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

async function apiRequest(path: string, opts?: RequestInit) {
  const url = `${API_ORIGIN}${path}`
  const res = await fetch(url, opts)
  const text = await res.text()
  return { status: res.status, body: text, json: () => JSON.parse(text) }
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
// 5. Feature flags resolve to preview mode
// ---------------------------------------------------------------------------
console.log('\n5. Feature flag resolution')
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
// 6-7. Worker health + session bootstrap (requires Worker)
// ---------------------------------------------------------------------------
let workerAvailable = false
console.log('\n6. Worker health check')
try {
  const healthRes = await fetch(`${API_ORIGIN}/health`, { signal: AbortSignal.timeout(5000) })
  if (healthRes.status === 200) {
    const healthJson = await healthRes.json()
    assert(healthJson.status === 'ok', 'Worker health reports ok')
    workerAvailable = true
  } else {
    assert(false, `Worker health → ${healthRes.status}`)
  }
} catch {
  // Worker not available — Pages-only preview, skip hosted doc/collab checks
  console.log('  SKIP: Worker not reachable (Pages-only preview)')
}

if (workerAvailable) {
  console.log('\n7. Session bootstrap on preview Worker')
  try {
    const sessionRes = await fetch(`${API_ORIGIN}/api/session`, { signal: AbortSignal.timeout(5000) })
    if (sessionRes.status === 200) {
      const sessionJson = await sessionRes.json()
      assert(sessionJson.user === null, 'session returns user: null without credentials')
    } else {
      assert(false, `session endpoint → ${sessionRes.status}`)
    }
  } catch {
    console.log('  SKIP: session endpoint unreachable')
  }

  // ---------------------------------------------------------------------------
  // 8. Hosted document CRUD via paired Worker
  // ---------------------------------------------------------------------------
  console.log('\n8. Hosted document CRUD (via paired preview Worker)')

  const STUB_TOKEN = process.env.OPENPENCIL_DEV_STUB_TOKEN ?? 'openpencil-hosted-dev-token'
  const ELF_COOKIE = 'ELF_JWT'
  const headers = { cookie: `${ELF_COOKIE}=${STUB_TOKEN}`, 'content-type': 'application/json' }

  // 8a. Create hosted document
  const docId = `preview-proof-${Date.now()}`
  const snapshotBytes = btoa('preview-hosted-content')
  const createRes = await apiRequest('/api/documents', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documentId: docId,
      snapshotId: `snap-${docId}`,
      title: 'Preview Proof Document',
      sourceFormat: 'fig',
      snapshotBytesBase64: snapshotBytes
    })
  })
  assert(createRes.status === 201, `POST /api/documents → ${createRes.status}`)

  // 8b. Read snapshot
  const snapRes = await apiRequest(`/api/documents/${docId}/snapshot`, { headers })
  assert(snapRes.status === 200, `GET snapshot → ${snapRes.status}`)
  const snapJson = snapRes.json()
  assert(snapJson.document?.id === docId, 'snapshot document id matches')
  assert(snapJson.snapshot?.bytesBase64 === snapshotBytes, 'snapshot bytes match')

  // 8c. Save (update) snapshot
  const newBytes = btoa('preview-hosted-updated')
  const saveRes = await apiRequest(`/api/documents/${docId}/snapshot`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      snapshotId: `snap-${docId}-v2`,
      snapshotBytesBase64: newBytes
    })
  })
  assert(saveRes.status === 200, `PUT snapshot → ${saveRes.status}`)

  // 8d. Verify update persisted
  const updatedSnap = await apiRequest(`/api/documents/${docId}/snapshot`, { headers })
  const updatedJson = updatedSnap.json()
  assert(updatedJson.snapshot?.bytesBase64 === newBytes, 'updated snapshot bytes match')

  // 8e. Delete document
  const deleteRes = await apiRequest(`/api/documents/${docId}`, { method: 'DELETE', headers })
  assert(deleteRes.status === 200, `DELETE → ${deleteRes.status}`)

  // 8f. Verify deleted
  const afterDelete = await apiRequest(`/api/documents/${docId}/snapshot`, { headers })
  assert(afterDelete.status === 404, `deleted snapshot → ${afterDelete.status}`)

  // 8g. Create a separate doc for collab room test (room needs existing owned doc)
  const collabDocId = `preview-collab-${Date.now()}`
  const collabCreate = await apiRequest('/api/documents', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documentId: collabDocId,
      snapshotId: `snap-${collabDocId}`,
      title: 'Preview Collab Doc',
      sourceFormat: 'fig',
      snapshotBytesBase64: btoa('collab-content')
    })
  })
  assert(collabCreate.status === 201, `POST collab doc → ${collabCreate.status}`)

  // ---------------------------------------------------------------------------
  // 9. Hosted collab room via paired Worker
  // ---------------------------------------------------------------------------
  console.log('\n9. Hosted collab room (via paired preview Worker)')

  const roomRes = await apiRequest(`/api/documents/${collabDocId}/room`, { headers })
  assert(roomRes.status === 200, `GET room → ${roomRes.status}`)
  const roomJson = roomRes.json()
  assert(roomJson.documentId === collabDocId, 'room documentId matches')
  assert(roomJson.roomId, 'room response includes roomId')
  assert(roomJson.status === 'ok', 'room status is ok')

  // 9b. Unauthorized access rejected
  const unauthRoom = await apiRequest(`/api/documents/${collabDocId}/room`)
  assert(unauthRoom.status === 401, `unauthorized room → ${unauthRoom.status}`)
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

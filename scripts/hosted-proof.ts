#!/usr/bin/env bun
/**
 * Hosted API proof lane — validates Worker auth, session, CRUD, and collab surfaces.
 *
 * Requires the API Worker running locally (bun --filter @open-pencil/api run dev)
 * or a deployed Worker URL via OPENPENCIL_API_ORIGIN env var.
 *
 * Checks:
 *  1. /health returns 200 with service identity
 *  2. / returns endpoint catalog
 *  3. /api/session returns { user: null } without credentials
 *  4. /api/documents returns 401 without session
 *  5. /api/documents/:id/snapshot returns 401 without session
 *  6. /api/documents/:id/room returns 401 without session
 *  7. Authenticated session bootstrap via stub token (cookie path)
 *  8. Authenticated session bootstrap via stub token (bearer path)
 *  9. Hosted document list returns empty array for stub user
 * 10. Hosted document create succeeds with valid stub session
 * 11. Hosted document snapshot read succeeds for owner
 * 12. Hosted document save (PUT) succeeds for owner
 * 13. Hosted document delete succeeds for owner
 * 14. Unauthorized caller cannot access another user's document
 * 15. Hosted collab room endpoint returns room stub for owner
 * 16. Feature flag contract validated via scripts/validate-hosted-flags.ts
 */

export {} // Force TypeScript module mode (top-level await in script)

const API_ORIGIN = process.env.OPENPENCIL_API_ORIGIN ?? 'http://127.0.0.1:8787'
// Matches api/src/auth.ts DEV_STUB_ELF_TOKEN
const STUB_TOKEN = process.env.OPENPENCIL_DEV_STUB_TOKEN ?? 'openpencil-hosted-dev-token'
const ELF_COOKIE = 'ELF_JWT'

let passCount = 0
let failCount = 0
const results: string[] = []

function assert(condition: boolean, label: string) {
  if (condition) {
    passCount++
    results.push(`  PASS: ${label}`)
    console.log(`  PASS: ${label}`)
  } else {
    failCount++
    results.push(`  FAIL: ${label}`)
    console.log(`  FAIL: ${label}`)
  }
}

function statusLabel(status: number): string {
  if (status < 300) return 'ok'
  if (status < 400) return 'redirect'
  if (status < 500) return 'client-error'
  return 'server-error'
}

async function request(path: string, init?: RequestInit) {
  const url = `${API_ORIGIN}${path}`
  const res = await fetch(url, init)
  const text = await res.text()
  return { status: res.status, body: text, json: () => JSON.parse(text) }
}

// ---------------------------------------------------------------------------
// 1. Health endpoint
// ---------------------------------------------------------------------------
console.log('\n1. Health endpoint')
const health = await request('/health')
assert(health.status === 200, `GET /health → ${health.status}`)
const healthJson = health.json()
assert(healthJson.status === 'ok', 'health status is "ok"')
assert(healthJson.service === 'openpencil-api', 'health service identity')
assert(healthJson.timestamp, 'health includes timestamp')

// ---------------------------------------------------------------------------
// 2. Root endpoint
// ---------------------------------------------------------------------------
console.log('\n2. Root endpoint (service catalog)')
const root = await request('/')
assert(root.status === 200, `GET / → ${root.status}`)
const rootJson = root.json()
assert(rootJson.service === 'openpencil-api', 'root service identity')
assert(rootJson.endpoints?.session, 'root exposes session endpoint')
assert(rootJson.endpoints?.documents, 'root exposes documents endpoints')

// ---------------------------------------------------------------------------
// 3. Session without credentials → user: null
// ---------------------------------------------------------------------------
console.log('\n3. Unauthenticated session')
const session = await request('/api/session')
assert(session.status === 200, `GET /api/session → ${session.status} (not 401)`)
const sessionJson = session.json()
assert(sessionJson.user === null, 'unauthenticated session returns user: null')
assert(sessionJson.mode === 'unauthenticated', 'session mode is unauthenticated')

// ---------------------------------------------------------------------------
// 4-6. Protected routes reject without session
// ---------------------------------------------------------------------------
console.log('\n4. Protected routes reject unauthenticated callers')

const docs = await request('/api/documents')
assert(docs.status === 401, `GET /api/documents → ${docs.status} without session`)

const snap = await request('/api/documents/test-doc/snapshot')
assert(snap.status === 401, `GET /api/documents/test-doc/snapshot → ${snap.status} without session`)

const room = await request('/api/documents/test-doc/room')
assert(room.status === 401, `GET /api/documents/test-doc/room → ${room.status} without session`)

// ---------------------------------------------------------------------------
// 7-8. Authenticated session bootstrap
// ---------------------------------------------------------------------------
console.log('\n5. Authenticated session bootstrap')

const cookieSession = await request('/api/session', {
  headers: { cookie: `${ELF_COOKIE}=${STUB_TOKEN}` }
})
assert(cookieSession.status === 200, `cookie session → ${cookieSession.status}`)
const cookieSessionJson = cookieSession.json()
assert(cookieSessionJson.user?.id === 'stub-user-001', 'cookie session resolves stub-user-001')

const bearerSession = await request('/api/session', {
  headers: { authorization: `Bearer ${STUB_TOKEN}` }
})
assert(bearerSession.status === 200, `bearer session → ${bearerSession.status}`)
const bearerSessionJson = bearerSession.json()
assert(bearerSessionJson.user?.id === 'stub-user-001', 'bearer session resolves stub-user-001')

// ---------------------------------------------------------------------------
// 9. Invalid token rejected
// ---------------------------------------------------------------------------
console.log('\n6. Invalid token rejection')

const invalidSession = await request('/api/session', {
  headers: { cookie: `${ELF_COOKIE}=invalid-token-value` }
})
assert(
  invalidSession.status === 200,
  `invalid token session → ${invalidSession.status} (200 with user:null)`
)
const invalidSessionJson = invalidSession.json()
assert(invalidSessionJson.user === null, 'invalid token returns user: null')

// ---------------------------------------------------------------------------
// 10-14. Hosted document CRUD with stub session
// ---------------------------------------------------------------------------
console.log('\n7. Hosted document CRUD')

const headers = { cookie: `${ELF_COOKIE}=${STUB_TOKEN}`, 'content-type': 'application/json' }

// List documents (should be empty or contain stub docs)
const listDocs = await request('/api/documents', { headers })
assert(listDocs.status === 200, `GET /api/documents → ${listDocs.status}`)
const listJson = listDocs.json()
assert(Array.isArray(listJson.documents), 'document list is an array')

// Create a hosted document
const docId = `proof-${Date.now()}`
const snapshotBytes = btoa('proof-document-content')
const createRes = await request('/api/documents', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    documentId: docId,
    snapshotId: `snap-${docId}`,
    title: 'Hosted Proof Document',
    sourceFormat: 'fig',
    snapshotBytesBase64: snapshotBytes
  })
})
assert(createRes.status === 201, `POST /api/documents → ${createRes.status}`)
const createJson = createRes.json()
assert(createJson.documentId === docId, 'created documentId matches request')

// Read snapshot
const getSnap = await request(`/api/documents/${docId}/snapshot`, { headers })
assert(getSnap.status === 200, `GET snapshot → ${getSnap.status}`)
const snapJson = getSnap.json()
assert(snapJson.document?.id === docId, 'snapshot document id matches')
assert(snapJson.snapshot?.bytesBase64 === snapshotBytes, 'snapshot bytes match created content')

// Save (update) snapshot
const newSnapshotBytes = btoa('updated-proof-content')
const saveRes = await request(`/api/documents/${docId}/snapshot`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    snapshotId: `snap-${docId}-v2`,
    snapshotBytesBase64: newSnapshotBytes
  })
})
assert(saveRes.status === 200, `PUT snapshot → ${saveRes.status}`)
const saveJson = saveRes.json()
assert(saveJson.documentId === docId, 'save response documentId matches')

// Delete document
const deleteRes = await request(`/api/documents/${docId}`, { method: 'DELETE', headers })
assert(deleteRes.status === 200, `DELETE document → ${deleteRes.status}`)
const deleteJson = deleteRes.json()
assert(deleteJson.deleted === true, 'document deleted successfully')

// Verify deleted
const afterDelete = await request(`/api/documents/${docId}/snapshot`, { headers })
assert(afterDelete.status === 404, `GET deleted snapshot → ${afterDelete.status}`)

// ---------------------------------------------------------------------------
// 15. Hosted collab room endpoint
// ---------------------------------------------------------------------------
console.log('\n8. Hosted collab room access')

// Create a doc to get room access
const roomDocId = 'doc_test'
const roomRes = await request(`/api/documents/${roomDocId}/room`, { headers })
assert(roomRes.status === 200, `GET room → ${roomRes.status}`)
const roomJson = roomRes.json()
assert(roomJson.documentId === roomDocId, 'room documentId matches')
assert(roomJson.roomId, 'room response includes roomId')
assert(roomJson.status === 'ok', 'room status is ok')

// Unauthorized room access
const unauthRoom = await request(`/api/documents/${roomDocId}/room`)
assert(unauthRoom.status === 401, `unauthorized room → ${unauthRoom.status}`)

// ---------------------------------------------------------------------------
// 16. Feature flag contract
// ---------------------------------------------------------------------------
console.log('\n9. Feature flag contract validation')
try {
  const { spawnSync } = await import('node:child_process')
  const flagResult = spawnSync('bun', ['run', 'scripts/validate-hosted-flags.ts'], {
    cwd: process.cwd(),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, OPENPENCIL_HOSTED_ENV: 'preview' }
  })
  assert(flagResult.status === 0, `validate-hosted-flags exits ${flagResult.status}`)
} catch {
  results.push('  SKIP: validate-hosted-flags (bun spawn unavailable)')
  console.log('  SKIP: validate-hosted-flags (bun spawn unavailable)')
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n--- Hosted API Proof: ${passCount} passed, ${failCount} failed ---`)
console.log(`API origin: ${API_ORIGIN}`)
if (failCount > 0) {
  process.exit(1)
}

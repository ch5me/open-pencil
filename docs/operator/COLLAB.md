# OpenPencil Collaboration Architecture

## Overview

Hosted document collaboration uses Cloudflare Durable Objects (DOs) with WebSocket Hibernation.

- Each hosted document gets a `DocumentRoomDO` instance keyed by `documentId`
- Clients connect via `GET /api/collab/documents/:id/ws` (Worker upgrades and proxies to DO)
- The DO manages participant sessions, Yjs CRDT sync, and awareness (cursors/selections)
- On idle (5s no edits) or last participant disconnect, the DO flushes Yjs state to R2 as a `.fig` snapshot

## WebSocket Flow

```
Client → Worker /api/collab/documents/:id/ws
  → Auth check (session cookie / Bearer token)
  → DO lookup (DOCUMENT_ROOM.get(id))
  → WebSocket upgrade forwarded to DO
  → DO: acceptWebSocket, add participant
  → Bidirectional Yjs sync messages
```

## Recovery Procedures

### DO crashed / evicted
Cloudflare automatically restarts DOs. State is persisted in DO storage (`state.storage`).

### State diverged between clients
1. The DO is the authority — all clients sync FROM the DO
2. On reconnect, DO sends full state via `Y.encodeStateAsUpdate(yjsDoc)`
3. Client applies update with `Y.applyUpdate(localDoc, update)`

### DO lost all state
1. Load from R2 snapshot: `GET /api/documents/:id` returns `latestSnapshotKey`
2. Fetch `.fig` from R2, decode via `readFigFile()`, re-encode to Yjs
3. POST to `/api/documents/:id/flush` with Yjs binary to re-initialize DO state

### Collaboration not available (local mode)
Local mode uses P2P Trystero/WebRTC — collaboration works without the Worker.

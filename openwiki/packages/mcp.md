---
type: package-architecture
title: MCP Server Package
description: '@open-pencil/mcp exposes core design tools through stdio and HTTP MCP transports, with a localhost WebSocket bridge to the running app and root-scoped file operations.'
tags: [mcp, packages, agents, security]
---

# MCP Server Package

Published binaries are `openpencil-mcp` (stdio) and `openpencil-mcp-http` (HTTP). `src/server.ts` creates MCP sessions, registers core `ALL_TOOLS`, opens the browser WebSocket bridge, and serves `/health`, `/rpc`, and `/mcp`. `src/stdio.ts` is not an HTTP server: it connects stdio clients to an already-running app WebSocket, normally on `WS_PORT=7601`.

Configuration includes `PORT` (default 7600), `WS_PORT` (7601), `HOST` (127.0.0.1), `OPENPENCIL_MCP_ROOT`, `OPENPENCIL_MCP_AUTH_TOKEN`, `OPENPENCIL_MCP_CORS_ORIGIN`, and opt-in `OPENPENCIL_MCP_EVAL=1`. File operations are resolved under the configured root; export paths return written metadata. `GET /health` reports server/bridge readiness, `POST /rpc` requires the authenticated browser bridge and forwards app commands, and `ALL /mcp` is the Streamable HTTP MCP transport with optional bearer/header auth. `createBrowserRpcBridge` registers a token, heartbeats the socket, rejects stale/disconnected clients, and closes with the server. `createMcpSessionManager` owns session IDs, transport lookup, TTL cleanup, active-session limits, DELETE invalidation, and tool-list change notifications; The current constants are `MCP_SESSION_TTL_MS = 15 * 60_000` (15 minutes) and `MAX_MCP_SESSIONS = 10`; inspect `packages/mcp/src/mcp-sessions.ts` rather than duplicating them in a route. Focused tests cover expiry, capacity, invalidation, and transport cleanup in `packages/mcp/src/mcp-sessions.test.ts` and `tests/engine/mcp/server.test.ts`. HTTP auth is exact bearer-token comparison when configured, while `/rpc` also depends on the app bridge token; a missing bridge means browser-backed tools are unavailable rather than headlessly simulated.

The server close path shuts down the bridge, MCP sessions, and WebSocket server. The heartbeat and disconnect paths must be preserved when changing tool registration or HTTP routing. Focused coverage includes `tests/engine/mcp/server.test.ts`, path-scoping, registration, output/error serialization, and browser-disconnect tests.

Build/run: `bun --filter @open-pencil/mcp build`, `openpencil-mcp`, `openpencil-mcp-http`, `curl http://127.0.0.1:7600/health`. Focused tests include `tests/engine/mcp/path-scoping.test.ts` and `tests/engine/mcp/server.test.ts`.

# Provider-neutral agent chat boundary

## Decision

OpenPencil is an agent-chat client and a design-action host. It does not own or
model agent infrastructure.

ELF authentication is the only Firefly-specific concern in the OpenPencil
frontend. A hosted deployment may route agent requests through a Firefly-owned
service, but the application contract remains independent of that service's
runtime, provider, model, billing, worker, container, image, or registry choices.

## Ownership

| Concern                                                                       | Owner                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------- |
| ELF sign-in and OpenPencil session                                            | OpenPencil hosted shell and API                   |
| Design state and mutations                                                    | OpenPencil editor and existing `ToolDef` registry |
| Chat UI, transcript, cancellation, approval, and tool-result display          | OpenPencil                                        |
| Agent loop, routing, models, providers, billing, and execution infrastructure | Remote agent gateway                              |
| Service admission and deployment                                              | Firefly/Agent Hub/Fabric or another backend       |

OpenPencil consumes observable agent behavior. It never claims or provisions a
runtime and never selects a concrete model, provider, worker, container, image,
or registry.

## Stable contract

The browser talks only to a same-origin OpenPencil API. The first implementation
uses a versioned run endpoint and Server-Sent Events:

```text
POST /api/agent/runs
POST /api/agent/sessions/:sessionId/runs/:runId/tool-results
```

The run request contains product-level data:

- Stable request, idempotency, conversation, and message IDs.
- User input.
- Target document, page, and selection context.
- OpenPencil action-manifest identity and supported client capabilities.

The response stream uses an ordered, versioned event envelope with opaque
session, run, event, and trace IDs. Event types cover:

- Session and run start.
- Message start, text delta, and message finish.
- Action request with a stable call ID, action name, and validated arguments.
- Approval request.
- Action result or typed action error linked to the call ID.
- Run completion, failure, and receipt.

The contract does not expose runtime IDs, billing authorities, model names,
provider names, container state, image references, registry coordinates, or
deployment regions. Those may exist behind the gateway but are not OpenPencil
concepts.

## Action model

`packages/core/src/tools/**` remains the canonical definition of design
operations. Do not add a second set of chat-only or agent-native actions.

Add adapters that project existing `ToolDef` definitions into:

1. The hosted gateway action manifest.
2. The existing AI SDK tool shape for local BYOK chat.
3. MCP and CLI through their existing adapters.
4. Agent-native actions or A2A skills at the gateway edge when useful.

Action execution remains inside OpenPencil so mutations use the active editor,
targeted document/page, undo/history, validation, layout, render, and tool-log
lifecycle. Gateway action calls are untrusted requests. OpenPencil validates,
authorizes, executes, and returns the correlated result.

Remote exposure must be explicit. Extend `ToolDef` with opt-in transport policy,
including whether the action is remotely callable and whether it requires
approval. Default new and unclassified actions to remote-disabled.

## Transport choices

### Hosted browser

Use the same-origin agent gateway contract. The OpenPencil API authenticates the
ELF session and forwards a verified principal plus product-level request. Any
downstream credential exchange or routing stays inside the server adapter.

### Local browser or desktop

Keep direct BYOK models and local ACP sessions as separate transports behind the
same app chat interface. Hosted-agent capability selection is independent of
hosted auth, documents, or collaboration. When selected, it must not silently
fall back to BYOK or ACP.

### Agent-native and A2A

Agent-native actions are suitable for implementing the gateway without adding
`@agent-native/core` to OpenPencil.

A2A is optional and belongs at the gateway edge. Add it for discovery,
resumable/background tasks, or cross-agent interoperability. Do not make the
initial browser chat depend on A2A task lifecycle; interactive chat first needs
ordered streaming, client-side action continuation, cancellation, and approval.

## Failure policy

- Fail closed when the gateway is unavailable or malformed.
- Preserve typed service and action errors; do not flatten them into assistant
  text.
- Permission requests reject by default when no handler answers.
- Cancellation aborts the stream and any pending action.
- Unknown protocol versions fail explicitly; no silent downgrade.
- Reconnect uses the last event ID; unknown or expired sessions fail explicitly.
- Duplicate identical action results are idempotent; conflicting results fail.
- Opaque trace identity is required. Infrastructure and billing identity are
  neither required nor accepted by the OpenPencil contract.
- No hosted-to-local fallback.

## Implementation plan

### Phase 1: Contract and text streaming

- Add provider-neutral request, event, receipt, and error schemas under
  `api/src/agent/`.
- Replace `/api/runtime/chat` with versioned agent run and continuation routes.
- Replace `src/app/ai/runtime/firefly.ts` with
  `src/app/ai/agent-service/transport.ts`.
- Add an independent hosted-agent capability flag instead of using
  `isHostedMode()`.
- Map gateway events to the normalized `UIMessageChunk` vocabulary already used
  by ACP.
- Test ordered streaming, cancellation, malformed events, typed errors,
  reconnect, receipt validation, and no fallback.

### Phase 2: Client-executed actions

- Add a JSON-schema manifest and remote-policy adapter beside the existing
  `ToolDef` adapters.
- Execute requested actions through the existing app AI tool wrapper, not raw
  `ToolDef.execute`, so undo, layout, render, flashing, logs, and usage limits
  remain intact.
- Send correlated action results through the continuation endpoint.
- Test action allowlisting, argument validation, document/page targeting,
  approval rejection, duplicate/conflicting results, undo, and rendering.

### Phase 3: Session durability

- Persist the gateway-issued canonical session ID separately from the
  client-generated conversation ID.
- Implement `Last-Event-ID`, explicit session expiry, abort-to-cancel, and
  interrupted-stream recovery.
- Add an end-to-end test: hosted prompt, streamed action request, local design
  mutation, action result, and final assistant response.

### Phase 4: Optional interoperability

- Expose the gateway run operation as an agent-native action when that reduces
  gateway duplication.
- Add an A2A skill/task adapter for durable background design jobs if required.
- Keep both protocol choices invisible to OpenPencil components, editor core,
  and `ToolDef` definitions.

### Phase 5: Delete legacy coupling

- Delete runtime claim/status/health calls and billing receipt validation.
- Replace Firefly-runtime names and configuration with generic agent-gateway
  names.
- Update focused tests and drift-ledger entries.
- Verify repository-wide searches contain no external hosting vendor, registry,
  image, container-provisioning, runtime-provisioning, provider-selection, or
  billing claims for agent chat.

## Acceptance

- Hosted chat requires only ELF session state plus a configured agent gateway.
- OpenPencil request and response schemas contain no infrastructure fields.
- The same canonical design actions remain available through local chat, hosted
  chat, MCP, and CLI.
- Hosted runs stream text, action calls, action results, errors, approval, and
  cancellation.
- A fake conforming gateway passes the complete contract suite without any
  Firefly-specific implementation.
- Replacing the backend requires changing one API adapter, not the editor, chat
  components, or `ToolDef` registry.

## Non-goals

- Runtime provisioning or health management.
- Container, worker, image, or registry management.
- Provider, model, or account selection.
- Billing calculation or billing-authority validation.
- Reimplementing Agent Hub, Agent Fabric, ACP, A2A, or agent-native internals.
- Sending ELF credentials directly to third-party model providers.

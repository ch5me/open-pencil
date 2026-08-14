# Provider-neutral agent chat boundary

## Decision

OpenPencil is an agent-chat client and a design-action host. It does not own or
model agent infrastructure. Hosted agent chat is an independent capability,
`hostedAgent`; it is not implied by ELF authentication, hosted documents, or
collaboration.

ELF authenticates a user to the hosted OpenPencil product. The generic agent
gateway is a separate service boundary. An ELF session admits a hosted request,
but ELF does not define the gateway protocol and no ELF credential is sent to a
model provider. The gateway may make its own provider, model, billing, worker,
runtime, container, image, or registry choices; none are OpenPencil contract
fields.

## Ownership

| Concern                                                                       | Owner                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| ELF sign-in and OpenPencil session                                            | OpenPencil hosted shell and API                    |
| Hosted-agent capability and transport selection                               | OpenPencil app configuration                       |
| Design state and mutations                                                    | OpenPencil editor and canonical `ToolDef` registry |
| Chat UI, transcript, cancellation, resume, approval, and tool-result display  | OpenPencil                                         |
| Agent loop, routing, models, providers, billing, and execution infrastructure | Agent gateway                                      |
| Gateway deployment and admission beyond the OpenPencil session                | Gateway operator                                   |

OpenPencil consumes observable agent behavior. It never claims, provisions, or
health-checks a runtime and never selects a hosted model, provider, worker,
container, image, registry, or billing authority.

## Hosted operation

The OpenPencil API connects to an externally operated gateway through
`OPENPENCIL_AGENT_GATEWAY_ORIGIN`. The gateway operator owns and deploys that
service; it is not an OpenPencil-deployed hosted service. In particular,
`.ch5/environments.yaml` describes OpenPencil environments and does not deploy,
provision, or manage the gateway.

`OPENPENCIL_AGENT_GATEWAY_TOKEN` is the optional service credential used by the
OpenPencil API when it calls a non-loopback gateway. Production and staging
project it through Hush into the API deployment rather than storing it in Git.
It is API-only: never expose it through a `VITE_*` variable, browser bundle,
client configuration, response, log, or documentation example. The browser
authenticates to OpenPencil with its ELF session; only the OpenPencil API adds
gateway service authentication to the server-to-server request.

The origin is non-secret configuration and may be set directly on the
OpenPencil API deployment. A missing origin, or a missing token for a
non-loopback origin, makes hosted chat fail closed. Local deterministic gateway
fixtures may use a loopback origin without a service token.

The gateway obtains its principal-scoped options from the Agent Native-owned
endpoint in `AGENT_NATIVE_CATALOG_URL`; `AGENT_NATIVE_CATALOG_TOKEN` is an
required server-only source credential for HTTPS sources. Loopback development
may omit it. The gateway forwards the verified OpenPencil principal to Agent
Native and requires an exact `{ catalog, issuedAt, expiresAt }` envelope.
`AGENT_NATIVE_CATALOG_MAX_AGE_SECONDS` sets the maximum age (300 seconds by
default). Missing configuration,
network or HTTP failure, invalid JSON/schema, expired or over-age metadata, and
forbidden provider/infrastructure fields all fail closed. The gateway has no
authored production catalog or fallback. Tests inject a provider-neutral source
fixture instead of sharing production catalog data.

## Stable contract

The browser talks only to the configured OpenPencil API boundary and never calls
the agent gateway directly. The versioned contract has a run route plus explicit
continuation, cancellation, and current-run reconnect operations.
The exact route declarations and environment binding live at the API boundary,
not in editor or chat components.

A run contains only product-level data:

- Stable request, idempotency, conversation, and message IDs.
- User input.
- Target document, page, and selection context.
- Action-manifest identity and supported client capabilities.

The ordered event envelope contains opaque session, run, and event IDs.
Events represent session/run lifecycle, streamed assistant text, action and
approval requests, correlated action results or typed errors, and terminal
completion or failure. Reconnect continues after the last accepted event ID
while the current run identity remains in memory; cancellation addresses the
opaque run. Each tool call uses a stable call ID, and its approval outcome plus
execution result use one correlated, idempotent continuation.

The request, event, continuation, receipt, and error schemas do not accept or
return runtime IDs, model or provider names, billing data, worker/container
state, image references, registry coordinates, or deployment regions. Such
details may exist behind the gateway but are not OpenPencil concepts.

## Action model

`packages/core/src/tools/**` is the single definition of design operations.
Remote exposure is default-off and currently resolved from `ToolDef.remote` or
the bounded `GATEWAY_REMOTE_POLICIES` compatibility allowlist. The hosted
manifest adapter projects only enabled definitions to JSON Schema, while the
existing AI adapter, MCP, and CLI continue to project the same definitions for
their transports.

Gateway action calls are untrusted. OpenPencil validates the action name and
arguments, requests approval when policy requires it, and executes through the
existing app tool wrapper. This preserves active document/page targeting, undo,
layout, rendering, flashing, tool logs, and current step-budget checks. It then posts the
correlated result or typed action error as a continuation. The gateway never
mutates the scene graph directly.

ACP and the hosted gateway share a product permission abstraction so the UI has
one fail-closed approval queue and response model. ACP process permissions and
hosted design-action approvals remain different transport inputs; neither is
allowed to bypass the action policy.

## Transport selection

The app selects the hosted gateway when `hostedAgent` is enabled. This decision
is independent of `hostedAuth`, `hostedDocs`, and `hostedCollab`; deployments
must configure the combination deliberately. A hosted-agent request without an
authenticated hosted session or gateway configuration fails explicitly.

When `hostedAgent` is disabled, local browser/desktop users may select direct
BYOK chat or a local ACP agent using their existing settings. The hosted
transport never silently falls back to BYOK or ACP, including after a gateway
error, malformed event, interrupted stream, failed resume, rejected approval,
or cancellation.

An opt-in local E2E lane uses deterministic run behavior and an injected catalog
fixture and requires the local API and gateway services. Unit and contract tests
cover protocol behavior without external providers. Fixtures are not production
fallbacks.

## Lifecycle and failure policy

- Stream events are versioned and ordered; unknown versions and event gaps fail
  explicitly rather than downgrading.
- Cancellation aborts local stream consumption, rejects pending approval for the
  run, prevents later local execution, and sends the run cancellation operation
  when a run ID is known.
- Reconnect uses the canonical gateway session/run identity and last event ID.
  Browser reload recovery persists only bounded, expiring, document-scoped
  provider-neutral run identity and one pending continuation in session
  storage. Unknown cursors, corrupt state, and identity conflicts fail
  explicitly.
- Reload recovery resumes execution and future output only. The prior transcript
  remains process-local and is not persisted with run identity.
- Approval rejects by default when no handler answers. A rejection is returned
  as a continuation, not flattened into assistant text.
- Duplicate identical continuations are idempotent; a conflicting result for
  the same call ID fails.
- Service, protocol, approval, and action errors remain typed.
- Trace identity is opaque. Infrastructure and billing identity are neither
  required nor accepted.
- There is no hosted-to-local fallback.

## Reconciliation surface

Additive CH5 surfaces include the shared agent-contract package, hosted transport
and execution modules, hosted flag resolver, API gateway modules, OpenPencil API
configuration, and deterministic gateway tooling. Gateway deployment remains
external and owned by its operator.

Edits to upstream-owned files are named by exact path and symbol in
`docs/ch5/upstream-drift.md`, with an invalidation signal, replay rule, and
focused proof. Do not infer that an additive module needs an upstream drift row.

## Verification boundary

Contract coverage should use a deterministic conforming run fixture with an
injected HTTP/source catalog fixture to exercise
ordered streaming, malformed events, typed failures, cancellation, resume,
approval, action continuation, duplicate/conflicting results, and the
no-fallback rule. A complete integration proof also needs a hosted prompt that
requests an approved local design mutation, receives its result, and finishes
the assistant response. Documentation of this architecture is not evidence
that a live external gateway or deployment has passed that proof.

## Non-goals

- Runtime provisioning, status, or health management.
- Worker, container, image, or registry management.
- Provider credentials, endpoints, account configuration, or routing-policy editing.
- Provider-native model configuration. OpenPencil may display gateway-issued product labels and
  return opaque option and effort identifiers from the principal-scoped Agent Native catalog.
- Billing calculation, receipt validation, or billing authority.
- Reimplementing Agent Hub, Agent Fabric, ACP, A2A, or agent-native internals.
- Sending ELF credentials directly to third-party model providers.

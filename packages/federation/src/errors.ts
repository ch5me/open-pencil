/**
 * Public error classes for the federation surface.
 *
 * These are the typed errors that the {@link FederationClient} and wire
 * helpers may surface to a second-cohort sub-app. They are part of the
 * public compatibility contract: error `code` strings must remain stable
 * once a MAJOR version is published.
 *
 * @module errors
 */

// ---------------------------------------------------------------------------
// Top-level surface error
// ---------------------------------------------------------------------------

/**
 * Base class for every error the federation surface may throw. Catch this
 * if you do not want to handle each code branch individually.
 */
export abstract class FederationError extends Error {
  abstract readonly code: string
  constructor(message: string) {
    super(message)
    this.name = 'FederationError'
  }
}

// ---------------------------------------------------------------------------
// Session / auth errors
// ---------------------------------------------------------------------------

/** Codes returned by /api/session and the session client. */
export type SessionErrorCode =
  | 'session-bootstrap-failed'
  | 'identity-conflict'
  | 'invalid-token'
  | 'missing-session'
  | 'network-error'

/** Thrown by {@link SessionClient.resolve} when the API rejects the credentials. */
export class SessionError extends FederationError {
  readonly code: SessionErrorCode
  constructor(code: SessionErrorCode, message: string) {
    super(message)
    this.name = 'SessionError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Document API errors
// ---------------------------------------------------------------------------

/** Codes returned by /api/documents/* and the document client. */
export type DocumentApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'missing-snapshot'
  | 'missing-fields'
  | 'empty-snapshot'
  | 'hosted-runtime-unavailable'
  | 'illegal-operation'
  | 'missing-capability'
  | 'missing-source'
  | 'unsupported-source-format'
  | 'missing-owner'
  | 'unsupported-transition'
  | 'missing-source-metadata'
  | 'missing-asset-metadata'
  | 'missing-snapshot-bytes'
  | 'internal-server-error'

/** Thrown by {@link DocumentClient} when the API rejects a request. */
export class HostedApiError extends FederationError {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown> | null
  constructor(status: number, code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'HostedApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Thrown by a backend seam (e.g. DocumentBackend implementations) when a
 * caller asks for an operation the backend cannot legally perform in the
 * current operating mode. Mirrors the DocumentBackendOperationError shape.
 */
export class DocumentBackendOperationError extends FederationError {
  readonly code: 'illegal-operation' | 'missing-capability' | 'hosted-runtime-unavailable' | 'missing-source'
  readonly details: { backendId: string; mode: string; operation?: string }
  constructor(
    code: 'illegal-operation' | 'missing-capability' | 'hosted-runtime-unavailable' | 'missing-source',
    message: string,
    details: { backendId: string; mode: string; operation?: string }
  ) {
    super(message)
    this.name = 'DocumentBackendOperationError'
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// Room / wire errors
// ---------------------------------------------------------------------------

/** Codes returned by the room WebSocket bootstrap. */
export type RoomErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'room-bootstrap-failed'
  | 'malformed-wire-message'
  | 'unsupported-wire-version'
  | 'connection-failed'
  | 'snapshot-hydration-failed'

/** Thrown when a hosted room cannot be joined or the wire protocol breaks. */
export class RoomError extends FederationError {
  readonly code: RoomErrorCode
  constructor(code: RoomErrorCode, message: string) {
    super(message)
    this.name = 'RoomError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isFederationError(value: unknown): value is FederationError {
  return value instanceof FederationError
}

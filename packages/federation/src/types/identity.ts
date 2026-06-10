/**
 * Public, versioned identity types for the CH5 ELF federation surface.
 *
 * These are the canonical identity shapes every second-cohort sub-app must
 * understand. Identity fields are opaque strings, not names; sub-apps must
 * never derive identity from display names, paths, or user input.
 *
 * Mirrors api/src/documents/schema.ts (HostedDocumentRecord etc.) but is
 * re-shaped to be public-safe and importable without depending on the
 * Cloudflare worker internals.
 *
 * @module types/identity
 */

export type ElfUserId = string

/**
 * ELF JWT payload. Only the public fields a sub-app needs to read.
 * Internal fields (issuer, audience, etc.) are stripped because they are
 * platform implementation details.
 */
export type ElfTokenPayload = {
  elfUserId: ElfUserId
  exp: number
  iat: number
}

/** Source format for a hosted document. */
export type HostedDocumentSourceFormat = 'fig' | 'pen'

/** Lifecycle state of a hosted document. */
export type HostedDocumentLifecycleState = 'active' | 'archived'

/** Kind of binary asset bundled with a snapshot. */
export type HostedAssetKind = 'image' | 'font' | 'binary'

/** Reason a snapshot was written. */
export type HostedSnapshotReason = 'initial-import' | 'manual-save' | 'autosave' | 'duplicate'

/** Why a hosted document was created. */
export type HostedMigrationKind = 'create-empty' | 'import-local' | 'promote-local' | 'duplicate-hosted'

/** Where the document's bytes came from at hosted-create time. */
export type HostedMigrationSourceKind =
  | 'untitled-memory'
  | 'browser-file-handle'
  | 'tauri-file-path'
  | 'browser-download'
  | 'io-registry'
  | 'hosted-document'

/** Migration state. */
export type HostedMigrationState = 'pending' | 'complete' | 'failed'

/**
 * Federation surface version.
 *
 * This constant is the source of truth for the public compatibility surface
 * exposed by `@open-pencil/federation`. Sub-app consumers can read it to
 * gate behavior on a known surface version.
 *
 * Versioning rules (semver):
 * - MAJOR: removing or renaming any exported symbol; tightening a type; changing
 *   the wire protocol message types; changing the room WebSocket subprotocol.
 * - MINOR: adding a new exported symbol, adding a new optional wire message,
 *   adding a new optional API endpoint.
 * - PATCH: doc-only or implementation-only changes that do not affect shape.
 *
 * Once 1.0.0 is shipped, no breaking changes may land on the public surface
 * without a MAJOR bump. New sub-app consumers can pin to a MAJOR version.
 */
export const FEDERATION_SURFACE_VERSION = '0.1.0' as const

/** Library identifier used in `User-Agent`-style headers. */
export const FEDERATION_SURFACE_NAME = '@open-pencil/federation' as const

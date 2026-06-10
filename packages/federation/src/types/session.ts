/**
 * Public session types. The {@link SessionClient} returns one of these
 * shapes; sub-apps must handle the `loading` and `unauthenticated` cases
 * explicitly because the federation surface never throws on missing auth.
 *
 * @module types/session
 */

import type { ElfUserId, ElfTokenPayload } from './identity'

/** Identity returned by the session bootstrap. */
export type SessionUser = {
  id: ElfUserId
}

/** State machine for the consumer-visible session. */
export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'error' }

/**
 * Result of session bootstrap. The discriminator `type` is the public,
 * versioned field; sub-apps must switch on it.
 */
export type SessionResolveOutcome =
  | { type: 'authenticated'; userId: ElfUserId; token: string }
  | { type: 'unauthenticated' }
  | { type: 'unauthorized'; reason: 'identity-conflict' | 'invalid-token' }

/** Decoded shape after a successful verify. */
export type VerifiedElfToken = {
  payload: ElfTokenPayload
  token: string
}

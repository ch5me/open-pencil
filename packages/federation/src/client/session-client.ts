import type { SessionResolveOutcome, SessionUser } from '../types/session'

/**
 * Public session client. Every second-cohort sub-app obtains one of these
 * from {@link createFederationClient} and uses it to learn whether the
 * current request has a valid ELF session.
 *
 * `resolve()` never throws on missing auth — it returns the discriminated
 * outcome. Network and JSON errors are surfaced as `status: 'error'` so
 * sub-apps can render an explicit error state without try/catch plumbing.
 *
 * @module client/session-client
 */
export interface SessionClient {
  /**
   * Returns the discriminated session outcome. Sub-apps must branch on
   * the `type` field; `unauthenticated` is a normal first-visit state, not
   * an error.
   */
  resolve(): Promise<SessionResolveOutcome>

  /** Convenience that returns a Vue/React-friendly state-machine value. */
  state(): Promise<{ status: 'loading' } | SessionStateResolved>

  /**
   * Returns the currently authenticated user, or null when no session
   * exists. Useful for header rendering; the full outcome is richer.
   */
  currentUser(): Promise<SessionUser | null>
}

export type SessionStateResolved =
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'error' }

/**
 * Auth seam stub — to be replaced by @ch5me/elf-auth-client RS256+JWKS verifier.
 *
 * Hosted identity contract: cookie-first browser sessions with bearer fallback.
 * See packages/docs/development/hosted-operating-modes.md and elf-auth-naming.md.
 */

export type ElfUserId = string

export type ElfTokenPayload = {
  elfUserId: ElfUserId
  exp: number
  iat: number
}

/** Stub verifier — always returns the same user. Replace with createElfVerifier from @ch5me/elf-auth-client. */
export async function verifyElfToken(
  _token: string
): Promise<ElfTokenPayload | null> {
  // TODO: wire RS256 + JWKS verifier from @ch5me/elf-auth-client
  return {
    elfUserId: 'stub-user-001',
    exp: Date.now() / 1000 + 3600,
    iat: Date.now() / 1000
  }
}

/** Extract bearer token from Authorization header. */
export function bearerToken(header: string | undefined | null): string | null {
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
}

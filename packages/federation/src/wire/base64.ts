/**
 * Base64 helpers for the hosted room wire protocol.
 *
 * The protocol ships binary Yjs/awareness updates as base64 strings inside
 * JSON messages, so both ends must agree on chunked encoding (large
 * `String.fromCharCode` calls blow the call stack on some runtimes).
 *
 * @module wire/base64
 */

const CHUNK_SIZE = 0x8000

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

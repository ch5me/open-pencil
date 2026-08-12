const ROOM_HASH_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const ROOM_HASH_SALT = 'openpencil:hosted-room:v1:'

export async function deriveHostedRoomId(documentId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${ROOM_HASH_SALT}${documentId}`)
  )
  return `op_room_${base32LowerNoPad(new Uint8Array(digest)).slice(0, 32)}`
}

function base32LowerNoPad(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ROOM_HASH_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ROOM_HASH_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

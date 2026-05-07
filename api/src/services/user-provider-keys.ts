import type { Env } from '../env'

export type ManagedProviderId = 'openrouter' | 'scenario'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptValue(secret: string, plainText: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importEncryptionKey(secret)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainText)
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipherBuffer))}`
}

async function decryptValue(secret: string, payload: string): Promise<string> {
  const [ivPart, cipherPart] = payload.split('.')
  if (!ivPart || !cipherPart) throw new Error('Invalid encrypted payload')
  const key = await importEncryptionKey(secret)
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(cipherPart)
  )
  return new TextDecoder().decode(plainBuffer)
}

function getEncryptionSecret(env: Env): string {
  const secret = env.USER_KEY_ENCRYPTION_SECRET ?? env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('User key encryption is not configured')
  return secret
}

export class UserProviderKeyService {
  constructor(private env: Env) {}

  async has(userId: string, providerId: ManagedProviderId): Promise<boolean> {
    const row = await this.env.DB.prepare(
      'SELECT id FROM user_provider_keys WHERE userId = ? AND providerId = ? LIMIT 1'
    )
      .bind(userId, providerId)
      .first<{ id: string }>()
    return Boolean(row)
  }

  async get(userId: string, providerId: ManagedProviderId): Promise<string | null> {
    const row = await this.env.DB.prepare(
      'SELECT encryptedKey FROM user_provider_keys WHERE userId = ? AND providerId = ? LIMIT 1'
    )
      .bind(userId, providerId)
      .first<{ encryptedKey: string }>()
    if (!row) return null
    return decryptValue(getEncryptionSecret(this.env), row.encryptedKey)
  }

  async set(userId: string, providerId: ManagedProviderId, plainTextKey: string): Promise<void> {
    const now = Date.now()
    const encryptedKey = await encryptValue(getEncryptionSecret(this.env), plainTextKey)
    const existing = await this.env.DB.prepare(
      'SELECT id FROM user_provider_keys WHERE userId = ? AND providerId = ? LIMIT 1'
    )
      .bind(userId, providerId)
      .first<{ id: string }>()

    if (existing?.id) {
      await this.env.DB.prepare(
        'UPDATE user_provider_keys SET encryptedKey = ?, updatedAt = ? WHERE id = ?'
      )
        .bind(encryptedKey, now, existing.id)
        .run()
      return
    }

    await this.env.DB.prepare(
      `INSERT INTO user_provider_keys (id, userId, providerId, encryptedKey, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), userId, providerId, encryptedKey, now, now)
      .run()
  }

  async clear(userId: string, providerId: ManagedProviderId): Promise<void> {
    await this.env.DB.prepare('DELETE FROM user_provider_keys WHERE userId = ? AND providerId = ?')
      .bind(userId, providerId)
      .run()
  }
}

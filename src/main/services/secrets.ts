import { eq } from 'drizzle-orm'
import { safeStorage } from 'electron'
import { db } from '../db/client'
import { secrets } from '../db/schema'

/**
 * Keychain-backed secret storage via Electron `safeStorage`.
 *
 * Values are encrypted here and persisted as ciphertext in the `secrets` table —
 * never as plaintext in SQLite. `safeStorage` keys off the OS keychain (macOS
 * Keychain), so the ciphertext on disk is useless without the user's login.
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is unavailable on this platform')
  }
  const cipher = safeStorage.encryptString(value)
  db.insert(secrets)
    .values({ key, value: cipher })
    .onConflictDoUpdate({ target: secrets.key, set: { value: cipher } })
    .run()
}

export function getSecret(key: string): string | null {
  const row = db.select().from(secrets).where(eq(secrets.key, key)).get()
  if (!row) return null
  return safeStorage.decryptString(row.value)
}

export function deleteSecret(key: string): void {
  db.delete(secrets).where(eq(secrets.key, key)).run()
}

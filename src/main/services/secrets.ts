import { safeStorage } from 'electron'

/**
 * Keychain-backed secret storage via Electron `safeStorage`.
 *
 * Tokens are encrypted here and (later) persisted as ciphertext — never as
 * plaintext in SQLite. Stubbed with an in-memory map for the scaffold; swap the
 * map for an encrypted-at-rest store (a dedicated SQLite table holding the
 * ciphertext buffers, or a file) without changing this interface.
 */
const store = new Map<string, Buffer>()

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is unavailable on this platform')
  }
  store.set(key, safeStorage.encryptString(value))
}

export function getSecret(key: string): string | null {
  const encrypted = store.get(key)
  if (!encrypted) return null
  return safeStorage.decryptString(encrypted)
}

export function deleteSecret(key: string): void {
  store.delete(key)
}

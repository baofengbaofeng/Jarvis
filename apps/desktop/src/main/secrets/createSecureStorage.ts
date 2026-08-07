import { safeStorage } from 'electron';
import { join } from 'node:path';
import { jarvisDataDir } from '../db/connection';
import { SecureStorage } from './SecureStorage';

/** Electron safeStorage-backed secrets on every platform (DESK-04: no keychain argv). */
export function createSecureStorage(): SecureStorage {
  if (safeStorage.isEncryptionAvailable()) {
    return new SecureStorage({
      platform: process.platform,
      secretsDir: join(jarvisDataDir(), 'secrets'),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (buf) => safeStorage.decryptString(buf),
    });
  }
  return new SecureStorage({ platform: process.platform });
}

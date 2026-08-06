import { safeStorage } from 'electron';
import { join } from 'node:path';
import { jarvisDataDir } from '../db/connection';
import { SecureStorage } from './SecureStorage';

/** Platform-aware secret store: Keychain on macOS, Electron safeStorage elsewhere. */
export function createSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') return new SecureStorage();
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

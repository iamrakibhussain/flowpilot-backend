import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/modules/auth/crypto.js';

describe('Argon2id Secure Password Hashing', () => {
  it('generates a valid Argon2id hash and verifies matching plaintext', async () => {
    const plainText = 'P@ssw0rdSecure!2026';
    const hash = await hashPassword(plainText);

    expect(hash).toBeDefined();
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const isMatch = await verifyPassword(hash, plainText);
    expect(isMatch).toBe(true);
  });

  it('rejects incorrect passwords during verification', async () => {
    const plainText = 'CorrectHorseBatteryStaple';
    const hash = await hashPassword(plainText);

    const isMatch = await verifyPassword(hash, 'WrongPassword123');
    expect(isMatch).toBe(false);
  });

  it('throws an error for passwords shorter than 8 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8 characters/);
  });

  it('returns false when verifying with empty hash or empty password', async () => {
    expect(await verifyPassword('', 'password123')).toBe(false);
    expect(await verifyPassword('$argon2id$invalid', '')).toBe(false);
  });
});

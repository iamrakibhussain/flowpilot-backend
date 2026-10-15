import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
} from '../../src/modules/auth/crypto.js';

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

describe('Session Token Crypto Utilities', () => {
  it('generates 64-character hexadecimal random session tokens', () => {
    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
    expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);
  });

  it('generates deterministic SHA-256 hash for session tokens', () => {
    const token = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).not.toBe(token);
  });

  it('throws error when hashing empty or invalid token', () => {
    expect(() => hashSessionToken('')).toThrow(/Invalid token provided/);
  });
});

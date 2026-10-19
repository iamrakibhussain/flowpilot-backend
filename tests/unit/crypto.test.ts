import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  isCommonPassword,
  normalizePassword,
  timingSafeCompare,
  DUMMY_ARGON2_HASH,
  isValidSessionTokenFormat,
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

  it('throws an error for passwords exceeding 128 characters', async () => {
    const longPassword = 'A'.repeat(129) + '1a!';
    await expect(hashPassword(longPassword)).rejects.toThrow(/cannot exceed 128 characters/);
  });

  it('returns false when verifying with empty hash or empty password', async () => {
    expect(await verifyPassword('', 'password123')).toBe(false);
    expect(await verifyPassword('$argon2id$invalid', '')).toBe(false);
  });

  it('executes timing mitigation dummy Argon2id hash verification safely', async () => {
    expect(DUMMY_ARGON2_HASH.startsWith('$argon2id$')).toBe(true);
    const result = await verifyPassword(DUMMY_ARGON2_HASH, 'attempted-password-123');
    expect(result).toBe(false);
  });

  it('normalizes unicode representations to prevent homoglyph attacks', () => {
    const deconstructed = 'e\u0301'; // é as e + combining acute accent
    const composed = 'é';
    expect(normalizePassword(deconstructed)).toBe(normalizePassword(composed));
  });

  it('identifies commonly breached passwords', () => {
    expect(isCommonPassword('password')).toBe(true);
    expect(isCommonPassword('12345678')).toBe(true);
    expect(isCommonPassword('admin123')).toBe(true);
    expect(isCommonPassword('UniqueSecureP@ssword2026!')).toBe(false);
  });

  it('performs constant-time string comparison', () => {
    expect(timingSafeCompare('secret-token-123', 'secret-token-123')).toBe(true);
    expect(timingSafeCompare('secret-token-123', 'secret-token-456')).toBe(false);
    expect(timingSafeCompare('short', 'longer-string')).toBe(false);
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

  describe('Session Token Format Validation (isValidSessionTokenFormat)', () => {
    it('approves standard 64-character hex session tokens', () => {
      const validToken = generateSessionToken();
      expect(isValidSessionTokenFormat(validToken)).toBe(true);
    });

    it('approves tokens with safe length between 16 and 128 characters', () => {
      expect(isValidSessionTokenFormat('1234567890abcdef1234')).toBe(true);
      expect(isValidSessionTokenFormat('a'.repeat(128))).toBe(true);
    });

    it('rejects tokens shorter than 16 characters', () => {
      expect(isValidSessionTokenFormat('short-token')).toBe(false);
      expect(isValidSessionTokenFormat('')).toBe(false);
    });

    it('rejects tokens longer than 128 characters (DoS mitigation)', () => {
      expect(isValidSessionTokenFormat('a'.repeat(129))).toBe(false);
      expect(isValidSessionTokenFormat('a'.repeat(1000))).toBe(false);
    });

    it('rejects tokens containing whitespace, control characters, or injection delimiters', () => {
      expect(isValidSessionTokenFormat('token with spaces in between')).toBe(false);
      expect(isValidSessionTokenFormat('token\x00withnullbyte')).toBe(false);
      expect(isValidSessionTokenFormat('token\r\nwithnewline')).toBe(false);
      expect(isValidSessionTokenFormat('<script>alert(1)</script>12345')).toBe(false);
      expect(isValidSessionTokenFormat('"quotedtoken1234567"')).toBe(false);
      expect(isValidSessionTokenFormat("'singlequoted12345'")).toBe(false);
    });

    it('rejects non-string inputs', () => {
      expect(isValidSessionTokenFormat(null)).toBe(false);
      expect(isValidSessionTokenFormat(undefined)).toBe(false);
      expect(isValidSessionTokenFormat(1234567890123456)).toBe(false);
      expect(isValidSessionTokenFormat({})).toBe(false);
    });
  });
});

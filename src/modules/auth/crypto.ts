import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';

/**
 * Argon2id password hashing parameters adhering strictly to OWASP recommendations.
 * Memory: 64MB (65536 KiB), Time iterations: 3, Parallelism: 4.
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
  parallelism: 4,
};

/**
 * High-risk commonly breached or trivial passwords to reject unconditionally.
 */
export const COMMON_PASSWORDS = new Set([
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'password123',
  'admin123',
  'admin1234',
  'administrator',
  'welcome1',
  'welcome123',
  'letmein1',
  'iloveyou',
  'monkey123',
  'dragon123',
  'master123',
  'sunshine1',
  'princess1',
  'football1',
  'shadow123',
  'trustno1',
  'superman1',
  'charlie1',
  'killer123',
  'starwars1',
  'passw0rd',
  'passw0rd1',
  'default123',
  'flowpilot123',
]);

/**
 * Normalizes password strings using Unicode NFKC form to prevent homoglyph & equivalence bypass attacks.
 */
export function normalizePassword(plainText: string): string {
  if (!plainText || typeof plainText !== 'string') {
    return '';
  }
  return plainText.normalize('NFKC');
}

/**
 * Checks if a candidate password matches known common/breached patterns.
 */
export function isCommonPassword(password: string): boolean {
  if (!password || typeof password !== 'string') {
    return true;
  }
  const normalized = normalizePassword(password).trim().toLowerCase();
  return COMMON_PASSWORDS.has(normalized);
}

/**
 * Constant-time string comparison to protect against side-channel timing attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hashes a plaintext password using Argon2id with memory-hard parameters.
 */
export async function hashPassword(plainText: string): Promise<string> {
  if (!plainText || plainText.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  if (plainText.length > 128) {
    throw new Error('Password cannot exceed 128 characters');
  }

  const normalized = normalizePassword(plainText);
  return hash(normalized, ARGON2_OPTIONS);
}

/**
 * Pre-computed valid Argon2id hash adhering strictly to the same OWASP memory and time parameters.
 * Used during login when an account does not exist to equalize verification latency and prevent timing attacks.
 */
export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$eGHQLsaZQ7gD1xxuW+wL3g$qnk9EJEE+Vb/ZxOJmYjmzVUNGaVy2rg/Stt9cg2+ekA';

/**
 * Verifies a plaintext password against an Argon2id hash with safe error absorption.
 */
export async function verifyPassword(hashString: string, plainText: string): Promise<boolean> {
  if (!hashString || !plainText) {
    return false;
  }
  try {
    const normalized = normalizePassword(plainText);
    return await verify(hashString, normalized);
  } catch {
    return false;
  }
}

/**
 * Generates a high-entropy cryptographically secure random session token.
 * 32 bytes (256 bits) encoded as a 64-character hexadecimal string.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates a deterministic SHA-256 hash of a raw session token.
 * We store this hash in the database to prevent token theft in the event of database leaks,
 * and compare hash-to-hash for O(1) indexed lookup without exposing raw tokens.
 */
export function hashSessionToken(token: string): string {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token provided for hashing');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Validates that an incoming session token adheres to safe length and character constraints,
 * preventing DoS via oversized tokens, control characters, and injection attempts.
 */
export function isValidSessionTokenFormat(token?: unknown): token is string {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) {
    return false;
  }
  for (let i = 0; i < token.length; i += 1) {
    const code = token.charCodeAt(i);
    // Disallow control characters (0-31, 127), whitespace (32), and dangerous delimiters (<, >, ", ')
    if (
      code <= 32 ||
      code === 127 ||
      code === 60 || // <
      code === 62 || // >
      code === 34 || // "
      code === 39 // '
    ) {
      return false;
    }
  }
  return true;
}

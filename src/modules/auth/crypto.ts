import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';

/**
 * Argon2id password hashing parameters adhering to OWASP recommendations.
 * Memory: 64MB (65536 KiB), Time iterations: 3, Parallelism: 4.
 */
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  outputLen: 32,
  parallelism: 4,
};

export async function hashPassword(plainText: string): Promise<string> {
  if (!plainText || plainText.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  return hash(plainText, ARGON2_OPTIONS);
}

export async function verifyPassword(hashString: string, plainText: string): Promise<boolean> {
  if (!hashString || !plainText) {
    return false;
  }
  try {
    return await verify(hashString, plainText);
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

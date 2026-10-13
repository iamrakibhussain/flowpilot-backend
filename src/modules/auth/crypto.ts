import { hash, verify } from '@node-rs/argon2';

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

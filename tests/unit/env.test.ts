import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('applies default configuration when optional variables are omitted in development', () => {
    const config = validateEnv({
      DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/test_db',
    });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.SESSION_EXPIRY_DAYS).toBe(7);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.COOKIE_SECRET).toBe('development_cookie_secret_at_least_32_characters_long_min');
    expect(config.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(config.TRUST_PROXY).toBe('false');
  });

  it('fails fast when DATABASE_URL is not a valid URL', () => {
    expect(() => {
      validateEnv({
        DATABASE_URL: 'not-a-valid-url',
      });
    }).toThrow(/Invalid environment configuration/);
  });

  it('fails fast when PORT is negative or non-numeric', () => {
    expect(() => {
      validateEnv({
        PORT: '-10',
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/test_db',
      });
    }).toThrow(/Invalid environment configuration/);
  });

  it('fails fast when COOKIE_SECRET is too short (< 32 chars)', () => {
    expect(() => {
      validateEnv({
        COOKIE_SECRET: 'too-short',
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/test_db',
      });
    }).toThrow(/COOKIE_SECRET must be at least 32 characters/);
  });

  it('accepts valid production configuration with a dedicated secret', () => {
    const config = validateEnv({
      NODE_ENV: 'production',
      COOKIE_SECRET: 'prod_unique_secure_random_key_9876543210_valid',
      DATABASE_URL: 'postgresql://postgres:secret@prod-db:5432/flowpilot_prod',
    });

    expect(config.NODE_ENV).toBe('production');
    expect(config.COOKIE_SECRET).toBe('prod_unique_secure_random_key_9876543210_valid');
  });

  it('rejects production configuration when COOKIE_SECRET is omitted (default fallback)', () => {
    expect(() => {
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@prod-db:5432/flowpilot_prod',
      });
    }).toThrow(/COOKIE_SECRET must be explicitly set to a secure, non-default value in production/);
  });

  it('rejects production configuration when COOKIE_SECRET uses known development placeholder', () => {
    expect(() => {
      validateEnv({
        NODE_ENV: 'production',
        COOKIE_SECRET: 'development_cookie_secret_at_least_32_characters_long_min',
        DATABASE_URL: 'postgresql://postgres:secret@prod-db:5432/flowpilot_prod',
      });
    }).toThrow(/COOKIE_SECRET must be explicitly set to a secure, non-default value in production/);
  });

  it('rejects wildcard CORS_ORIGIN configuration', () => {
    expect(() => {
      validateEnv({
        CORS_ORIGIN: '*',
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/test_db',
      });
    }).toThrow(/CORS_ORIGIN cannot contain wildcard '\*' when credentialed CORS is enabled/);

    expect(() => {
      validateEnv({
        CORS_ORIGIN: 'http://localhost:3000, *',
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/test_db',
      });
    }).toThrow(/CORS_ORIGIN cannot contain wildcard '\*' when credentialed CORS is enabled/);
  });
});

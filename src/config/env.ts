import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env if present
dotenv.config();

const KNOWN_DEV_COOKIE_SECRETS = new Set([
  'development_cookie_secret_at_least_32_characters_long_min',
  'replace_with_a_secure_random_string_at_least_32_chars_long',
]);

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .url()
    .default(
      'postgresql://flowpilot:flowpilot_password@localhost:5432/flowpilot_dev?schema=public',
    ),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .refine(
      (val) => {
        const origins = val.split(',').map((o) => o.trim());
        return !origins.includes('*');
      },
      {
        message: "CORS_ORIGIN cannot contain wildcard '*' when credentialed CORS is enabled",
      },
    ),
  TRUST_PROXY: z.string().default('false'),
  COOKIE_SECRET: z
    .string()
    .min(32, 'COOKIE_SECRET must be at least 32 characters')
    .default('development_cookie_secret_at_least_32_characters_long_min'),
  SESSION_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000), // 15 mins
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('FlowPilot Security <noreply@flowpilot.io>'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
});

const envSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (KNOWN_DEV_COOKIE_SECRETS.has(data.COOKIE_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECRET'],
        message:
          'COOKIE_SECRET must be explicitly set to a secure, non-default value in production',
      });
    }
  }
});

export type Env = z.infer<typeof baseEnvSchema>;

export function validateEnv(rawEnv: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`FATAL: Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

export const env = validateEnv();

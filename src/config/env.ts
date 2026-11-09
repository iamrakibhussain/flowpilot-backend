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
  DIRECT_URL: z.string().url().optional(),
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
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).optional(),
  SESSION_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
  ENABLE_BACKGROUND_JOBS: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true'),
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
  EMAIL_PROVIDER: z
    .enum(['auto', 'smtp', 'resend', 'sendgrid', 'postmark', 'test', 'console'])
    .default('auto'),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  EMAIL_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  EMAIL_RETRY_INITIAL_DELAY_MS: z.coerce.number().int().positive().default(500),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['auto', 'supabase', 's3', 'local', 'memory']).default('auto'),
  STORAGE_BUCKET_PUBLIC: z.string().default('flowpilot-public'),
  STORAGE_BUCKET_PRIVATE: z.string().default('flowpilot-private'),
  STORAGE_LOCAL_ROOT: z.string().default('uploads'),
  STORAGE_SIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_SIGNING_SECRET: z.string().default('flowpilot_storage_signing_secret_dev_32char_min'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ENDPOINT: z.string().optional(),
  AWS_S3_FORCE_PATH_STYLE: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('false'),
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

    if (data.STORAGE_PROVIDER === 'memory' || data.STORAGE_PROVIDER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message:
          'STORAGE_PROVIDER cannot be local or memory in production. A cloud storage provider (Supabase Storage or AWS S3) is required.',
      });
    }

    if (data.STORAGE_PROVIDER === 'supabase') {
      if (!data.SUPABASE_URL || !data.SUPABASE_SERVICE_ROLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_URL'],
          message:
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_PROVIDER is supabase',
        });
      }
    } else if (data.STORAGE_PROVIDER === 's3') {
      if (!data.AWS_ACCESS_KEY_ID || !data.AWS_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AWS_ACCESS_KEY_ID'],
          message:
            'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when STORAGE_PROVIDER is s3',
        });
      }
    } else if (data.STORAGE_PROVIDER === 'auto') {
      const hasSupabase = Boolean(data.SUPABASE_URL && data.SUPABASE_SERVICE_ROLE_KEY);
      const hasS3 = Boolean(data.AWS_ACCESS_KEY_ID && data.AWS_SECRET_ACCESS_KEY);
      if (!hasSupabase && !hasS3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_PROVIDER'],
          message:
            'Production requires cloud storage credentials. Set SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY or AWS S3 credentials.',
        });
      }
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

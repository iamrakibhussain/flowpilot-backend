import { EmailProvider } from './email.types.js';
import { env } from '../../config/env.js';
import { logger } from '../logging/logger.js';
import { SmtpEmailProvider } from './providers/smtp.provider.js';
import { ResendEmailProvider } from './providers/resend.provider.js';
import { SendGridEmailProvider } from './providers/sendgrid.provider.js';
import { PostmarkEmailProvider } from './providers/postmark.provider.js';
import { TestEmailProvider } from './providers/test.provider.js';
import { ConsoleSimulationProvider } from './providers/console.provider.js';

export class EmailProviderFactory {
  private static cachedProvider: EmailProvider | null = null;

  public static getProvider(): EmailProvider {
    if (this.cachedProvider) {
      return this.cachedProvider;
    }

    this.cachedProvider = this.createProvider();
    logger.info(
      {
        event: 'email.provider_initialized',
        provider: this.cachedProvider.name,
      },
      `Email infrastructure active provider: ${this.cachedProvider.name.toUpperCase()}`,
    );

    return this.cachedProvider;
  }

  public static setProvider(provider: EmailProvider | null): void {
    this.cachedProvider = provider;
  }

  public static resetProvider(): void {
    this.cachedProvider = null;
  }

  private static createProvider(): EmailProvider {
    const configuredProvider = env.EMAIL_PROVIDER;

    // 1. Explicit test provider
    if (configuredProvider === 'test') {
      return new TestEmailProvider();
    }

    // 2. Explicit or auto Resend API
    if (
      (configuredProvider === 'resend' || configuredProvider === 'auto') &&
      env.RESEND_API_KEY &&
      env.RESEND_API_KEY.trim().length > 0
    ) {
      return new ResendEmailProvider({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
      });
    }

    // 3. Explicit or auto Postmark API
    if (
      (configuredProvider === 'postmark' || configuredProvider === 'auto') &&
      env.POSTMARK_SERVER_TOKEN &&
      env.POSTMARK_SERVER_TOKEN.trim().length > 0
    ) {
      return new PostmarkEmailProvider({
        serverToken: env.POSTMARK_SERVER_TOKEN,
        from: env.EMAIL_FROM,
      });
    }

    // 4. Explicit or auto SendGrid API
    if (
      (configuredProvider === 'sendgrid' || configuredProvider === 'auto') &&
      env.SENDGRID_API_KEY &&
      env.SENDGRID_API_KEY.trim().length > 0
    ) {
      return new SendGridEmailProvider({
        apiKey: env.SENDGRID_API_KEY,
        from: env.EMAIL_FROM,
      });
    }

    // 5. Explicit or auto SMTP transport
    const hasSmtpCreds = Boolean(env.SMTP_USER && env.SMTP_PASS);
    if (configuredProvider === 'smtp' || (configuredProvider === 'auto' && hasSmtpCreds)) {
      return new SmtpEmailProvider({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.EMAIL_FROM,
        connectionTimeoutMs: env.SMTP_CONNECTION_TIMEOUT_MS,
        socketTimeoutMs: env.SMTP_SOCKET_TIMEOUT_MS,
        isProduction: env.NODE_ENV === 'production',
      });
    }

    // 6. Explicit console simulation or safe fallback
    return new ConsoleSimulationProvider();
  }
}

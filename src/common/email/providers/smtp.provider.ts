import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailDeliveryError,
} from '../email.types.js';
import { logger } from '../../logging/logger.js';

export interface SmtpProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  connectionTimeoutMs?: number;
  socketTimeoutMs?: number;
  isProduction?: boolean;
}

export class SmtpEmailProvider implements EmailProvider {
  public readonly name = 'smtp';
  private transporter: Transporter;
  private defaultFrom: string;

  constructor(config: SmtpProviderConfig) {
    this.defaultFrom = config.from;
    const cleanPass = config.pass ? config.pass.replace(/\s+/g, '') : undefined;
    const isGmail = config.host.toLowerCase().includes('gmail.com');

    const timeout = config.connectionTimeoutMs || 10000;
    const socketTimeout = config.socketTimeoutMs || 15000;

    if (isGmail && config.user && cleanPass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: config.user,
          pass: cleanPass,
        },
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout,
      });
    } else {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user && cleanPass
          ? {
              auth: {
                user: config.user,
                pass: cleanPass,
              },
            }
          : {}),
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout,
        tls: {
          rejectUnauthorized: config.isProduction ?? true,
        },
      });
    }
  }

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();

    try {
      const from = message.from || this.defaultFrom;
      const info = await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        cc: message.cc,
        bcc: message.bcc,
        attachments: message.attachments,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'high',
          ...(message.correlationId ? { 'X-Correlation-ID': message.correlationId } : {}),
          ...message.headers,
        },
      });

      return {
        success: true,
        messageId: info.messageId,
        provider: this.name,
        status: 'sent',
        latencyMs: Date.now() - startTime,
        attempts: 1,
      };
    } catch (err: unknown) {
      const classified = this.classifySmtpError(err);
      throw classified;
    }
  }

  public async verifyConnection(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const startTime = Date.now();
    try {
      await this.transporter.verify();
      return { ok: true, latencyMs: Date.now() - startTime };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, 'SMTP transport connection verification failed');
      return { ok: false, error: msg, latencyMs: Date.now() - startTime };
    }
  }

  private classifySmtpError(err: unknown): EmailDeliveryError {
    const errMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string; responseCode?: number })?.code || '';
    const responseCode = (err as { responseCode?: number })?.responseCode;

    // Transient errors (network, timeout, rate limit, server busy)
    const isTransientCode = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ESOCKETTIMEDOUT',
      'EAI_AGAIN',
      'EMFILE',
      'ENFILE',
    ].includes(code);

    const isTransientResponse =
      responseCode !== undefined &&
      (responseCode === 421 ||
        responseCode === 450 ||
        responseCode === 451 ||
        responseCode === 452 ||
        responseCode === 429);

    if (isTransientCode || isTransientResponse) {
      return new EmailDeliveryError(
        `Transient SMTP delivery failure (${code || responseCode}): ${errMsg}`,
        'TRANSIENT',
        err,
      );
    }

    // Permanent errors (5xx mailbox unavailable, user unknown, auth failed, invalid recipient)
    return new EmailDeliveryError(
      `Permanent SMTP delivery error (${code || responseCode || '5xx'}): ${errMsg}`,
      'PERMANENT',
      err,
    );
  }
}

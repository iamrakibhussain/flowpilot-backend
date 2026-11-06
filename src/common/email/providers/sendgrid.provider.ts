import {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailDeliveryError,
} from '../email.types.js';

export interface SendGridProviderConfig {
  apiKey: string;
  from: string;
  timeoutMs?: number;
}

export class SendGridEmailProvider implements EmailProvider {
  public readonly name = 'sendgrid';
  private apiKey: string;
  private defaultFrom: string;
  private timeoutMs: number;

  constructor(config: SendGridProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.defaultFrom = config.from;
    this.timeoutMs = config.timeoutMs || 10000;
  }

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();
    const fromAddress = message.from || this.defaultFrom;

    const fromMatch = fromAddress.match(/^(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)$/);
    const fromObj =
      fromMatch && fromMatch[2]
        ? { email: fromMatch[2], name: fromMatch[1] || undefined }
        : { email: fromAddress };

    const payload: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: message.to }],
          ...(message.cc
            ? {
                cc: (Array.isArray(message.cc) ? message.cc : [message.cc]).map((e) => ({
                  email: e,
                })),
              }
            : {}),
          ...(message.bcc
            ? {
                bcc: (Array.isArray(message.bcc) ? message.bcc : [message.bcc]).map((e) => ({
                  email: e,
                })),
              }
            : {}),
        },
      ],
      from: fromObj,
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    };

    if (message.attachments && message.attachments.length > 0) {
      payload.attachments = message.attachments.map((att) => ({
        content: Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : Buffer.from(att.content).toString('base64'),
        filename: att.filename,
        type: att.contentType || 'application/octet-stream',
        disposition: 'attachment',
      }));
    }

    if (message.headers) {
      payload.headers = message.headers;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const status = response.status;
        if (status === 429 || status >= 500) {
          throw new EmailDeliveryError(
            `Transient SendGrid error (${status}): ${errorBody}`,
            'TRANSIENT',
          );
        }
        throw new EmailDeliveryError(
          `Permanent SendGrid error (${status}): ${errorBody}`,
          'PERMANENT',
        );
      }

      const messageId = response.headers.get('x-message-id') || `sendgrid-${Date.now()}`;

      return {
        success: true,
        messageId,
        provider: this.name,
        status: 'sent',
        latencyMs: Date.now() - startTime,
        attempts: 1,
      };
    } catch (err: unknown) {
      if (err instanceof EmailDeliveryError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new EmailDeliveryError(
          `SendGrid API timeout after ${this.timeoutMs}ms`,
          'TRANSIENT',
          err,
        );
      }
      throw new EmailDeliveryError(
        `SendGrid network failure: ${err instanceof Error ? err.message : String(err)}`,
        'TRANSIENT',
        err,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  public async verifyConnection(): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const startTime = Date.now();
    try {
      const response = await fetch('https://api.sendgrid.com/v3/scopes', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (response.ok) {
        return { ok: true, latencyMs: Date.now() - startTime };
      }
      return {
        ok: false,
        error: `Invalid SendGrid API key (HTTP ${response.status})`,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }
}

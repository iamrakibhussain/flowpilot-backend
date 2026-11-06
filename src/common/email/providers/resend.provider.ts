import {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailDeliveryError,
} from '../email.types.js';

export interface ResendProviderConfig {
  apiKey: string;
  from: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

export class ResendEmailProvider implements EmailProvider {
  public readonly name = 'resend';
  private apiKey: string;
  private defaultFrom: string;
  private apiBaseUrl: string;
  private timeoutMs: number;

  constructor(config: ResendProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.defaultFrom = config.from;
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.resend.com';
    this.timeoutMs = config.timeoutMs || 10000;
  }

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();
    const from = message.from || this.defaultFrom;

    const payload: Record<string, unknown> = {
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
    };

    if (message.cc) {
      payload.cc = Array.isArray(message.cc) ? message.cc : [message.cc];
    }
    if (message.bcc) {
      payload.bcc = Array.isArray(message.bcc) ? message.bcc : [message.bcc];
    }

    if (message.attachments && message.attachments.length > 0) {
      payload.attachments = message.attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
      }));
    }

    if (message.headers) {
      payload.headers = message.headers;
    }
    if (message.tags) {
      payload.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiBaseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(message.correlationId ? { 'X-Entity-Ref-ID': message.correlationId } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        statusCode?: number;
        name?: string;
      };

      if (!response.ok) {
        const status = response.status;
        const errMsg = data.message || `Resend API returned HTTP ${status}`;
        if (status === 429 || status >= 500) {
          throw new EmailDeliveryError(
            `Transient Resend API failure (${status}): ${errMsg}`,
            'TRANSIENT',
            data,
          );
        }
        throw new EmailDeliveryError(
          `Permanent Resend API error (${status}): ${errMsg}`,
          'PERMANENT',
          data,
        );
      }

      return {
        success: true,
        messageId: data.id || `resend-${Date.now()}`,
        provider: this.name,
        status: 'sent',
        latencyMs: Date.now() - startTime,
        attempts: 1,
      };
    } catch (err: unknown) {
      if (err instanceof EmailDeliveryError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new EmailDeliveryError(
          `Resend API timeout after ${this.timeoutMs}ms`,
          'TRANSIENT',
          err,
        );
      }
      throw new EmailDeliveryError(
        `Resend network error: ${err instanceof Error ? err.message : String(err)}`,
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
      const response = await fetch(`${this.apiBaseUrl}/api-keys`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (response.ok) {
        return { ok: true, latencyMs: Date.now() - startTime };
      }
      return {
        ok: false,
        error: `Invalid Resend API key (HTTP ${response.status})`,
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

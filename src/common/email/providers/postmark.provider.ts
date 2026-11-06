import {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailDeliveryError,
} from '../email.types.js';

export interface PostmarkProviderConfig {
  serverToken: string;
  from: string;
  timeoutMs?: number;
}

export class PostmarkEmailProvider implements EmailProvider {
  public readonly name = 'postmark';
  private serverToken: string;
  private defaultFrom: string;
  private timeoutMs: number;

  constructor(config: PostmarkProviderConfig) {
    this.serverToken = config.serverToken.trim();
    this.defaultFrom = config.from;
    this.timeoutMs = config.timeoutMs || 10000;
  }

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();
    const from = message.from || this.defaultFrom;

    const payload: Record<string, unknown> = {
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      ReplyTo: message.replyTo,
    };

    if (message.cc) {
      payload.Cc = Array.isArray(message.cc) ? message.cc.join(', ') : message.cc;
    }
    if (message.bcc) {
      payload.Bcc = Array.isArray(message.bcc) ? message.bcc.join(', ') : message.bcc;
    }

    if (message.attachments && message.attachments.length > 0) {
      payload.Attachments = message.attachments.map((att) => ({
        Name: att.filename,
        Content: Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : Buffer.from(att.content).toString('base64'),
        ContentType: att.contentType || 'application/octet-stream',
      }));
    }

    if (message.headers) {
      payload.Headers = Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value }));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': this.serverToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as {
        MessageID?: string;
        Message?: string;
        ErrorCode?: number;
      };

      if (!response.ok) {
        const status = response.status;
        const errMsg = data.Message || `Postmark API error (${status})`;
        if (status === 429 || status >= 500) {
          throw new EmailDeliveryError(
            `Transient Postmark error (${status}): ${errMsg}`,
            'TRANSIENT',
            data,
          );
        }
        throw new EmailDeliveryError(
          `Permanent Postmark error (${status}): ${errMsg}`,
          'PERMANENT',
          data,
        );
      }

      return {
        success: true,
        messageId: data.MessageID || `postmark-${Date.now()}`,
        provider: this.name,
        status: 'sent',
        latencyMs: Date.now() - startTime,
        attempts: 1,
      };
    } catch (err: unknown) {
      if (err instanceof EmailDeliveryError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new EmailDeliveryError(
          `Postmark API timeout after ${this.timeoutMs}ms`,
          'TRANSIENT',
          err,
        );
      }
      throw new EmailDeliveryError(
        `Postmark network error: ${err instanceof Error ? err.message : String(err)}`,
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
      const response = await fetch('https://api.postmarkapp.com/server', {
        headers: { 'X-Postmark-Server-Token': this.serverToken },
      });
      if (response.ok) {
        return { ok: true, latencyMs: Date.now() - startTime };
      }
      return {
        ok: false,
        error: `Invalid Postmark Server Token (HTTP ${response.status})`,
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

import {
  EmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailDeliveryError,
  EmailErrorType,
} from '../email.types.js';

export class TestEmailProvider implements EmailProvider {
  public readonly name = 'test';
  private sentEmails: Array<EmailMessage & { timestamp: Date; id: string }> = [];
  private failNextError: { message: string; errorType: EmailErrorType } | null = null;
  private failCount = 0;

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();

    if (this.failNextError && this.failCount > 0) {
      this.failCount--;
      const err = this.failNextError;
      if (this.failCount === 0) {
        this.failNextError = null;
      }
      throw new EmailDeliveryError(err.message, err.errorType);
    }

    const id = `test-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.sentEmails.push({
      ...message,
      timestamp: new Date(),
      id,
    });

    return {
      success: true,
      messageId: id,
      provider: this.name,
      status: 'sent',
      latencyMs: Date.now() - startTime,
      attempts: 1,
    };
  }

  public async verifyConnection(): Promise<{ ok: boolean; latencyMs?: number }> {
    return { ok: true, latencyMs: 1 };
  }

  public getSentEmails(): Array<EmailMessage & { timestamp: Date; id: string }> {
    return [...this.sentEmails];
  }

  public getLastEmail(): (EmailMessage & { timestamp: Date; id: string }) | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  public clear(): void {
    this.sentEmails = [];
    this.failNextError = null;
    this.failCount = 0;
  }

  public simulateFailure(
    message: string,
    errorType: EmailErrorType = 'TRANSIENT',
    times = 1,
  ): void {
    this.failNextError = { message, errorType };
    this.failCount = times;
  }
}

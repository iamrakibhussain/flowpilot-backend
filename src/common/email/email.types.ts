export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  correlationId?: string;
  tags?: Record<string, string>;
}

export type EmailDeliveryStatus = 'sent' | 'queued' | 'simulated' | 'failed';

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  status: EmailDeliveryStatus;
  error?: string;
  errorCode?: string;
  latencyMs?: number;
  attempts?: number;
}

export type EmailErrorType = 'TRANSIENT' | 'PERMANENT' | 'CONFIGURATION' | 'VALIDATION';

export class EmailDeliveryError extends Error {
  public readonly errorType: EmailErrorType;
  public readonly originalError?: unknown;
  public readonly isRetryable: boolean;

  constructor(message: string, errorType: EmailErrorType = 'TRANSIENT', originalError?: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.errorType = errorType;
    this.originalError = originalError;
    this.isRetryable = errorType === 'TRANSIENT';
  }
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  verifyConnection?(): Promise<{ ok: boolean; error?: string; latencyMs?: number }>;
}

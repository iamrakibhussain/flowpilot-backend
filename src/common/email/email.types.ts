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

/**
 * Redacts sensitive tokens, verification OTPs, and secrets from email subjects before logging.
 * Prevents credential or token leakage into server stdout or log aggregation systems.
 */
export function sanitizeSubjectForLog(subject?: string): string {
  if (!subject || typeof subject !== 'string') return '';
  let sanitized = subject;
  // Redact 6-digit numeric OTPs (standard FlowPilot email verification codes)
  sanitized = sanitized.replace(/\b\d{6}\b/g, '[REDACTED_CODE]');
  // If the subject contains verification, OTP, or PIN keywords, redact any numeric sequence of 4-8 digits
  if (/verification|verify|code|otp|pin|token/i.test(sanitized)) {
    sanitized = sanitized.replace(/\b\d{4,8}\b/g, '[REDACTED_CODE]');
  }
  // Redact key-value secrets in URL query-like patterns (e.g. token=xyz, code=123)
  sanitized = sanitized.replace(/(token|code|key|secret|auth)=([^\s&]+)/gi, '$1=[REDACTED]');
  // Redact hex or high-entropy tokens of 24+ characters
  sanitized = sanitized.replace(/\b[0-9a-fA-F]{24,}\b/g, '[REDACTED_TOKEN]');
  return sanitized;
}

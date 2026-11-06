import { EmailProvider, EmailMessage, EmailSendResult } from '../email.types.js';
import { logger } from '../../logging/logger.js';

export class ConsoleSimulationProvider implements EmailProvider {
  public readonly name = 'console';

  public async send(message: EmailMessage): Promise<EmailSendResult> {
    const startTime = Date.now();
    const simulatedId = `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    logger.info(
      {
        event: 'email.simulated',
        provider: this.name,
        messageId: simulatedId,
        to: message.to,
        subject: message.subject,
        hasAttachments: Boolean(message.attachments && message.attachments.length > 0),
        correlationId: message.correlationId,
      },
      'Email dispatch simulated in console (no live email provider credentials active)',
    );

    return {
      success: true,
      messageId: simulatedId,
      provider: this.name,
      status: 'simulated',
      latencyMs: Date.now() - startTime,
      attempts: 1,
    };
  }

  public async verifyConnection(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

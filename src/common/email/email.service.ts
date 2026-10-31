import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../logging/logger.js';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

/**
 * Escapes special HTML characters to prevent HTML/XSS injection in rendered email clients.
 */
export function escapeHtml(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class EmailService {
  private static transporter: Transporter | null = null;

  private static getTransporter(): Transporter | null {
    if (this.transporter) {
      return this.transporter;
    }

    if (!env.SMTP_USER || !env.SMTP_PASS) {
      return null;
    }

    const cleanPass = env.SMTP_PASS.replace(/\s+/g, '');
    const isGmail = env.SMTP_HOST.toLowerCase().includes('gmail.com');

    if (isGmail) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: env.SMTP_USER,
          pass: cleanPass,
        },
      });
    } else {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: cleanPass,
        },
        tls: {
          rejectUnauthorized: env.NODE_ENV === 'production',
        },
      });
    }

    return this.transporter;
  }

  public static async sendMail(
    options: SendMailOptions,
  ): Promise<{ success: boolean; messageId?: string }> {
    // Defense-in-depth: Prevent CRLF header injection in recipient, subject, or attachment filenames
    if (
      /[\r\n]/.test(options.to) ||
      /[\r\n]/.test(options.subject) ||
      Boolean(options.attachments?.some((a) => /[\r\n]/.test(a.filename)))
    ) {
      logger.error(
        { event: 'email.crlf_detected', to: options.to },
        'Potential CRLF header injection detected in email dispatch. Aborting.',
      );
      return { success: false };
    }

    const transporter = this.getTransporter();

    // In local dev/test or when Gmail App Password is not yet set, simulate delivery safely
    if (!transporter) {
      logger.info(
        {
          event: 'email.simulated',
          to: options.to,
          subject: options.subject,
        },
        'SMTP credentials not set in .env. Email simulated in console.',
      );
      return { success: true, messageId: 'simulated-dev-id' };
    }

    try {
      const fromHeader = env.EMAIL_FROM.includes('<')
        ? env.EMAIL_FROM
        : `"FlowPilot Security" <${env.SMTP_USER || env.EMAIL_FROM}>`;

      const info = await transporter.sendMail({
        from: fromHeader,
        replyTo: env.SMTP_USER || fromHeader,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          Importance: 'high',
        },
      });

      logger.info(
        {
          event: 'email.sent',
          to: options.to,
          subject: options.subject,
          messageId: info.messageId,
        },
        'Transactional email delivered successfully',
      );

      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error(
        {
          event: 'email.error',
          to: options.to,
          subject: options.subject,
          err: error instanceof Error ? error.message : 'Unknown SMTP error',
        },
        'Failed to deliver transactional email',
      );
      return { success: false };
    }
  }

  /**
   * Dispatches an enterprise password reset instructions email with a 15-minute expiration link.
   * Built with 100% inline styling to ensure direct Primary Inbox placement.
   */
  public static async sendPasswordResetEmail(
    to: string,
    name: string,
    rawToken: string,
  ): Promise<boolean> {
    const safeName = escapeHtml(name);
    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const subject = 'Reset your FlowPilot account password';

    const text = `Hello ${name},\n\nWe received a request to reset the password for your FlowPilot workspace account.\n\nClick the link below or copy it into your browser to choose a new password:\n${resetUrl}\n\nThis link will expire in 15 minutes for your security.\n\nIf you did not request a password reset, you can safely ignore this email.\n\nâ€” The FlowPilot Security Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">FlowPilot</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 600; color: #2563eb; background-color: #eff6ff; padding: 4px 10px; border-radius: 9999px;">Security Notice</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Password Reset Request</h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">Hello ${safeName},</p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                We received a request to reset the password for your FlowPilot workspace account. Click the button below to choose a new password:
              </p>
              
              <div style="text-align: center; margin: 28px 0;">
                <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 13px 30px; border-radius: 8px; display: inline-block;">Reset My Password</a>
              </div>
              
              <p style="margin: 0 0 12px 0; font-size: 12px; line-height: 1.5; color: #64748b; word-break: break-all;">
                Or copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #2563eb; text-decoration: underline;">${resetUrl}</a>
              </p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                This link will expire in <strong>15 minutes</strong>. If you did not request this change, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 FlowPilot, Inc. All rights reserved.</p>
              <p style="margin: 0;">Automated security notification for your FlowPilot account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result.success;
  }

  /**
   * Dispatches a 6-digit numeric verification code for email verification.
   * Designed with high-deliverability inline styling that avoids spam filters.
   */
  public static async sendEmailVerificationCode(
    to: string,
    name: string,
    code: string,
  ): Promise<boolean> {
    const safeName = escapeHtml(name);
    const subject = `${code} is your FlowPilot verification code`;
    const text = `FlowPilot Verification Code: ${code}\n\nHello ${name},\n\nYour FlowPilot email verification code is: ${code}\n\nThis code will expire in 15 minutes. Enter this code on the verification screen to activate your workspace access.\n\nIf you did not sign up for a FlowPilot account, please disregard this email.\n\nâ€” The FlowPilot Security Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">FlowPilot</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 600; color: #059669; background-color: #ecfdf5; padding: 4px 10px; border-radius: 9999px;">Verification</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Verify your email address</h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">Hello ${safeName},</p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Thank you for registering with FlowPilot. To complete your account verification, enter the following 6-digit confirmation code:
              </p>
              
              <!-- OTP Box -->
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #166534; display: inline-block;">${code}</span>
              </div>
              
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                This verification code will expire in <strong>15 minutes</strong>. If you did not create a FlowPilot account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 FlowPilot, Inc. All rights reserved.</p>
              <p style="margin: 0;">Automated security notification sent to verify your email address.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result.success;
  }

  /**
   * Dispatches a security alert email when the user's password has been updated.
   */
  public static async sendPasswordChangedNotification(to: string, name: string): Promise<boolean> {
    const safeName = escapeHtml(name);
    const subject = 'Security Alert: Your FlowPilot password was changed';
    const text = `Hello ${name},\n\nYour FlowPilot account password was recently updated. All other active sessions have been invalidated.\n\nIf you made this change, no further action is needed.\n\nIf you did NOT make this change, please contact FlowPilot security immediately.\n\nâ€” The FlowPilot Security Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">FlowPilot</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 600; color: #d97706; background-color: #fef3c7; padding: 4px 10px; border-radius: 9999px;">Security Alert</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Password Updated</h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">Hello ${safeName},</p>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                The password for your FlowPilot workspace account was successfully changed. All other active sessions across your devices have been invalidated.
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                If you authorized this change, no further action is required.
              </p>
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin: 20px 0;">
                <p style="margin: 0; font-size: 13px; color: #b91c1c; font-weight: 500;">
                  If you did not authorize this change, please contact FlowPilot security immediately.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 FlowPilot, Inc. All rights reserved.</p>
              <p style="margin: 0;">Automated security notification for your FlowPilot account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result.success;
  }

  /**
   * Dispatches an account deletion confirmation email.
   */
  public static async sendAccountDeletedNotification(to: string, name: string): Promise<boolean> {
    const safeName = escapeHtml(name);
    const subject = 'Your FlowPilot account has been deleted';
    const text = `Hello ${name},\n\nYour FlowPilot account and associated workspace data have been permanently deleted in accordance with your request.\n\nAll personal credentials, sessions, and records have been purged.\n\nIf you ever wish to use FlowPilot again, you are always welcome to create a new account.\n\nâ€” The FlowPilot Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">FlowPilot</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 600; color: #dc2626; background-color: #fef2f2; padding: 4px 10px; border-radius: 9999px;">Account Deleted</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0f172a;">Account Deleted</h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">Hello ${safeName},</p>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Your FlowPilot account and personal data have been permanently removed as requested. Your active sessions and workspace memberships have been purged.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">
                We are sorry to see you go. If you ever wish to use FlowPilot again in the future, you are always welcome to register a new workspace.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 FlowPilot, Inc. All rights reserved.</p>
              <p style="margin: 0;">Automated confirmation notification.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result.success;
  }
  /**
   * Dispatches a workspace invitation email with secure token accept URL.
   */
  public static async sendWorkspaceInvitation(
    to: string,
    inviterName: string,
    organizationName: string,
    role: string,
    acceptUrl: string,
  ): Promise<boolean> {
    const safeInviter = escapeHtml(inviterName);
    const safeOrg = escapeHtml(organizationName);
    const safeRole = escapeHtml(role);
    const subject = `${inviterName} invited you to join ${organizationName} on FlowPilot`;
    const text = `Hello,\n\n${inviterName} has invited you to join ${organizationName} on FlowPilot as a ${role}.\n\nTo accept your invitation and access the workspace, click the link below:\n${acceptUrl}\n\nThis invitation link will expire in 7 days.\n\nâ€” The FlowPilot Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px;">FlowPilot</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 700; color: #4338ca; background-color: #e0e7ff; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase;">Team Invitation</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #0f172a; letter-spacing: -0.5px;">Join ${safeOrg}</h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                <strong>${safeInviter}</strong> has invited you to collaborate on the <strong>${safeOrg}</strong> workspace as an assigned <strong>${safeRole}</strong>.
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                With your FlowPilot workspace access, you can manage client schedules, view appointments, and update live operational deliverables.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: #2563eb;">
                    <a href="${acceptUrl}" target="_blank" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 28px; display: inline-block; border-radius: 10px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
                      Accept Invitation &amp; Join Workspace &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                This invitation link will expire in <strong>7 days</strong>.
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4; word-break: break-all;">
                Or copy and paste this link into your browser: <br/>${acceptUrl}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 FlowPilot, Inc. All rights reserved.</p>
              <p style="margin: 0;">Automated invitation dispatched on behalf of ${safeOrg}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result.success;
  }

  /**
   * Dispatches a branded passwordless magic link & 6-digit verification code
   * for customer self-service portal access. Expires in 15 minutes.
   */
  public static async sendCustomerPortalMagicLinkEmail(options: {
    to: string;
    customerName: string;
    organizationName: string;
    organizationSlug: string;
    brandColor?: string | null;
    rawToken: string;
    code: string;
  }): Promise<boolean> {
    const safeName = escapeHtml(options.customerName);
    const safeOrg = escapeHtml(options.organizationName);
    const brandColor = options.brandColor || '#2563eb';
    const loginUrl = `${env.FRONTEND_URL}/portal/${encodeURIComponent(options.organizationSlug)}/verify?token=${encodeURIComponent(options.rawToken)}`;
    const subject = `Your sign-in link for ${safeOrg} Client Portal`;

    const text = `Hello ${options.customerName},\n\nHere is your secure access link and 6-digit code to sign in to your ${options.organizationName} Client Portal.\n\nYour 6-Digit Code: ${options.code}\n\nOr click this direct sign-in link:\n${loginUrl}\n\nThis code and link expire in 15 minutes.\n\nIf you did not request this, you can safely ignore this email.\n\nâ€” ${options.organizationName}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 700; color: ${brandColor}; letter-spacing: -0.5px;">${safeOrg}</span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; font-weight: 600; color: #0284c7; background-color: #e0f2fe; padding: 4px 10px; border-radius: 9999px;">Client Portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px 32px 28px 32px;">
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                Sign in to your client account
              </h1>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Hello <strong>${safeName}</strong>,<br/>
                Use the 6-digit verification code below, or click the direct button to access your appointments, invoices, and service history.
              </p>

              <!-- 6-digit Code Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0 28px 0;">
                <tr>
                  <td align="center" style="background-color: #f1f5f9; border-radius: 12px; padding: 18px 24px; border: 1px dashed #cbd5e1;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; color: #64748b; margin-bottom: 6px;">Your 6-Digit Passcode</div>
                    <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${options.code}</div>
                  </td>
                </tr>
              </table>

              <!-- Direct CTA Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: ${brandColor};">
                    <a href="${loginUrl}" target="_blank" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 28px; display: inline-block; border-radius: 10px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
                      Sign In to Client Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                This link and passcode will expire in <strong>15 minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4; word-break: break-all;">
                Or copy and paste this link into your browser: <br/>${loginUrl}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 4px 0;">&copy; 2026 ${safeOrg}. Powered by FlowPilot.</p>
              <p style="margin: 0;">If you did not request this login code, you can safely disregard this message.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to: options.to, subject, text, html });
    return result.success;
  }

  /**
   * Diagnostic test email for verifying SMTP and mail provider connectivity.
   */
  public static async sendTestDiagnosticEmail(
    to: string,
    userName: string,
    orgName: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const safeUser = escapeHtml(userName);
    const safeOrg = escapeHtml(orgName);
    const timestamp = new Date().toUTCString();
    const subject = `[Test] FlowPilot Email Service Connected - ${safeOrg}`;

    const text = `Hello ${userName},\n\nThis is a test email dispatched from your FlowPilot workspace "${orgName}" to verify SMTP connectivity.\n\nTimestamp: ${timestamp}\nStatus: Active and operational.\n\n— The FlowPilot Automated System`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 24px 32px; background-color: #10b981; color: #ffffff;">
              <h2 style="margin: 0; font-size: 18px; font-weight: 700;">Diagnostic Test Email Passed ✅</h2>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">Hello ${safeUser},</p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #334155;">
                Congratulations! Your mail transport connection for <strong>${safeOrg}</strong> is configured properly and able to deliver live transactional messages.
              </p>
              <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin: 0 0 24px 0; font-size: 13px; color: #475569; font-family: monospace;">
                <strong>Timestamp:</strong> ${timestamp}<br>
                <strong>Provider:</strong> ${env.SMTP_HOST} (Port ${env.SMTP_PORT})<br>
                <strong>Status:</strong> Active &amp; Ready
              </div>
              <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                You can now safely send client portal links, booking confirmations, 24-hour reminders, and invoice statements.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
              &copy; 2026 ${safeOrg}. Powered by FlowPilot.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to, subject, text, html });
    return result;
  }

  /**
   * Dispatches a booking confirmation email to clients with appointment details and calendar attachment.
   */
  public static async sendBookingConfirmationEmail(options: {
    to: string;
    customerName: string;
    serviceTitle: string;
    scheduledAt: Date;
    durationMinutes: number;
    specialistName?: string | null;
    type?: string;
    location?: string | null;
    organizationName: string;
    brandColor?: string | null;
    calendarIcsString?: string;
  }): Promise<boolean> {
    const safeCustomer = escapeHtml(options.customerName);
    const safeService = escapeHtml(options.serviceTitle);
    const safeOrg = escapeHtml(options.organizationName);
    const safeSpecialist = escapeHtml(options.specialistName || 'Assigned Specialist');
    const brandColor = options.brandColor || '#2563eb';
    const formattedDate = options.scheduledAt.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `Confirmed: ${safeService} with ${safeOrg} on ${formattedDate}`;

    const text = `Hello ${options.customerName},\n\nYour appointment for ${options.serviceTitle} with ${options.organizationName} has been confirmed.\n\nDate & Time: ${formattedDate}\nDuration: ${options.durationMinutes} minutes\nSpecialist: ${options.specialistName || 'Assigned Specialist'}\nLocation / Meeting: ${options.location || options.type || 'Confirmed upon arrival'}\n\nThank you for choosing ${options.organizationName}!\n\n— The ${options.organizationName} Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 28px 32px; background: ${brandColor}; color: #ffffff;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">Booking Confirmed</span>
                    <h1 style="margin: 6px 0 0 0; font-size: 22px; font-weight: 700; color: #ffffff;">${safeService}</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">Hello ${safeCustomer},</p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Your appointment with <strong>${safeOrg}</strong> has been successfully booked and added to our schedule.
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b;">Date &amp; Time</div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 4px;">${formattedDate}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b;">Specialist</div>
                    <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 4px;">${safeSpecialist}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b;">Duration &amp; Format</div>
                    <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-top: 4px;">${options.durationMinutes} minutes &bull; ${escapeHtml(options.type || 'Appointment')}</div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; line-height: 1.6;">
                Need to make changes? You can view, reschedule, or cancel this session anytime via our client portal.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; line-height: 1.5;">
              &copy; 2026 ${safeOrg}. Powered by FlowPilot.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const attachments = options.calendarIcsString
      ? [
          {
            filename: 'invite.ics',
            content: options.calendarIcsString,
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          },
        ]
      : undefined;

    const result = await this.sendMail({ to: options.to, subject, text, html, attachments });
    return result.success;
  }

  /**
   * Dispatches a 24-hour advance appointment reminder email.
   */
  public static async sendAppointmentReminderEmail(options: {
    to: string;
    customerName: string;
    serviceTitle: string;
    scheduledAt: Date;
    specialistName?: string | null;
    type?: string;
    location?: string | null;
    portalUrl: string;
    organizationName: string;
    brandColor?: string | null;
  }): Promise<boolean> {
    const safeCustomer = escapeHtml(options.customerName);
    const safeService = escapeHtml(options.serviceTitle);
    const safeOrg = escapeHtml(options.organizationName);
    const safeSpecialist = escapeHtml(options.specialistName || 'Specialist');
    const brandColor = options.brandColor || '#2563eb';
    const formattedDate = options.scheduledAt.toLocaleString('en-US', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `Reminder: ${safeService} tomorrow with ${safeOrg}`;

    const text = `Hello ${options.customerName},\n\nThis is a quick reminder that you have an upcoming appointment tomorrow:\n\nService: ${options.serviceTitle}\nTime: ${formattedDate}\nSpecialist: ${options.specialistName || 'Specialist'}\n\nTo view or manage your booking, access our client portal:\n${options.portalUrl}\n\n— The ${options.organizationName} Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 24px 32px; background: ${brandColor}; color: #ffffff;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; opacity: 0.9;">Upcoming Appointment</span>
              <h2 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 700;">Reminder: Tomorrow at ${formattedDate}</h2>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">Hello ${safeCustomer},</p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                We are looking forward to your upcoming session for <strong>${safeService}</strong> with <strong>${safeSpecialist}</strong>.
              </p>

              <div style="text-align: center; margin: 28px 0;">
                <a href="${options.portalUrl}" style="background-color: ${brandColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px; display: inline-block;">
                  Manage in Client Portal &rarr;
                </a>
              </div>

              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                If you need to reschedule or cancel, please do so via the portal before our notice policy deadline.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
              &copy; 2026 ${safeOrg}. Powered by FlowPilot.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to: options.to, subject, text, html });
    return result.success;
  }

  /**
   * Dispatches a branded invoice statement email with a 1-click online payment button.
   */
  public static async sendInvoiceStatementEmail(options: {
    to: string;
    customerName: string;
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    total: number | string;
    currency: string;
    payUrl?: string | null;
    organizationName: string;
    brandColor?: string | null;
    items?: Array<{ description: string; quantity: number; amount: number | string }>;
  }): Promise<boolean> {
    const safeCustomer = escapeHtml(options.customerName);
    const safeOrg = escapeHtml(options.organizationName);
    const safeInvoiceNum = escapeHtml(options.invoiceNumber);
    const brandColor = options.brandColor || '#2563eb';
    const formattedDue = options.dueDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const subject = `Invoice ${safeInvoiceNum} from ${safeOrg} (${options.currency} ${options.total})`;

    const text = `Hello ${options.customerName},\n\nHere is your invoice ${options.invoiceNumber} from ${options.organizationName}.\n\nTotal Due: ${options.currency} ${options.total}\nDue Date: ${formattedDue}\n\n${options.payUrl ? `You can pay online directly using this secure link:\n${options.payUrl}\n\n` : ''}Thank you for your business!\n\n— The ${options.organizationName} Team`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 28px 32px; background: ${brandColor}; color: #ffffff;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 1px; opacity: 0.9;">Invoice Statement</span>
              <h1 style="margin: 4px 0 0 0; font-size: 22px; font-weight: 700;">${safeInvoiceNum}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">Hello ${safeCustomer},</p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Here is your invoice from <strong>${safeOrg}</strong> for services rendered.
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <div style="font-size: 12px; text-transform: uppercase; font-weight: 600; color: #64748b;">Total Amount Due</div>
                <div style="font-size: 32px; font-weight: 800; color: #0f172a; margin: 4px 0;">${options.currency} ${options.total}</div>
                <div style="font-size: 13px; color: #dc2626; font-weight: 600;">Payment Due: ${formattedDue}</div>
              </div>

              ${
                options.payUrl
                  ? `
              <div style="text-align: center; margin: 28px 0;">
                <a href="${options.payUrl}" style="background-color: #16a34a; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 36px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  Pay Now Online &rarr;
                </a>
              </div>
              `
                  : ''
              }

              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                Thank you for your business. If you have any questions regarding this invoice, please reach out to ${safeOrg}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
              &copy; 2026 ${safeOrg}. Powered by FlowPilot.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const result = await this.sendMail({ to: options.to, subject, text, html });
    return result.success;
  }
}

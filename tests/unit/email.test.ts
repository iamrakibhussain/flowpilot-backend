import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmailService,
  escapeHtml,
  isValidEmail,
  hasCrlf,
} from '../../src/common/email/email.service.js';
import { sanitizeSubjectForLog } from '../../src/common/email/email.types.js';
import { logger } from '../../src/common/logging/logger.js';
import { EmailProviderFactory } from '../../src/common/email/email-provider.factory.js';
import { TestEmailProvider } from '../../src/common/email/providers/test.provider.js';
import { ConsoleSimulationProvider } from '../../src/common/email/providers/console.provider.js';
import { SmtpEmailProvider } from '../../src/common/email/providers/smtp.provider.js';
import { ResendEmailProvider } from '../../src/common/email/providers/resend.provider.js';
import { SendGridEmailProvider } from '../../src/common/email/providers/sendgrid.provider.js';
import { PostmarkEmailProvider } from '../../src/common/email/providers/postmark.provider.js';

describe('Email Infrastructure & Security Test Suite', () => {
  let testProvider: TestEmailProvider;

  beforeEach(() => {
    testProvider = new TestEmailProvider();
    EmailProviderFactory.setProvider(testProvider);
    EmailService.resetTelemetry();
  });

  afterEach(() => {
    EmailProviderFactory.resetProvider();
  });

  describe('1. Security Defenses: HTML Escaping & Injection Protection', () => {
    it('escapes standard HTML special characters (&, <, >, ", \')', () => {
      const raw = 'Tech & Media <script>alert("XSS")</script> \'quoted\'';
      const safe = escapeHtml(raw);
      expect(safe).toBe(
        'Tech &amp; Media &lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &#39;quoted&#39;',
      );
    });

    it('handles null, undefined, empty string, and non-string types safely', () => {
      // @ts-expect-error Testing runtime edge cases
      expect(escapeHtml(null)).toBe('');
      // @ts-expect-error Testing runtime edge cases
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
      // @ts-expect-error Testing runtime edge cases
      expect(escapeHtml(12345)).toBe('');
    });

    it('neutralizes malicious payload within user-supplied names or titles', () => {
      const maliciousName = 'John Doe <img src=x onerror=alert(1)>';
      const escaped = escapeHtml(maliciousName);
      expect(escaped).not.toContain('<img');
      expect(escaped).toBe('John Doe &lt;img src=x onerror=alert(1)&gt;');
    });
  });

  describe('2. Security Defenses: CRLF Header Injection Defense', () => {
    it('detects CR (\\r), LF (\\n), and CRLF (\\r\\n) characters', () => {
      expect(hasCrlf('clean@example.com')).toBe(false);
      expect(hasCrlf('attacker@example.com\r\nBcc: victim@example.com')).toBe(true);
      expect(hasCrlf('subject\nInjection')).toBe(true);
      expect(hasCrlf('subject\rInjection')).toBe(true);
    });

    it('rejects email dispatch if recipient contains CRLF', async () => {
      const result = await EmailService.sendMail({
        to: 'victim@example.com\r\nBcc: spammer@evil.com',
        subject: 'Normal Subject',
        text: 'Hello',
        html: '<p>Hello</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('CRLF injection detected');
      expect(testProvider.getSentEmails()).toHaveLength(0);
    });

    it('rejects email dispatch if subject contains CRLF', async () => {
      const result = await EmailService.sendMail({
        to: 'user@example.com',
        subject: 'Invoice #1001\r\nX-Injected-Header: evil',
        text: 'Hello',
        html: '<p>Hello</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('CRLF injection detected');
      expect(testProvider.getSentEmails()).toHaveLength(0);
    });

    it('rejects email dispatch if attachment filename contains CRLF', async () => {
      const result = await EmailService.sendMail({
        to: 'user@example.com',
        subject: 'Your Invoice',
        text: 'Hello',
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'invoice.pdf\r\nContent-Type: text/html',
            content: 'test-content',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('CRLF injection detected');
      expect(testProvider.getSentEmails()).toHaveLength(0);
    });
  });

  describe('3. Recipient Validation', () => {
    it('validates compliant email addresses', () => {
      expect(isValidEmail('user@domain.com')).toBe(true);
      expect(isValidEmail('first.last+tag@sub.domain.co.uk')).toBe(true);
      expect(isValidEmail('engineering-ops@flowpilot.io')).toBe(true);
    });

    it('rejects malformed email addresses', () => {
      expect(isValidEmail('plainaddress')).toBe(false);
      expect(isValidEmail('@missinguser.com')).toBe(false);
      expect(isValidEmail('user@missing-tld')).toBe(false);
      expect(isValidEmail('user@.com')).toBe(false);
      expect(isValidEmail('user@domain..com')).toBe(false);
      expect(isValidEmail('user name@domain.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('aborts sendMail with invalid recipient email format', async () => {
      const result = await EmailService.sendMail({
        to: 'invalid-email-format',
        subject: 'Test Subject',
        text: 'Hello',
        html: '<p>Hello</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(testProvider.getSentEmails()).toHaveLength(0);
    });
  });

  describe('4. Provider Abstraction & Factory Behavior', () => {
    it('allows registering and resetting custom providers via factory', () => {
      const customTest = new TestEmailProvider();
      EmailProviderFactory.setProvider(customTest);
      expect(EmailProviderFactory.getProvider()).toBe(customTest);

      EmailProviderFactory.resetProvider();
      const freshProvider = EmailProviderFactory.getProvider();
      expect(freshProvider).toBeDefined();
    });

    it('ConsoleSimulationProvider returns simulated status safely', async () => {
      const consoleProvider = new ConsoleSimulationProvider();
      const res = await consoleProvider.send({
        to: 'user@example.com',
        subject: 'Console Test',
        text: 'Body',
        html: '<p>Body</p>',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('simulated');
      expect(res.provider).toBe('console');
      expect(res.messageId).toContain('sim-');
    });

    it('redacts sensitive OTPs and tokens from console logs and never leaks email bodies', async () => {
      const consoleProvider = new ConsoleSimulationProvider();
      const logSpy = vi.spyOn(logger, 'info');

      await consoleProvider.send({
        to: 'user@example.com',
        subject: '648421 is your FlowPilot verification code',
        text: 'Secret body with password reset link: https://app.flowpilot.com/reset?token=secret_abc123',
        html: '<p>Secret body with password reset link</p>',
        attachments: [{ filename: 'contract.pdf', content: Buffer.from('data') }],
      });

      expect(logSpy).toHaveBeenCalled();
      const lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1];
      const logPayload = lastCall?.[0] as Record<string, any>;

      // Proves 6-digit OTP is redacted from logged subject
      expect(logPayload.subject).toBe('[REDACTED_CODE] is your FlowPilot verification code');
      expect(logPayload.subject).not.toContain('648421');

      // Proves email text, HTML body, and attachment payloads are strictly excluded from logs
      expect(logPayload.text).toBeUndefined();
      expect(logPayload.html).toBeUndefined();
      expect(logPayload.attachments).toBeUndefined();
      expect(logPayload.hasAttachments).toBe(true);

      logSpy.mockRestore();
    });

    it('sanitizeSubjectForLog redacts OTP codes, query secrets, and high-entropy tokens while preserving business identifiers', () => {
      // Redacts 6-digit verification codes
      expect(sanitizeSubjectForLog('648421 is your FlowPilot verification code')).toBe(
        '[REDACTED_CODE] is your FlowPilot verification code',
      );
      expect(sanitizeSubjectForLog('Your verification code is 123456')).toBe(
        'Your verification code is [REDACTED_CODE]',
      );

      // Redacts query token secrets
      expect(sanitizeSubjectForLog('Portal Access: token=a1b2c3d4e5f6g7h8i9j0')).toBe(
        'Portal Access: token=[REDACTED]',
      );

      // Redacts raw 24+ character hex tokens
      expect(sanitizeSubjectForLog('Session alert for 0123456789abcdef0123456789abcdef')).toBe(
        'Session alert for [REDACTED_TOKEN]',
      );

      // Preserves non-sensitive operational identifiers
      expect(
        sanitizeSubjectForLog('Invoice INV-2026-440 from Fintech Solutions (USD 2,400.00)'),
      ).toBe('Invoice INV-2026-440 from Fintech Solutions (USD 2,400.00)');
      expect(sanitizeSubjectForLog('Reset your FlowPilot account password')).toBe(
        'Reset your FlowPilot account password',
      );
    });

    it('supports instantiation of modern REST API providers', () => {
      const resend = new ResendEmailProvider({
        apiKey: 're_test_key_12345',
        from: 'test@flowpilot.io',
      });
      expect(resend.name).toBe('resend');

      const sendgrid = new SendGridEmailProvider({
        apiKey: 'SG.test_key_12345',
        from: 'test@flowpilot.io',
      });
      expect(sendgrid.name).toBe('sendgrid');

      const postmark = new PostmarkEmailProvider({
        serverToken: 'pm_token_12345',
        from: 'test@flowpilot.io',
      });
      expect(postmark.name).toBe('postmark');

      const smtp = new SmtpEmailProvider({
        host: 'smtp.mailgun.org',
        port: 587,
        secure: false,
        from: 'test@flowpilot.io',
      });
      expect(smtp.name).toBe('smtp');
    });

    it('TestEmailProvider captures messages accurately with metadata', async () => {
      await testProvider.send({
        to: 'recipient@example.com',
        subject: 'Test 1',
        text: 'Text 1',
        html: '<p>HTML 1</p>',
        correlationId: 'corr-101',
      });

      const emails = testProvider.getSentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0]?.to).toBe('recipient@example.com');
      expect(emails[0]?.subject).toBe('Test 1');
      expect(emails[0]?.correlationId).toBe('corr-101');
      expect(emails[0]?.timestamp).toBeInstanceOf(Date);

      const last = testProvider.getLastEmail();
      expect(last?.subject).toBe('Test 1');

      testProvider.clear();
      expect(testProvider.getSentEmails()).toHaveLength(0);
    });
  });

  describe('5. Resilience: Retry Policy & Error Classification', () => {
    it('successfully delivers on first attempt when provider is healthy', async () => {
      const result = await EmailService.sendMail({
        to: 'dev@flowpilot.io',
        subject: 'Healthy Send',
        text: 'Content',
        html: '<p>Content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.provider).toBe('test');
      expect(testProvider.getSentEmails()).toHaveLength(1);

      const telemetry = EmailService.getTelemetry();
      expect(telemetry.totalAttempted).toBe(1);
      expect(telemetry.totalDelivered).toBe(1);
      expect(telemetry.totalFailed).toBe(0);
      expect(telemetry.transientRetries).toBe(0);
      expect(telemetry.byProvider.test?.delivered).toBe(1);
    });

    it('retries on transient failure with backoff and succeeds on subsequent attempt', async () => {
      // Simulate 2 transient failures (e.g. rate limit, socket timeout) before succeeding
      testProvider.simulateFailure('Connection reset by peer', 'TRANSIENT', 2);

      const result = await EmailService.sendMail({
        to: 'dev@flowpilot.io',
        subject: 'Retry Test',
        text: 'Content',
        html: '<p>Content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(testProvider.getSentEmails()).toHaveLength(1);

      const telemetry = EmailService.getTelemetry();
      expect(telemetry.totalAttempted).toBe(1);
      expect(telemetry.totalDelivered).toBe(1);
      expect(telemetry.transientRetries).toBe(2);
      expect(telemetry.totalFailed).toBe(0);
    });

    it('immediately aborts on permanent error without retrying', async () => {
      // Simulate permanent error (e.g. 550 Mailbox does not exist, Auth failed)
      testProvider.simulateFailure('550 5.1.1 User unknown', 'PERMANENT', 1);

      const result = await EmailService.sendMail({
        to: 'unknown@flowpilot.io',
        subject: 'Permanent Error Test',
        text: 'Content',
        html: '<p>Content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.error).toContain('550 5.1.1 User unknown');
      expect(testProvider.getSentEmails()).toHaveLength(0);

      const telemetry = EmailService.getTelemetry();
      expect(telemetry.totalAttempted).toBe(1);
      expect(telemetry.totalDelivered).toBe(0);
      expect(telemetry.totalFailed).toBe(1);
      expect(telemetry.transientRetries).toBe(0);
    });

    it('stops retrying when maximum retry attempts are exhausted', async () => {
      // Simulate 5 transient failures (exceeds default maxAttempts of 3)
      testProvider.simulateFailure('Network timeout', 'TRANSIENT', 5);

      const result = await EmailService.sendMail({
        to: 'dev@flowpilot.io',
        subject: 'Exhausted Retry Test',
        text: 'Content',
        html: '<p>Content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('Network timeout');
      expect(testProvider.getSentEmails()).toHaveLength(0);

      const telemetry = EmailService.getTelemetry();
      expect(telemetry.totalAttempted).toBe(1);
      expect(telemetry.totalDelivered).toBe(0);
      expect(telemetry.totalFailed).toBe(1);
      expect(telemetry.transientRetries).toBe(2);
    });
  });

  describe('6. Connection Verification & Telemetry', () => {
    it('verifies transport connection with active provider', async () => {
      const status = await EmailService.verifyTransport();
      expect(status.success).toBe(true);
      expect(status.provider).toBe('test');
    });

    it('correctly increments and isolates telemetry per provider', async () => {
      await EmailService.sendMail({
        to: 'user1@flowpilot.io',
        subject: 'Sub 1',
        text: 'Text',
        html: '<p>Text</p>',
      });

      await EmailService.sendMail({
        to: 'user2@flowpilot.io',
        subject: 'Sub 2',
        text: 'Text',
        html: '<p>Text</p>',
      });

      const tel = EmailService.getTelemetry();
      expect(tel.totalAttempted).toBe(2);
      expect(tel.totalDelivered).toBe(2);
      expect(tel.byProvider.test?.delivered).toBe(2);
      expect(tel.byProvider.test?.failed).toBe(0);
    });
  });

  describe('7. Standardized Notification Templates Verification', () => {
    it('renders and dispatches Contract Signing email with HTML escaping', async () => {
      const success = await EmailService.sendContractSigningEmail({
        to: 'customer@client.com',
        customerName: 'Alice & Bob <script>',
        contractTitle: 'Enterprise SLA & Support',
        contractNumber: 'CNT-2026-001',
        signingUrl: 'https://app.flowpilot.io/sign/token-abc-123',
        organizationName: 'Acme Corp <VIP>',
        brandColor: '#4f46e5',
      });

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email).toBeDefined();
      expect(email?.to).toBe('customer@client.com');
      expect(email?.subject).toContain('Enterprise SLA & Support');
      expect(email?.html).toContain('Alice &amp; Bob &lt;script&gt;');
      expect(email?.html).toContain('Acme Corp &lt;VIP&gt;');
      expect(email?.html).toContain('CNT-2026-001');
      expect(email?.html).toContain('https://app.flowpilot.io/sign/token-abc-123');
      expect(email?.html).toContain('#4f46e5');
      expect(email?.text).toContain('Review & Sign Document:');
    });

    it('renders and dispatches Quote Proposal email with formatted amounts', async () => {
      const success = await EmailService.sendQuoteProposalEmail({
        to: 'prospect@business.com',
        customerName: 'Sarah Connor',
        quoteTitle: 'Cloud Migration & Ops',
        quoteNumber: 'QTE-8899',
        totalAmount: 12500,
        currency: 'USD',
        validUntil: new Date('2026-12-31T00:00:00Z'),
        reviewUrl: 'https://app.flowpilot.io/quote/raw-token-xyz',
        organizationName: 'Global Cloud Systems',
      });

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('prospect@business.com');
      expect(email?.subject).toContain('QTE-8899');
      expect(email?.html).toContain('USD 12500.00');
      expect(email?.html).toContain('Sarah Connor');
      expect(email?.html).toContain('https://app.flowpilot.io/quote/raw-token-xyz');
      expect(email?.text).toContain('Cloud Migration & Ops');
    });

    it('renders and dispatches FlowRule custom automated email safely', async () => {
      const success = await EmailService.sendFlowRuleCustomEmail({
        to: 'client@partner.com',
        subject: 'Project Milestone Achieved',
        body: 'Phase 1 completed!\nNext step: review deliverables at your earliest convenience.',
        organizationName: 'Apex Innovations',
      });

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('client@partner.com');
      expect(email?.subject).toBe('Project Milestone Achieved');
      expect(email?.html).toContain('Phase 1 completed!<br/>Next step: review deliverables');
      expect(email?.html).toContain('Apex Innovations');
      expect(email?.text).toContain('Phase 1 completed!');
    });

    it('renders Password Reset email correctly', async () => {
      const success = await EmailService.sendPasswordResetEmail(
        'alice@example.com',
        'Alice Smith',
        'reset-token-999',
      );

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('alice@example.com');
      expect(email?.html).toContain('Alice Smith');
      expect(email?.html).toContain('reset-password?token=reset-token-999');
      expect(email?.text).toContain('reset-password?token=reset-token-999');
    });

    it('renders Email Verification Code email correctly', async () => {
      const success = await EmailService.sendEmailVerificationCode(
        'bob@example.com',
        'Bob Jones',
        '458921',
      );

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('bob@example.com');
      expect(email?.html).toContain('458921');
      expect(email?.text).toContain('458921');
    });

    it('renders Workspace Invitation email correctly', async () => {
      const success = await EmailService.sendWorkspaceInvitation(
        'colleague@example.com',
        'Carol TeamLead',
        'Acme Workspace',
        'MEMBER',
        'https://app.flowpilot.io/accept-invitation?token=invite-tok-777',
      );

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('colleague@example.com');
      expect(email?.html).toContain('Acme Workspace');
      expect(email?.html).toContain('Carol TeamLead');
      expect(email?.html).toContain('accept-invitation?token=invite-tok-777');
    });

    it('renders Invoice Statement email with attachment and payment link', async () => {
      const success = await EmailService.sendInvoiceStatementEmail({
        to: 'finance@client.com',
        customerName: 'Daniel Craig',
        invoiceNumber: 'INV-2026-440',
        issueDate: new Date('2026-11-01T00:00:00Z'),
        dueDate: new Date('2026-11-30T00:00:00Z'),
        total: '2,400.00',
        currency: 'USD',
        payUrl: 'https://app.flowpilot.io/portal/pay/inv-440',
        organizationName: 'Fintech Solutions',
      });

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('finance@client.com');
      expect(email?.subject).toContain('INV-2026-440');
      expect(email?.html).toContain('USD 2,400.00');
      expect(email?.html).toContain('https://app.flowpilot.io/portal/pay/inv-440');
    });

    it('renders Payment Receipt email correctly', async () => {
      const success = await EmailService.sendPaymentReceiptEmail({
        to: 'customer@client.com',
        customerName: 'Eve Online',
        invoiceNumber: 'INV-2026-001',
        amount: 1500,
        currency: 'EUR',
        paymentMethod: 'STRIPE',
        transactionReference: 'pi_3MtwBwLkdIwHu7ix28a3tqPa',
        receiptUrl: 'https://app.flowpilot.io/receipt/rec-101',
        organizationName: 'Global SaaS Ltd',
      });

      expect(success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('customer@client.com');
      expect(email?.subject).toContain('INV-2026-001');
      expect(email?.html).toContain('EUR');
      expect(email?.html).toContain('STRIPE');
      expect(email?.html).toContain('pi_3MtwBwLkdIwHu7ix28a3tqPa');
    });

    it('renders Diagnostic Test email with active provider display', async () => {
      const res = await EmailService.sendTestDiagnosticEmail(
        'admin@flowpilot.io',
        'Super Admin',
        'FlowPilot HQ',
      );

      expect(res.success).toBe(true);
      const email = testProvider.getLastEmail();
      expect(email?.to).toBe('admin@flowpilot.io');
      expect(email?.subject).toContain('[Test] FlowPilot Email Service Connected');
      expect(email?.html).toContain('Super Admin');
      expect(email?.html).toContain('TEST');
    });
  });
});

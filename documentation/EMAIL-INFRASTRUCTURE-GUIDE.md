# FlowPilot — Enterprise Email Infrastructure Operations Guide

This operational manual documents the production-grade, multi-provider email infrastructure of FlowPilot, covering provider configuration, DNS authentication, security guarantees, resilience mechanics, and troubleshooting protocols.

---

## 1. Architectural Overview

FlowPilot implements a provider-agnostic, decoupled email subsystem designed for high deliverability, resilience, and multi-tenant security:

```
[ Application Modules ]
(Auth, Invoices, Contracts, Quotes, Portal, Booking, Cron Reminders, FlowRules)
                    │
                    ▼
     [ EmailService Facade ]
     ├── CRLF Header Injection Defense
     ├── Strict RFC Recipient Format Validation
     ├── XSS/HTML Injection Neutralization (escapeHtml)
     ├── Telemetry Tracking & Metrics Collection
     └── Exponential Backoff & Jitter Retry Engine
                    │
                    ▼
       [ EmailProviderFactory ]
                    │
    ┌───────────────┼───────────────┬───────────────┬───────────────┬───────────────┐
    ▼               ▼               ▼               ▼               ▼               ▼
[ Resend API ]  [ Postmark API ] [ SendGrid API ]  [ SMTP Pool ]   [ Console Sim ] [ Test Provider ]
(Direct REST)   (Direct REST)    (Direct REST)    (Nodemailer)    (Safe Local Dev)(In-Memory Unit)
```

### Supported Providers

| Provider     | Mode / Type                                        | Best For                                            | Authentication                              |
| :----------- | :------------------------------------------------- | :-------------------------------------------------- | :------------------------------------------ |
| **Resend**   | REST API (`https://api.resend.com/emails`)         | Modern SaaS transactional emails                    | `RESEND_API_KEY` (Bearer Token)             |
| **Postmark** | REST API (`https://api.postmarkapp.com/email`)     | Ultra-fast primary inbox placement                  | `POSTMARK_SERVER_TOKEN` (Header)            |
| **SendGrid** | REST API (`https://api.sendgrid.com/v3/mail/send`) | High-volume enterprise sending                      | `SENDGRID_API_KEY` (Bearer Token)           |
| **SMTP**     | Nodemailer Connection Pool                         | Self-hosted mailservers, Mailgun, Amazon SES        | Host, Port, TLS, User, Password             |
| **Console**  | Local Simulation                                   | Development environments without external keys      | Zero setup; logs metadata securely          |
| **Test**     | In-Memory Capture                                  | Deterministic Vitest unit & integration test suites | In-memory message store & failure simulator |

---

## 2. Environment Configuration (`.env`)

Configure the active email provider using the following environment variables:

```bash
# -----------------------------------------------------------------------------
# EMAIL INFRASTRUCTURE CONFIGURATION
# -----------------------------------------------------------------------------

# Provider selection: auto | resend | postmark | sendgrid | smtp | console | test
# 'auto' intelligently selects the best provider based on available credentials:
# Resend -> Postmark -> SendGrid -> SMTP -> Console fallback
EMAIL_PROVIDER="auto"

# Default sender identity
EMAIL_FROM="FlowPilot <notifications@flowpilot.io>"
EMAIL_REPLY_TO="support@flowpilot.io"

# 1. Resend Credentials
RESEND_API_KEY="re_live_..."

# 2. Postmark Credentials
POSTMARK_SERVER_TOKEN="pm_live_..."

# 3. SendGrid Credentials
SENDGRID_API_KEY="SG.live_..."

# 4. SMTP / Custom Gateway Settings
SMTP_HOST="smtp.mailgun.org"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="postmaster@mg.flowpilot.io"
SMTP_PASS="secret_smtp_password"
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=15000

# 5. Resilience & Retry Policy
EMAIL_RETRY_MAX_ATTEMPTS=3
EMAIL_RETRY_INITIAL_DELAY_MS=500
```

---

## 3. Production DNS Authentication (SPF, DKIM, DMARC)

To prevent transactional messages from being flagged as spam or rejected by Google Workspace and Microsoft 365, configure your sending domain DNS records:

### 3.1. SPF (Sender Policy Framework)

Add a `TXT` record at your root domain (`flowpilot.io`) authorizing your provider's relay servers:

```text
Host: @
Type: TXT
Value: v=spf1 include:resend.com include:sendgrid.net include:postmarkapp.com ~all
```

### 3.2. DKIM (DomainKeys Identified Mail)

Generate DKIM keys in your provider's dashboard (Resend, Postmark, or SendGrid) and add the provided `CNAME` or `TXT` records to your DNS:

```text
Host: resend._domainkey.flowpilot.io
Type: CNAME
Value: dkim.resend.com.
```

### 3.3. DMARC (Domain-based Message Authentication, Reporting, and Conformance)

Publish a DMARC policy record at `_dmarc.flowpilot.io`:

```text
Host: _dmarc.flowpilot.io
Type: TXT
Value: v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@flowpilot.io; aspf=r; adkim=r;
```

---

## 4. Security Guarantees & Defenses

1. **CRLF Header Injection Defense:**
   Every outgoing dispatch validates `to`, `subject`, `from`, `replyTo`, and attachment filenames using regex `[\r\n]`. If carriage return or newline characters are detected, the dispatch is instantly aborted and an alert is recorded in structured logs (`email.crlf_detected`).
2. **Strict RFC Recipient Format Validation:**
   Dispatches are filtered through `isValidEmail()`. Malformed addresses, empty domains, or injection attempts are intercepted before contacting any remote API or SMTP socket.
3. **Strict HTML Escaping (`escapeHtml`):**
   All dynamic parameters (user names, organization titles, document labels, contract numbers) are sanitized via `escapeHtml()`, converting `&`, `<`, `>`, `"`, and `'` to safe HTML entities. This neutralizes cross-site scripting (XSS) in desktop and web-based email clients.
4. **Zero Dummy Data in Production:**
   Every email template requires real workspace entities from PostgreSQL; empty or missing fields render clean semantic fallbacks.
5. **Correlation Tracking & PII Redaction:**
   Emails can carry an optional `correlationId` or `tags` for end-to-end auditability. Sensitive credentials or passwords are never logged to console or remote monitoring services.

---

## 5. Resilience, Error Classification & Retry Policy

The dispatch pipeline distinguishes between **Transient** and **Permanent** failures:

### Transient Failures (Automatically Retried with Exponential Backoff + Jitter)

- Sockets resets (`ECONNRESET`, `ECONNREFUSED`, `ESOCKETTIMEDOUT`, `ETIMEDOUT`)
- DNS resolution timeouts (`EAI_AGAIN`)
- HTTP 429 (Rate Limit Exceeded)
- HTTP 500, 502, 503, 504 (Provider Server / Gateway Errors)
- SMTP 421, 450, 451, 452 (Service Unavailable / Mailbox Busy)

**Retry Strategy:**
$$\text{Delay} = \text{initialDelayMs} \times 2^{\text{attempt} - 1} + \text{jitter} \quad (\text{up to } 3 \text{ attempts})$$

### Permanent Failures (Aborted Immediately to Avoid Wasting Provider Quota)

- HTTP 400, 401, 403 (Invalid API Key, Unauthorized, Forbidden)
- HTTP 404 (Resource Not Found)
- HTTP 422 (Unprocessable Entity, Invalid Sender Signature)
- SMTP 550, 551, 553 (User Unknown, Mailbox Does Not Exist)
- CRLF or Invalid Email format validation failures

---

## 6. Programmatic Inspection & Telemetry

Inspect transport connectivity and live telemetry in runtime controllers or health checks:

```typescript
import { EmailService } from '../common/email/email.service.js';

// 1. Verify provider connection & credentials
const health = await EmailService.verifyTransport();
console.log(health); // { success: true, provider: 'resend', latencyMs: 142 }

// 2. Read runtime delivery counters
const metrics = EmailService.getTelemetry();
console.log(metrics);
// {
//   totalAttempted: 1540,
//   totalDelivered: 1538,
//   totalFailed: 2,
//   transientRetries: 4,
//   byProvider: { resend: { delivered: 1538, failed: 2 } }
// }
```

---

## 7. Standardized Email Templates Directory

All 18 transactional email notification types across FlowPilot are standardized into type-safe, escaped methods in `EmailService`:

1. `sendPasswordResetEmail(to, name, rawToken)`
2. `sendEmailVerificationCode(to, name, rawCode)`
3. `sendPasswordChangedNotification(to, name)`
4. `sendAccountDeletedNotification(to, name)`
5. `sendWorkspaceInvitation(to, inviterName, organizationName, role, acceptUrl)`
6. `sendCustomerPortalMagicLinkEmail(options)`
7. `sendBookingConfirmationEmail(options)`
8. `sendAppointmentReminderEmail(options)`
9. `sendInvoiceStatementEmail(options)`
10. `sendPaymentReceiptEmail(options)`
11. `sendInvoiceDunningEmail(options)`
12. `sendQuoteExpiryWarningEmail(options)`
13. `sendContractSigningEmail(options)` _(Newly standardized)_
14. `sendQuoteProposalEmail(options)` _(Newly standardized)_
15. `sendFlowRuleCustomEmail(options)` _(Newly standardized)_
16. `sendTestDiagnosticEmail(to, userName, orgName)`

# FlowPilot Backend — Security Architecture & Threat Model

## 1. Security Architecture Summary

Security is implemented using a defense-in-depth model across transport, application, data, and operational layers.

---

## 2. Implemented Controls

| Control Area          | Implementation                          | Protection                                                         |
| :-------------------- | :-------------------------------------- | :----------------------------------------------------------------- |
| **HTTP Headers**      | Helmet                                  | Prevents MIME-sniffing, clickjacking, and enforces secure defaults |
| **CORS**              | Strict allowlist with credentials       | Blocks unauthorized cross-origin requests from foreign domains     |
| **Request ID**        | `X-Request-Id` propagation & UUID       | Enables end-to-end distributed tracing and audit logging           |
| **Input Validation**  | Zod schemas on params, query, body      | Blocks mass assignment, SQL injection, and invalid payloads        |
| **Password Hashing**  | Argon2id via `@node-rs/argon2`          | OWASP recommended password hashing with salt and work factor       |
| **Rate Limiting**     | `express-rate-limit` (100 req / 15 min) | Mitigates brute-force attacks and denial-of-service attempts       |
| **Payload Limits**    | `100kb` body parser limit               | Prevents memory exhaustion attacks via massive request bodies      |
| **Logging Redaction** | Pino sensitive field masking            | Strips tokens, passwords, authorization headers, and cookies       |
| **Tenant Isolation**  | `tenantContextMiddleware`               | Rejects missing/malformed tenant headers and prevents IDOR         |

---

## 3. Authentication & Session Strategy

- **Session Transport**: FlowPilot utilizes secure, HTTP-only, SameSite cookies (`flowpilot_session`) to prevent client-side JavaScript access (XSS mitigation).
- **Session Revocation**: Storing session metadata in the `Session` table allows immediate revocation upon password change, account suspension, or user logout.

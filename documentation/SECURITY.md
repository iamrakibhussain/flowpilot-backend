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
- **Token Hashing**: Raw session tokens are never stored in plaintext in the database. Tokens are hashed with SHA-256 before storage to protect active sessions against database exfiltration attacks.

---

## 4. Cross-Site Request Forgery (CSRF) Defense Strategy

Because FlowPilot utilizes browser-managed session cookies (`flowpilot_session`), CSRF defense is implemented through four complementary layers:

1. **SameSite Cookie Attribute**:
   - In production, session cookies are issued with `SameSite=Strict` (and `SameSite=Lax` in local development). Browsers refuse to send `Strict` cookies on cross-origin requests, blocking drive-by cross-site request execution.
2. **Strict Credentialed CORS Allowlist**:
   - The Express CORS middleware strictly checks incoming `Origin` headers against the configured `CORS_ORIGIN` allowlist (`src/config/security.ts`). Wildcard `*` is explicitly disallowed with credentials. Requests from unauthorized origins are rejected with `403 Forbidden`.
3. **Mandatory JSON Content-Type & Preflight Defense**:
   - All state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) require `Content-Type: application/json`. Standard browser HTML `<form action="...">` submissions cannot send `application/json` payloads without triggering a CORS preflight (`OPTIONS`) request, which unauthorized cross-origin sites cannot pass.
4. **Mandatory Custom Header Verification**:
   - Tenant-scoped operations enforce the `X-Organization-Id` header via `tenantContextMiddleware`. Custom headers cannot be attached by standard cross-site links or forms without triggering a CORS preflight check.
5. **Session Invalidation on Logout**:
   - Calling `/api/v1/auth/logout` invalidates the server-side session in the database and explicitly clears the client cookie, mitigating post-session replay risks.

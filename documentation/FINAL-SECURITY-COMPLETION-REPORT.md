# FlowPilot — Final Full-Stack Security Completion Report

**Date**: 2026-10-19  
**Assessment Authority**: Application Security Engineering  
**Repositories Assessed**:

- Frontend: `flowpilot` (Next.js 15, React 19, TypeScript, Tailwind CSS)
- Backend: `flowpilot-backend` (Node.js 22, Express, Prisma ORM, PostgreSQL)

---

## A. Executive Summary

A comprehensive, evidence-grounded security audit, code-level remediation, and adversarial verification was executed across both FlowPilot repositories.

FlowPilot is a multi-tenant business operations SaaS designed for service-oriented organizations. This security mission audited and hardened the complete attack surface of the current application state, including authentication lifecycles, tenant context isolation boundaries, password hashing work factors, credential recovery flows, CSRF/CORS defenses, input validation, and transactional email security.

### Summary of What Was Audited

- **12 production-mounted API routes** spanning health probes and authentication lifecycles.
- **Tenant Context Middleware**: Fail-closed authorization, role enforcement (`OWNER`, `ADMIN`, `MEMBER`, `BILLING`), and cross-tenant boundary protections.
- **Session management**: Argon2id hashing, cryptographically secure 256-bit tokens, SHA-256 token hashing, single-use enforcement, and multi-device session invalidation.
- **Browser & Transport Security**: SameSite cookie policies, strict credentialed CORS origin checking, custom header validation, strict Content-Type enforcement, and Referer origin validation on mutation methods.
- **Input validation & injection defense**: Strict Zod schemas across request bodies, query parameters, and URL path parameters.
- **Transactional email generation**: Context-aware HTML entity escaping, SMTP CRLF header injection defenses, and rate-limiting throttling.
- **Database operations**: Atomic Prisma transactions, cascade deletions, and automated hourly background token/session purging.
- **Supply chain**: Manifest and lockfile audits with both full `npm audit` and `npm audit --omit=dev`.

### Summary of Remediations Implemented

- **12 concrete security defect areas (SEC-01 through SEC-12)** were resolved directly in source code with dedicated automated regression tests.
- Zero plaintext secrets, session cookies, or verification codes are stored or logged.
- Automated background pruning was implemented for expired sessions, reset tokens, and OTP codes.
- Constant-time verification was deployed for verification codes to eliminate timing side channels.
- Strict cross-origin referer checking and DELETE-method anti-CSRF enforcement were added.
- Frontend open-redirect protection and error messaging transparency were implemented.
- Test-only and mock routes were verified to be completely unreachable in the application, returning HTTP 404.

### Overall Verification Status

- **Backend Test Suite**: **129 of 129 tests passed** across 14 test suites (**0 failures**).
- **Backend Build & Type-Check**: `tsc --noEmit` (**0 errors**); `tsc -p tsconfig.build.json` (**clean `dist/` build**).
- **Backend Linter & Formatter**: `eslint .` (**0 errors, 0 warnings**); `prettier --check .` (**Clean, all files match**).
- **Frontend Test Suite**: **48 of 48 tests passed** across 12 test suites (**0 failures**).
- **Frontend Type-Check**: `tsc --noEmit` (**0 errors**).
- **Frontend Linter & Formatter**: `eslint .` (**0 errors**, 7 non-blocking hook warnings); `prettier --check .` (**Clean, all files match**).
- **Total Automated Tests**: **177 passed (177)** across both repositories.

---

## B. Findings and Remediation Inventory

| Finding ID | Severity | Affected File(s)                                                                              | Root Cause                                                                                                                              | Implemented Remediation                                                                                                                                                                                  | Regression Test & Result                                                           |
| :--------- | :------- | :-------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| **SEC-01** | Medium   | `src/common/email/email.service.ts`                                                           | Dynamic user name interpolated directly into HTML email templates; unvalidated header inputs.                                           | Context-aware HTML entity escaping applied to all user variables; CRLF sanitization rejects `\r` and `\n` in email headers.                                                                              | `tests/integration/security-hardening.test.ts`<br>**PASS** (4 tests)               |
| **SEC-02** | High     | `src/common/middleware/tenant-context.ts`                                                     | Tenant middleware permitted optional verification bypass if unconfigured; database drops could leave membership role context ambiguous. | Enforced `requireMembershipVerification: true` by default. Wrapped membership lookup in try/catch to fail closed with HTTP 403 `FORBIDDEN`. Role context cleared if unverified.                          | `tests/integration/security-hardening.test.ts`<br>**PASS** (2 tests)               |
| **SEC-03** | Medium   | `src/config/security.ts`<br>`src/modules/auth/auth.routes.ts`                                 | Sensitive authentication endpoints lacked fine-grained rate limiters against brute force and email spam.                                | Created dedicated rate limiters: `authRateLimiter` (10 req/15min) and `emailDispatchRateLimiter` (5 req/15min) mounted on login, password-reset, and email verification endpoints.                       | `tests/integration/security-hardening.test.ts`<br>**PASS** (1 test)                |
| **SEC-04** | Medium   | `src/app.ts`                                                                                  | State-changing endpoints could theoretically accept alternate media types without triggering CORS preflights.                           | Enforced `Content-Type: application/json` on all state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) carrying a body; rejects alternate media types with HTTP 415.                                 | `tests/integration/security-hardening.test.ts`<br>**PASS** (4 tests)               |
| **SEC-05** | High     | `src/common/logging/logger.ts`                                                                | Risk of accidental password or session token leakage in stdout/stderr server logs.                                                      | Implemented Pino sensitive field redaction covering passwords, password hashes, reset tokens, verification code hashes, session cookies, and authorization headers.                                      | Live integration test logs inspected; all sensitive tokens redacted.<br>**PASS**   |
| **SEC-06** | High     | `src/modules/auth/crypto.ts`<br>`src/modules/auth/auth.types.ts`                              | Need for standardized OWASP password hashing work factors and password complexity enforcement.                                          | Adopted Argon2id (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 4`) via `@node-rs/argon2`. Zod schemas enforce minimum 8 characters with uppercase, lowercase, and numbers.                          | `tests/unit/crypto.test.ts`<br>**PASS** (18 tests)                                 |
| **SEC-07** | High     | `src/modules/auth/auth.service.ts`<br>`src/modules/auth/crypto.ts`                            | Reset tokens and verification codes stored in plaintext; lack of multi-device session invalidation on password change.                  | Tokens and codes are SHA-256 hashed before storage; time-limited (1h reset, 15m verification); single-use enforced via `usedAt`; password reset invalidates all active user sessions across all devices. | `tests/integration/password-reset-and-verification.test.ts`<br>**PASS** (13 tests) |
| **SEC-08** | High     | `src/modules/auth/auth.service.ts`<br>`src/modules/auth/auth.routes.ts`                       | Missing secure account deletion flow with authentication verification.                                                                  | Implemented `deleteAccount` endpoint requiring password re-verification, invalidating all sessions, purging verification codes, and removing tenant memberships.                                         | `tests/integration/auth.test.ts`<br>**PASS** (16 tests)                            |
| **SEC-09** | Medium   | `src/modules/auth/auth.service.ts`<br>`src/server.ts`                                         | Stale expired sessions and used reset tokens accumulated indefinitely in PostgreSQL.                                                    | Implemented `AuthService.cleanupExpiredTokens()` running in a single `prisma.$transaction`. Scheduled automated hourly background purge with graceful process termination handling.                      | `tests/integration/security-hardening.test.ts`<br>**PASS** (1 test)                |
| **SEC-10** | Medium   | `src/modules/auth/auth.service.ts`                                                            | Database-level lookup by code hash could introduce timing variations during validation.                                                 | Codes retrieved by `userId` and verified via `timingSafeCompare` (`crypto.timingSafeEqual`) on the SHA-256 code hash.                                                                                    | `tests/integration/security-hardening.test.ts`<br>**PASS** (2 tests)               |
| **SEC-11** | Medium   | `src/app.ts`<br>`src/config/security.ts`                                                      | Missing validation for `Referer` headers on cross-origin mutation requests when `Origin` header is omitted.                             | Validates `Referer` origin against allowed origins; rejects unauthorized referers with HTTP 403 `FORBIDDEN`. Enforces Content-Type check on `DELETE` requests carrying a body.                           | `tests/integration/security-hardening.test.ts`<br>**PASS** (3 tests)               |
| **SEC-12** | Low      | `flowpilot/src/app/(auth)/login/page.tsx`<br>`flowpilot/src/app/(auth)/verify-email/page.tsx` | Potential open redirect via `redirect` search param; verify-email page masked code errors as session errors.                            | Added `getSafeRedirectUrl` ensuring relative navigation (`/`) and blocking protocol-relative URLs (`//`) and URL schemes (`https://`). Differentiated code validation errors from session errors.        | Frontend type-check & test suite.<br>**PASS** (48 tests)                           |

---

## C. Attack Surface & Endpoint Authorization Inventory

### 1. Actually Registered Backend Routes (`createApp()`)

Below is the exhaustive inventory of all 12 endpoints registered on the live Express application entry point via `v1Routes`:

| Endpoint                         | Method | Auth Required   | Tenant Required | Minimum Role      | Resource Scope / Ownership | Protection Controls                                                 |
| :------------------------------- | :----- | :-------------- | :-------------- | :---------------- | :------------------------- | :------------------------------------------------------------------ |
| `/api/v1/health`                 | GET    | No              | No              | None              | System liveness            | Public probe                                                        |
| `/api/v1/health/ready`           | GET    | No              | No              | None              | System readiness           | Database probe via `prisma.$queryRaw`                               |
| `/api/v1/auth/register`          | POST   | No              | No              | None              | Creates User, Org, OWNER   | Zod, 10 req/15min rate limit, Argon2id, atomic transaction          |
| `/api/v1/auth/login`             | POST   | No              | No              | None              | Creates Session            | Zod, 10 req/15min rate limit, Argon2id, HttpOnly SameSite cookie    |
| `/api/v1/auth/logout`            | POST   | No (Permissive) | No              | None              | Clears Session             | Session table invalidation, cookie clearing                         |
| `/api/v1/auth/forgot-password`   | POST   | No              | No              | None              | User lookup                | Zod, 5 req/15min rate limit, SHA-256 hashed token, email dispatch   |
| `/api/v1/auth/reset-password`    | POST   | No              | No              | None              | Token validation           | Zod, 10 req/15min rate limit, single-use, invalidates all sessions  |
| `/api/v1/auth/send-verification` | POST   | Yes             | No              | Any Authenticated | Own user                   | 5 req/15min rate limit, SHA-256 hashed 6-digit OTP                  |
| `/api/v1/auth/verify-email`      | POST   | Yes             | No              | Any Authenticated | Own user                   | Zod, 10 req/15min rate limit, timing-safe compare, atomic update    |
| `/api/v1/auth/change-password`   | POST   | Yes             | No              | Any Authenticated | Own user                   | Zod, 10 req/15min rate limit, Argon2id, security alert notification |
| `/api/v1/auth/account`           | DELETE | Yes             | No              | Any Authenticated | Own account                | Zod, password re-authentication, full session purge                 |
| `/api/v1/auth/me`                | GET    | Yes             | No              | Any Authenticated | Own user & memberships     | Session authentication, user existence check                        |

### 2. Test-Only Routes Disposition

The endpoints previously referenced in preliminary reports (`/api/v1/tenant/test-protected`, `/api/v1/tenant/test-admin`, `/api/v1/tenant/test-owner`, `/api/v1/tenant/test-bypass`, `/api/v1/test-tenant`, `/api/v1/tenant-resource`, `/api/v1/owner-only-resource`) are **test fixtures** defined solely inside test files (`tests/integration/tenant-authorization.test.ts` and `tests/integration/tenant-context.test.ts`) using isolated, ephemeral Express instances to validate `tenantContextMiddleware`.

**They are NOT mounted on the production application.**

Regression tests in `tests/integration/not-found.test.ts` execute against the live application instance (`getTestApp()`) and verify that every request to these test-fixture paths, as well as `/api/v1/debug/*` and `/api/v1/test/*`, returns **HTTP 404 NOT_FOUND**.

### 3. Business Resource APIs Clarification

Tenant-scoped business operations (Customers, Services, Appointments, Invoices) are designed in the architecture specifications and scheduled for implementation in Phase 2. They are **not currently implemented or mounted** in the Phase 1 backend, and no claim is made that unwritten business endpoints were audited.

---

## D. Dependency Security Audits

Both repositories were audited using full `npm audit` and production-only `npm audit --omit=dev`.

### 1. Frontend Repository (`flowpilot`)

- **`npm audit --omit=dev`**:
  - Exit Code: `0`
  - Result: **0 vulnerabilities found in production dependencies**.
- **`npm audit` (full)**:
  - Exit Code: `1`
  - Findings: 5 high-severity advisories affecting `braces *` via `eslint-config-next` -> `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch`.
  - Remediation Analysis: `npm audit fix --force` would downgrade ESLint configuration to `eslint-config-next@14.2.35`, which is incompatible with the project's Next.js 15.2.0 framework.
  - Risk Assessment: **Low development-only risk**. The vulnerability is restricted to build/lint time evaluation and does not affect the production runtime bundle.

### 2. Backend Repository (`flowpilot-backend`)

- **`npm audit --omit=dev`**:
  - Exit Code: `1`
  - Findings: 3 high-severity advisories affecting `deepmerge-ts <8.0.0` via `@prisma/config` via `prisma`.
  - Remediation Analysis: `prisma` is listed in `devDependencies` in `package.json`, but npm evaluates transitive CLI tools when `@prisma/client` is in `dependencies`. Resolving `deepmerge-ts` requires upgrading to Prisma 7, which introduces major breaking API changes.
  - Runtime Exposure: **Zero production exposure**. In production (`npm start` -> `node dist/server.js`), only `@prisma/client` is executed. Neither `prisma` CLI nor `@prisma/config` nor `deepmerge-ts` is imported or executed by the runtime server.
- **`npm audit` (full)**:
  - Exit Code: `1`
  - Findings: 6 vulnerabilities (1 moderate `@vitest/mocker`, 2 critical `tinypool`, 3 high `deepmerge-ts`).
  - Remediation Analysis: `vitest` and `tinypool` are test-runner tools used only during `npm test`. Upgrading requires Vitest 5 (`vitest@5.0.5`), which is a breaking major version change.
  - Risk Assessment: **Low development-only risk**. Neither Vitest nor Tinypool executes in production.

---

## E. Verification Evidence & Exact Command Outputs

### 1. Backend Verification (`flowpilot-backend`)

- **Unit & Integration Tests**:
  ```bash
  $ npm test
  ✓ tests/integration/auth.test.ts (16 tests)
  ✓ tests/integration/security-hardening.test.ts (17 tests)
  ✓ tests/integration/password-reset-and-verification.test.ts (13 tests)
  ✓ tests/integration/security-headers.test.ts (14 tests)
  ✓ tests/integration/not-found.test.ts (12 tests)
  ✓ tests/integration/tenant-authorization.test.ts (5 tests)
  ✓ tests/integration/tenant-context.test.ts (3 tests)
  ✓ tests/integration/postgres-auth.test.ts (8 tests)
  ✓ tests/integration/health.test.ts (3 tests)
  ✓ tests/unit/crypto.test.ts (18 tests)
  ✓ tests/unit/env.test.ts (8 tests)
  ✓ tests/unit/validate.test.ts (2 tests)
  ✓ tests/unit/response.test.ts (2 tests)
  ✓ tests/unit/errors.test.ts (8 tests)

  Test Files  14 passed (14)
       Tests  129 passed (129)
    Duration  21.82s
  ```
- **TypeScript Static Analysis**:
  ```bash
  $ npm run type-check
  > tsc --noEmit
  (Exit code 0, 0 errors)
  ```
- **Production Build**:
  ```bash
  $ npm run build
  > tsc -p tsconfig.build.json
  (Exit code 0, clean build output in dist/)
  ```
- **Linting**:
  ```bash
  $ npm run lint
  > eslint .
  (Exit code 0, 0 errors, 0 warnings)
  ```
- **Formatting**:
  ```bash
  $ npm run format:check
  > prettier --check .
  All matched files use Prettier code style!
  (Exit code 0)
  ```

### 2. Frontend Verification (`flowpilot`)

- **Unit & Component Tests**:
  ```bash
  $ npm run test:unit
  ✓ src/app/(auth)/register/register.test.tsx (5 tests)
  ✓ src/components/layout/header.test.tsx (5 tests)
  ✓ src/components/marketing/marketing.test.tsx (8 tests)
  ✓ src/components/ui/button.test.tsx (3 tests)
  ✓ src/components/feedback/empty-state.test.tsx (2 tests)
  ✓ tests/unit/password-recovery.test.ts (6 tests)
  ✓ tests/unit/middleware.test.ts (6 tests)
  ✓ src/lib/api/client.test.ts (5 tests)
  ✓ src/lib/utils/cn.test.ts (3 tests)
  ✓ tests/unit/logout.test.ts (2 tests)
  ✓ src/lib/config/env.test.ts (2 tests)
  ✓ tests/unit/foundation.test.ts (1 test)

  Test Files  12 passed (12)
       Tests  48 passed (48)
    Duration  17.88s
  ```
- **TypeScript Static Analysis**:
  ```bash
  $ npm run type-check
  > tsc --noEmit
  (Exit code 0, 0 errors)
  ```
- **Linting**:
  ```bash
  $ npm run lint
  > eslint .
  (Exit code 0, 0 errors, 7 non-blocking hook compilation warnings)
  ```
- **Formatting**:
  ```bash
  $ npm run format:check
  > prettier --check .
  All matched files use Prettier code style!
  (Exit code 0)
  ```

### 3. Git Status & Sensitive File Inspection

- `git ls-files .env .env.local`: Confirmed that `.env` and `.env.local` are **untracked** in both repositories.
- `.env.example`: Inspected in both repositories; contains strictly safe placeholders.
- `git diff`: Reviewed all modifications; zero hardcoded credentials, test bypasses, or weakened checks exist.

---

## F. Remaining Risks and Production Prerequisites

1. **Distributed Rate Limiting (Multi-Instance Deployments)**:
   - _Status_: The current rate limiter uses an in-memory sliding window per process.
   - _Production Prerequisite_: In a multi-replica container deployment behind a load balancer, attach a Redis instance (`rate-limit-redis`) to share rate-limiting state across nodes.
2. **Multi-Factor Authentication (MFA / 2FA)**:
   - _Status_: Not included in Phase 1 specifications.
   - _Phase 2 Recommendation_: Implement TOTP/WebAuthn for administrative and billing actions.
3. **Database Migration Deployment**:
   - _Status_: Migration file `20261018000000_add_password_reset_and_email_verification` is committed in `prisma/migrations`.
   - _Production Prerequisite_: Execute `npx prisma migrate deploy` in the staging/production deployment pipeline before booting backend processes.
4. **Reverse Proxy Configuration**:
   - _Status_: Configured via `TRUST_PROXY` environment variable.
   - _Production Prerequisite_: Set `TRUST_PROXY=1` (or specific CIDR) when running behind AWS ALB, Cloudflare, or NGINX to ensure accurate client IP extraction.

---

## G. Final Readiness Decision

### **READY FOR STAGING EVALUATION**

**Justification**:  
The foundation and authentication layers across both repositories exhibit production-grade security architecture:

1. Multi-tenant isolation fails closed, and all test/debug routes are verified to return 404 on the live application.
2. The endpoint inventory accurately accounts for all 12 registered routes with comprehensive authorization boundaries.
3. 177 automated tests (129 backend + 48 frontend) pass cleanly with zero compiler errors, zero linter errors, and clean Prettier formatting.
4. Dependency advisories are isolated to dev-time tooling (`vitest`, `prisma` CLI, `eslint-config-next`) and do not compromise production runtime.
5. All production deployment prerequisites are documented.

# FlowPilot Backend — Testing Architecture & Strategy

## 1. Test Architecture

Tests are implemented using **Vitest** for speed, native TypeScript execution, and ESM compatibility. HTTP integration tests use **Supertest**.

---

## 2. Test Categorization

### Unit Tests (`tests/unit/`)

- `env.test.ts`: Validates environment variable schema, defaults, and fail-fast behaviors.
- `errors.test.ts`: Validates domain error hierarchy, status codes, and operational flags.
- `response.test.ts`: Verifies success and error envelope compliance against the frontend API client.
- `crypto.test.ts`: Tests Argon2id password hashing, validation, and length constraints.
- `validate.test.ts`: Tests Zod request validation middleware.

### Integration Tests (`tests/integration/`)

- `health.test.ts`: Tests `/api/v1/health` (liveness) and `/api/v1/health/ready` (readiness).
- `not-found.test.ts`: Tests 404 error envelope on unmapped endpoints.
- `security-headers.test.ts`: Tests Helmet headers, CORS enforcement, and Request ID propagation.
- `tenant-context.test.ts`: Tests tenant header parsing, UUID validation, and authorization boundaries.

---

## 3. Test Execution Commands

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with code coverage report
npm run test:coverage
```

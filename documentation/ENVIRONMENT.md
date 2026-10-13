# FlowPilot Backend — Environment Configuration Matrix

All configuration variables are validated at startup via Zod in `src/config/env.ts`. If any required variable is missing or malformed, the application will terminate immediately with a descriptive error.

| Variable                  | Type            | Default                 | Secret? | Description                                                                                          |
| :------------------------ | :-------------- | :---------------------- | :------ | :--------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | enum            | `development`           | No      | Runtime environment (`development`, `test`, `production`)                                            |
| `PORT`                    | number          | `4000`                  | No      | HTTP listener port                                                                                   |
| `HOST`                    | string          | `0.0.0.0`               | No      | Network binding address                                                                              |
| `DATABASE_URL`            | URL             | (local dev url)         | **YES** | PostgreSQL connection string                                                                         |
| `CORS_ORIGIN`             | string          | `http://localhost:3000` | No      | Explicit comma-separated list of allowed frontend origins (wildcard `*` strictly forbidden)          |
| `TRUST_PROXY`             | string          | `false`                 | No      | Reverse proxy trust configuration (`false`, `true`, hop count integer like `1`, or CIDR/subnet list) |
| `COOKIE_SECRET`           | string (min 32) | (dev fallback)          | **YES** | Secret key used to sign session cookies. Rejects dev fallback in production.                         |
| `SESSION_EXPIRY_DAYS`     | number          | `7`                     | No      | Session duration in days                                                                             |
| `RATE_LIMIT_WINDOW_MS`    | number          | `900000`                | No      | Rate limit window in milliseconds (default: 15m)                                                     |
| `RATE_LIMIT_MAX_REQUESTS` | number          | `100`                   | No      | Maximum requests per IP per window                                                                   |
| `LOG_LEVEL`               | enum            | `info`                  | No      | Pino logging level (`info`, `warn`, `debug`, etc.)                                                   |

# FlowPilot Backend — Deployment & Operations Guide

## 1. Production Build Process

1. Install production dependencies:
   ```bash
   npm ci
   ```
2. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```
3. Compile TypeScript:
   ```bash
   npm run build
   ```
4. Run Database Migrations (in CI/CD deployment pipeline):
   ```bash
   npx prisma migrate deploy
   ```
5. Start Application:
   ```bash
   node dist/server.js
   ```

---

## 2. Reverse Proxy & Network Topology Configuration (TRUST_PROXY)

FlowPilot uses Express's `trust proxy` setting to resolve client IP addresses for rate limiting and audit logging.

- **Direct Deployment (No Proxy / Bare Metal)**: Leave `TRUST_PROXY=false` (default). Never trust forwarded headers from untrusted clients.
- **Single Reverse Proxy (AWS ALB, Nginx, Render, Railway)**: Set `TRUST_PROXY=1`. Express will trust the 1st hop upstream.
- **Multi-Hop / CDN Architecture (Cloudflare + AWS ALB)**: Set `TRUST_PROXY=2` or configure trusted IP ranges (e.g. `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12`).
- **Private VPC / Kubernetes Ingress**: Configure ingress CIDRs or named loopbacks (e.g. `TRUST_PROXY=loopback`).

---

## 3. Health Check Endpoints for Orchestrators

- **Liveness Probe**: `GET /api/v1/health` (checks if HTTP process is responsive, returns HTTP 200).
- **Readiness Probe**: `GET /api/v1/health/ready` (performs database ping via `SELECT 1`; returns HTTP 200 when connected, HTTP 503 when database is unavailable).

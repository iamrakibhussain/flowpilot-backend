# FlowPilot Backend — Architecture Decision Records (ADRs)

## ADR-001: Modular Monolith vs. Microservices

- **Status**: ACCEPTED
- **Context**: FlowPilot is an early-stage SaaS product. Microservices would introduce substantial operational complexity (distributed transactions, network latency, multiple pipelines, message brokers).
- **Decision**: Adopt a Modular Monolith with clear internal module boundaries and domain-driven design.
- **Consequences**: Fast development velocity, single deployment target, simplified transactional integrity via Prisma. Can be cleanly decoupled into microservices in the future if scale requires.

---

## ADR-002: Prisma ORM with Logical Multi-Tenant Partitioning

- **Status**: ACCEPTED
- **Context**: Multi-tenant isolation is critical. Options considered: separate databases per tenant, separate schemas per tenant, or shared database with tenant-scoped tables.
- **Decision**: Logical partitioning with tenant ID (`organizationId`) columns on all tenant-owned models, enforced at the application and query layer.
- **Consequences**: Simple database operations, low infrastructure overhead, straightforward migrations. Requires rigorous server-side tenant authorization middleware to prevent cross-tenant data leakage.

---

## ADR-003: Argon2id for Password Hashing

- **Status**: ACCEPTED
- **Context**: Passwords must be protected against brute-force and GPU/ASIC-accelerated cracking.
- **Decision**: Adopt `@node-rs/argon2` (Argon2id) with OWASP-recommended parameters (64MB memory, 3 iterations, 4 parallelism).
- **Consequences**: Superior resistance to side-channel attacks and GPU cracking compared to bcrypt.

---

## ADR-004: Express with Application Factory Pattern

- **Status**: ACCEPTED
- **Context**: Testing HTTP routes without port conflicts requires separating app creation from server startup.
- **Decision**: Separate `createApp()` in `src/app.ts` from the network listener in `src/server.ts`.
- **Consequences**: Enables fast, parallel integration tests via Supertest without binding network ports.

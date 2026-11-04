import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  contractRoutes,
  publicContractRoutes,
} from '../../src/modules/contracts/contract.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { prisma } from '../../src/database/prisma.js';
import { ContractStatus } from '@prisma/client';

describe('Contracts & E-Signatures Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const ownerUserId = 'usr-owner-1';
  const customerId = '123e4567-e89b-42d3-a456-426614174001';

  function mockSession(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING' = 'OWNER') {
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: userId,
        email: `${role.toLowerCase()}@flowpilot.internal`,
        name: `${role} User`,
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Acme Advisory Studio',
            role,
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession(ownerUserId, 'OWNER');
    vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);
    vi.spyOn(NotificationService, 'createNotification').mockResolvedValue({} as any);
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/contracts', contractRoutes);
    app.use('/api/v1/public/contracts', publicContractRoutes);
    app.use(errorHandler);
    return app;
  }

  const mockContractRecord = {
    id: 'contract-test-1',
    organizationId: targetOrgId,
    customerId,
    createdById: ownerUserId,
    quoteId: null,
    projectId: null,
    contractNumber: 'CNT-2026-001',
    title: 'Master Service Agreement',
    content: '## Master Service Agreement\nThis agreement outlines the operational terms...',
    status: ContractStatus.DRAFT,
    signToken: null,
    signTokenExpiry: null,
    signedAt: null,
    signerName: null,
    signerEmail: null,
    signerIp: null,
    signerUserAgent: null,
    signatureData: null,
    signatureType: null,
    contentChecksum: null,
    clientNotes: null,
    countersignedAt: null,
    countersignerId: null,
    countersignerName: null,
    countersignatureData: null,
    issuedAt: new Date(),
    expiresAt: null,
    viewedAt: null,
    declinedAt: null,
    declineReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: {
      id: customerId,
      name: 'Sarah Connor',
      email: 'sarah@cyberdyne.test',
      company: 'Cyberdyne Systems',
    },
    quote: null,
    project: null,
  };

  describe('POST /api/v1/contracts', () => {
    it('creates a draft contract for an existing customer in the organization', async () => {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
        id: customerId,
        organizationId: targetOrgId,
      } as any);
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: targetOrgId,
        name: 'Cyberdyne Operations',
      } as any);
      vi.spyOn(prisma.contract, 'count').mockResolvedValue(0);
      vi.spyOn(prisma.contract, 'create').mockResolvedValue(mockContractRecord as any);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          customerId,
          title: 'Master Service Agreement',
          content: '## Master Service Agreement\nThis agreement outlines the operational terms...',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contractNumber).toBe('CNT-2026-001');
      expect(res.body.data.status).toBe(ContractStatus.DRAFT);
    });

    it('rejects contract creation if customer does not belong to organization', async () => {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(null);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          customerId,
          title: 'Master Service Agreement',
          content: 'Agreement text...',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/contracts', () => {
    it('returns paginated list of contracts for authenticated organization', async () => {
      vi.spyOn(prisma.contract, 'findMany').mockResolvedValue([mockContractRecord as any]);
      vi.spyOn(prisma.contract, 'count').mockResolvedValue(1);

      const app = createTestApp();
      const res = await request(app)
        .get('/api/v1/contracts')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });
  });

  describe('POST /api/v1/contracts/:id/send', () => {
    it('dispatches contract, generates high-entropy signToken and updates status to PENDING_SIGNATURE', async () => {
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({
        ...mockContractRecord,
        customer: { email: 'sarah@test.com', name: 'Sarah' },
        organization: { name: 'Acme', brandColor: '#2563eb' },
      } as any);

      vi.spyOn(prisma.contract, 'update').mockResolvedValue({
        ...mockContractRecord,
        status: ContractStatus.PENDING_SIGNATURE,
        signToken: 'tok_sign_12345',
      } as any);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/contracts/contract-test-1/send')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.signingUrl).toContain('/sign/');
      expect(res.body.data.contract.status).toBe(ContractStatus.PENDING_SIGNATURE);
    });
  });

  describe('Public Contract Signing Lifecycle', () => {
    const validSignToken = 'tok_sign_valid_token_xyz';

    it('GET /api/v1/public/contracts/:token returns sanitized statement and marks viewed', async () => {
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({
        ...mockContractRecord,
        status: ContractStatus.PENDING_SIGNATURE,
        signToken: validSignToken,
        organization: {
          id: targetOrgId,
          name: 'Acme Corp',
          logoUrl: null,
          brandColor: '#2563eb',
        },
        customer: {
          id: customerId,
          name: 'Sarah Connor',
          email: 'sarah@test.com',
        },
      } as any);

      vi.spyOn(prisma.contract, 'update').mockResolvedValue({} as any);

      const app = createTestApp();
      const res = await request(app).get(`/api/v1/public/contracts/${validSignToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Master Service Agreement');
      expect(res.body.data.organization.name).toBe('Acme Corp');
    });

    it('POST /api/v1/public/contracts/:token/sign cryptographically signs contract with SHA-256 checksum', async () => {
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({
        ...mockContractRecord,
        status: ContractStatus.VIEWED,
        signToken: validSignToken,
        organization: { id: targetOrgId, name: 'Acme' },
        customer: { id: customerId, name: 'Sarah', email: 'sarah@test.com' },
      } as any);

      vi.spyOn(prisma.contract, 'update').mockImplementation(((args: any) => {
        return Promise.resolve({
          ...mockContractRecord,
          ...args.data,
          id: mockContractRecord.id,
        });
      }) as any);

      const app = createTestApp();
      const res = await request(app).post(`/api/v1/public/contracts/${validSignToken}/sign`).send({
        signerName: 'Sarah Connor',
        signerEmail: 'sarah@test.com',
        signatureData: 'data:image/svg+xml;base64,mock-signature-curve-data',
        signatureType: 'DRAWN',
        agreedToTerms: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ContractStatus.SIGNED);
      expect(res.body.data.contentChecksum).toBeDefined();
      expect(res.body.data.contentChecksum.length).toBe(64); // SHA-256 hex length
    });

    it('POST /api/v1/contracts/:id/countersign allows authenticated business staff to countersign', async () => {
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({
        ...mockContractRecord,
        status: ContractStatus.SIGNED,
      } as any);

      vi.spyOn(prisma.contract, 'update').mockResolvedValue({
        ...mockContractRecord,
        status: ContractStatus.COUNTERSIGNED,
        countersignedAt: new Date(),
        countersignerName: 'Owner User',
      } as any);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/contracts/contract-test-1/countersign')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          countersignerName: 'Owner User',
          countersignatureData: 'data:image/svg+xml;base64,mock-countersign',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ContractStatus.COUNTERSIGNED);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { quoteRoutes, publicQuoteRoutes } from '../../src/modules/quotes/quote.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { prisma } from '../../src/database/prisma.js';

describe('Quotes & Digital Proposals Module Integration Suite', () => {
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
    app.use('/api/v1/quotes', quoteRoutes);
    app.use('/api/v1/public/quotes', publicQuoteRoutes);
    app.use(errorHandler);
    return app;
  }

  const mockQuoteRecord = {
    id: 'quote-test-1',
    organizationId: targetOrgId,
    customerId,
    createdById: ownerUserId,
    quoteNumber: 'EST-2026-0001',
    title: 'Brand Identity & Web Transformation',
    status: 'DRAFT',
    subtotal: 3500.0,
    taxRate: 10.0,
    taxAmount: 350.0,
    discountType: 'FIXED',
    discountAmount: 0.0,
    totalAmount: 3850.0,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    viewedAt: null,
    acceptedAt: null,
    declinedAt: null,
    signerName: null,
    signerEmail: null,
    signerIp: null,
    signatureData: null,
    clientNotes: null,
    introduction: 'Complete executive identity proposal',
    terms: '50% upon signing, 50% upon delivery',
    notes: 'Internal VIP client lead',
    convertedInvoiceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: {
      id: customerId,
      name: 'Nexus Corp',
      email: 'contact@nexus.io',
      phone: '+1 555-0199',
      company: 'Nexus Technologies',
    },
    organization: {
      id: targetOrgId,
      name: 'Acme Advisory Studio',
      slug: 'acme-advisory',
      brandColor: '#2563eb',
      logoUrl: null,
      contactEmail: 'contact@acme.internal',
      contactPhone: '+1 800-ACME',
      address: '100 Market St, SF',
      currency: 'USD',
    },
    convertedInvoice: null,
    items: [
      {
        id: 'item-1',
        quoteId: 'quote-test-1',
        serviceId: null,
        description: 'Brand Discovery & Visual Language Guide',
        quantity: 1,
        unitPrice: 2000.0,
        amount: 2000.0,
        sortOrder: 0,
        service: null,
      },
      {
        id: 'item-2',
        quoteId: 'quote-test-1',
        serviceId: null,
        description: 'Interactive Web Prototype & Development',
        quantity: 1,
        unitPrice: 1500.0,
        amount: 1500.0,
        sortOrder: 1,
        service: null,
      },
    ],
  };

  it('GET /api/v1/quotes should list organization proposals', async () => {
    const app = createTestApp();
    (prisma as any).quote = {
      findMany: vi.fn().mockResolvedValue([mockQuoteRecord]),
      count: vi.fn().mockResolvedValue(1),
    };

    const res = await request(app)
      .get('/api/v1/quotes')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quotes).toHaveLength(1);
    expect(res.body.data.quotes[0].quoteNumber).toBe('EST-2026-0001');
    expect(res.body.data.quotes[0].totalAmount).toBe(3850);
  });

  it('GET /api/v1/quotes/stats should return aggregated estimate metrics', async () => {
    const app = createTestApp();
    (prisma as any).quote = {
      findMany: vi.fn().mockResolvedValue([mockQuoteRecord]),
    };

    const res = await request(app)
      .get('/api/v1/quotes/stats')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalEstimatedValue).toBe(3850);
    expect(res.body.data.counts.total).toBe(1);
    expect(res.body.data.counts.draft).toBe(1);
  });

  it('POST /api/v1/quotes should create a new estimate with calculated totals', async () => {
    const app = createTestApp();
    (prisma as any).customer = {
      findFirst: vi.fn().mockResolvedValue(mockQuoteRecord.customer),
    };
    (prisma as any).quote = {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(mockQuoteRecord),
    };

    const res = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId)
      .send({
        customerId,
        title: 'Brand Identity & Web Transformation',
        items: [
          { description: 'Brand Discovery', quantity: 1, unitPrice: 2000 },
          { description: 'Interactive Web Prototype', quantity: 1, unitPrice: 1500 },
        ],
        taxRate: 10,
        discountType: 'FIXED',
        discountAmount: 0,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quoteNumber).toBe('EST-2026-0001');
  });

  it('GET /api/v1/public/quotes/:token should retrieve public proposal', async () => {
    const app = createTestApp();
    (prisma as any).quoteToken = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'tok-1',
        tokenHash: 'dummyhash',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        quote: mockQuoteRecord,
      }),
    };

    const res = await request(app).get('/api/v1/public/quotes/test-raw-token-123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quoteNumber).toBe('EST-2026-0001');
    expect(res.body.data.organization.name).toBe('Acme Advisory Studio');
  });

  it('POST /api/v1/public/quotes/:token/accept should record digital signature and accept', async () => {
    const app = createTestApp();
    (prisma as any).quoteToken = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'tok-1',
        tokenHash: 'dummyhash',
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
        quote: mockQuoteRecord,
      }),
    };
    (prisma as any).quote = {
      findFirst: vi.fn().mockResolvedValue(mockQuoteRecord),
      update: vi.fn().mockResolvedValue({ ...mockQuoteRecord, status: 'ACCEPTED' }),
    };
    (prisma as any).invoice = {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'inv-created-1',
        invoiceNumber: 'INV-2026-0001',
        total: 3850,
      }),
    };

    const res = await request(app).post('/api/v1/public/quotes/test-raw-token-123/accept').send({
      signerName: 'Jane Doe',
      signerEmail: 'jane@nexus.io',
      signatureData: 'data:image/svg+xml;utf8,<svg>sig</svg>',
      clientNotes: 'Excited to kick off next Monday!',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quoteNumber).toBe('EST-2026-0001');
  });
});

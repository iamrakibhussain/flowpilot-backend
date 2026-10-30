import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { organizationRoutes } from '../../src/modules/organizations/organization.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';

describe('Organization Settings Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const otherOrgId = '987e6543-e21b-42d3-a456-426614174999';

  const mockOrgData = {
    id: targetOrgId,
    name: 'Apex Studio Design',
    slug: 'apex-studio',
    status: 'ACTIVE',
    logoUrl: 'https://example.com/logo.png',
    tagline: 'Crafting luxury visual solutions',
    contactEmail: 'hello@apexstudio.com',
    contactPhone: '+1 (555) 019-2834',
    address: '742 Evergreen Terrace, Suite 100',
    bookingEnabled: true,
    bookingTitle: 'Book an Appointment with Apex Studio',
    bookingNotice: 'Please arrive 10 minutes prior to your session.',
    currency: 'USD',
    timezone: 'America/New_York',
    taxId: 'US-EIN-987654321',
    defaultTaxRate: 8.5,
    defaultPaymentTerms: 'NET_15',
    invoiceFooter: 'Thank you for your partnership with Apex Studio.',
    bankName: 'Silicon Valley Chase',
    bankAccount: '1234567890',
    bankRouting: '021000021',
    bankSwift: 'CHASUS33',
    brandColor: '#2563eb',
    customDomain: null,
    minNoticeHours: 4,
    maxHorizonDays: 45,
    cancellationHours: 24,
    autoConfirmBookings: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-test-1',
        email: 'owner@apexstudio.com',
        name: 'Alex Rivera',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Apex Studio Design',
            role: 'OWNER',
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });

    vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);
    vi.spyOn(prisma.workspaceAuditLog, 'findMany').mockResolvedValue([
      {
        id: 'audit-1',
        organizationId: targetOrgId,
        userId: 'usr-test-1',
        userName: 'Alex Rivera',
        action: 'UPDATED_SETTINGS',
        category: 'SETTINGS',
        details: 'Updated workspace configuration: brandColor',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      } as any,
    ]);
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/organizations', organizationRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects settings requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/organizations/settings')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('successfully retrieves workspace settings with complete metadata', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue(mockOrgData as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/organizations/settings')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(targetOrgId);
    expect(res.body.data.name).toBe('Apex Studio Design');
    expect(res.body.data.currency).toBe('USD');
    expect(res.body.data.taxId).toBe('US-EIN-987654321');
    expect(res.body.data.minNoticeHours).toBe(4);
    expect(res.body.data.cancellationHours).toBe(24);
  });

  it('blocks non-admin members from updating organization settings with 403 Forbidden', async () => {
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-member-1',
        email: 'staff@apexstudio.com',
        name: 'Staff Member',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Apex Studio Design',
            role: 'MEMBER',
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });

    vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);
    vi.spyOn(prisma.workspaceAuditLog, 'findMany').mockResolvedValue([
      {
        id: 'audit-1',
        organizationId: targetOrgId,
        userId: 'usr-test-1',
        userName: 'Alex Rivera',
        action: 'UPDATED_SETTINGS',
        category: 'SETTINGS',
        details: 'Updated workspace configuration: brandColor',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      } as any,
    ]);

    const app = createTestApp();
    const res = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows OWNER to update branding, financial localization, and booking rules', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue(mockOrgData as any);
    vi.spyOn(prisma.organization, 'update').mockResolvedValue({
      ...mockOrgData,
      name: 'Apex Global Studio',
      currency: 'EUR',
      defaultTaxRate: 19.0,
      minNoticeHours: 6,
    } as any);

    const app = createTestApp();
    const res = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        name: 'Apex Global Studio',
        currency: 'EUR',
        defaultTaxRate: 19.0,
        minNoticeHours: 6,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Apex Global Studio');
    expect(res.body.data.currency).toBe('EUR');
    expect(res.body.data.defaultTaxRate).toBe(19.0);
    expect(res.body.data.minNoticeHours).toBe(6);
  });

  it('rejects slug modification with 409 Conflict if slug is already taken by another organization', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockImplementation(((args: any) => {
      if (args.where.id === targetOrgId) return Promise.resolve(mockOrgData as any);
      if (args.where.slug === 'taken-slug')
        return Promise.resolve({ id: otherOrgId, slug: 'taken-slug' } as any);
      return Promise.resolve(null);
    }) as any);

    const app = createTestApp();
    const res = await request(app)
      .patch('/api/v1/organizations/settings')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({ slug: 'taken-slug' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('correctly verifies slug availability', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockImplementation(((args: any) => {
      if (args.where.slug === 'taken-slug') return Promise.resolve({ id: otherOrgId } as any);
      if (args.where.slug === 'my-own-slug') return Promise.resolve({ id: targetOrgId } as any);
      return Promise.resolve(null);
    }) as any);

    const app = createTestApp();

    // Check taken slug
    const takenRes = await request(app)
      .post('/api/v1/organizations/settings/check-slug')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({ slug: 'taken-slug' });

    expect(takenRes.status).toBe(200);
    expect(takenRes.body.data.available).toBe(false);

    // Check free slug
    const freeRes = await request(app)
      .post('/api/v1/organizations/settings/check-slug')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({ slug: 'completely-free-slug' });

    expect(freeRes.status).toBe(200);
    expect(freeRes.body.data.available).toBe(true);

    // Check own slug (should be considered available for current org)
    const ownRes = await request(app)
      .post('/api/v1/organizations/settings/check-slug')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({ slug: 'my-own-slug' });

    expect(ownRes.status).toBe(200);
    expect(ownRes.body.data.available).toBe(true);
  });

  it('retrieves workspace audit logs with caller membership verification', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/organizations/audit-logs')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].action).toBe('UPDATED_SETTINGS');
    expect(res.body.data[0].userName).toBe('Alex Rivera');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { customerRoutes } from '../../src/modules/customers/customer.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { CustomerService } from '../../src/modules/customers/customer.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { CustomerStatus } from '@prisma/client';

describe('Customer CRM Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-test-1',
        email: 'test@flowpilot.internal',
        name: 'Test Operator',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Test Org',
            role: 'OWNER',
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.use('/api/v1/customers', customerRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects customer requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/customers')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Missing required X-Organization-Id');
  });

  it('returns 200 OK with paginated customers list', async () => {
    const app = createTestApp();
    vi.spyOn(CustomerService, 'listCustomers').mockResolvedValue({
      customers: [
        {
          id: 'cust-1',
          name: 'Acme Corp',
          email: 'contact@acme.com',
          phone: '+1 555-0199',
          company: 'Acme Industries',
          status: CustomerStatus.ACTIVE,
          notes: null,
          tags: ['VIP', 'Enterprise'],
          address: '742 Evergreen Terrace',
          totalInvoiced: '$1,200.00',
          totalPaid: '$1,200.00',
          appointmentsCount: 2,
          invoicesCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const res = await request(app)
      .get('/api/v1/customers?search=Acme&tag=VIP&sortBy=ltv')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.customers).toHaveLength(1);
    expect(res.body.data.customers[0].name).toBe('Acme Corp');
    expect(res.body.data.customers[0].tags).toContain('VIP');
  });

  it('creates a new customer and returns 201 Created', async () => {
    const app = createTestApp();
    vi.spyOn(CustomerService, 'createCustomer').mockResolvedValue({
      id: 'cust-new',
      name: 'Global Logistics',
      email: 'ops@globallogistics.com',
      phone: '+1 555-0144',
      company: 'Global Logistics Inc',
      status: CustomerStatus.ACTIVE,
      notes: null,
      tags: ['Commercial'],
      address: '100 Terminal Way',
      totalInvoiced: '$0.00',
      totalPaid: '$0.00',
      appointmentsCount: 0,
      invoicesCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/api/v1/customers')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        name: 'Global Logistics',
        email: 'ops@globallogistics.com',
        phone: '+1 555-0144',
        company: 'Global Logistics Inc',
        tags: ['Commercial'],
        address: '100 Terminal Way',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Global Logistics');
    expect(res.body.data.tags).toContain('Commercial');
  });

  it('returns 360-degree customer profile on GET /customers/:id', async () => {
    const app = createTestApp();
    vi.spyOn(CustomerService, 'getCustomerById').mockResolvedValue({
      id: 'cust-1',
      organizationId: targetOrgId,
      name: 'Acme Corp',
      email: 'contact@acme.com',
      phone: '+1 555-0199',
      company: 'Acme Industries',
      status: CustomerStatus.ACTIVE,
      notes: null,
      tags: ['Enterprise'],
      address: '99 Tech Blvd',
      parsedNotes: [],
      totalInvoiced: '$1,200.00',
      totalPaid: '$1,200.00',
      outstandingBalance: '$0.00',
      appointmentsCount: 1,
      invoicesCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appointments: [],
      invoices: [],
    });

    const res = await request(app)
      .get('/api/v1/customers/cust-1')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outstandingBalance).toBe('$0.00');
    expect(res.body.data.tags).toContain('Enterprise');
  });

  it('reactivates an archived customer and returns 200', async () => {
    const app = createTestApp();
    vi.spyOn(CustomerService, 'reactivateCustomer').mockResolvedValue({
      message: 'Customer reactivated successfully',
      customerId: 'cust-1',
    });

    const res = await request(app)
      .post('/api/v1/customers/cust-1/reactivate')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('reactivated');
  });

  it('adds an operational note to customer profile and returns 201', async () => {
    const app = createTestApp();
    vi.spyOn(CustomerService, 'addNote').mockResolvedValue([
      {
        id: 'note-1',
        authorName: 'Test Operator',
        content: 'Client requested review of contract.',
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await request(app)
      .post('/api/v1/customers/cust-1/notes')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        content: 'Client requested review of contract.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notes).toHaveLength(1);
    expect(res.body.data.notes[0].content).toContain('contract');
  });
});

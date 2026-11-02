import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { projectRoutes } from '../../src/modules/projects/project.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { prisma } from '../../src/database/prisma.js';

describe('EXP-02 Projects & Kanban Delivery Suite', () => {
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
    app.use('/api/v1/projects', projectRoutes);
    app.use(errorHandler);
    return app;
  }

  const mockProjectRecord = {
    id: 'proj-1',
    organizationId: targetOrgId,
    customerId,
    quoteId: null,
    createdById: ownerUserId,
    name: 'Brand Identity & Web Overhaul',
    description: 'Complete visual identity overhaul and responsive Next.js application.',
    status: 'ACTIVE',
    color: '#3b82f6',
    startDate: new Date('2026-11-01'),
    targetDate: new Date('2026-11-30'),
    completedAt: null,
    budget: 8500,
    currency: 'USD',
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: { id: customerId, name: 'Nexus Dynamics', company: 'Nexus Inc' },
    quote: null,
    tasks: [
      {
        id: 'task-1',
        organizationId: targetOrgId,
        projectId: 'proj-1',
        assigneeId: ownerUserId,
        title: 'Design System Tokens',
        description: 'Set up Tailwind CSS variables.',
        status: 'DONE',
        priority: 'HIGH',
        dueDate: new Date('2026-11-10'),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: { id: ownerUserId, name: 'Owner User', email: 'owner@flowpilot.internal' },
        checklists: [
          {
            id: 'chk-1',
            taskId: 'task-1',
            title: 'Audit color tokens',
            isCompleted: true,
            sortOrder: 0,
            createdAt: new Date(),
          },
        ],
      },
      {
        id: 'task-2',
        organizationId: targetOrgId,
        projectId: 'proj-1',
        assigneeId: null,
        title: 'Develop Landing Page',
        description: 'Build hero section with responsive CTA.',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        dueDate: new Date('2026-11-15'),
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        checklists: [],
      },
    ],
  };

  it('GET /api/v1/projects should list projects with calculated progress metrics', async () => {
    const app = createTestApp();
    (prisma as any).project = {
      findMany: vi.fn().mockResolvedValue([mockProjectRecord]),
      count: vi.fn().mockResolvedValue(1),
    };

    const res = await request(app)
      .get('/api/v1/projects')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.projects).toHaveLength(1);
    expect(res.body.data.projects[0].name).toBe('Brand Identity & Web Overhaul');
    expect(res.body.data.projects[0].totalTasks).toBe(2);
    expect(res.body.data.projects[0].completedTasks).toBe(1);
    expect(res.body.data.projects[0].progressPercentage).toBe(50);
  });

  it('GET /api/v1/projects/stats should compute overview metrics', async () => {
    const app = createTestApp();
    (prisma as any).project = {
      findMany: vi.fn().mockResolvedValue([{ id: 'proj-1', status: 'ACTIVE' }]),
    };
    (prisma as any).projectTask = {
      findMany: vi.fn().mockResolvedValue([
        { id: 'task-1', status: 'DONE', dueDate: null },
        { id: 'task-2', status: 'TODO', dueDate: new Date(Date.now() - 10000) },
      ]),
    };

    const res = await request(app)
      .get('/api/v1/projects/stats')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalProjects).toBe(1);
    expect(res.body.data.activeProjects).toBe(1);
    expect(res.body.data.overdueTasksCount).toBe(1);
    expect(res.body.data.completedTasksCount).toBe(1);
    expect(res.body.data.overallCompletionRate).toBe(50);
  });

  it('GET /api/v1/projects/:id should return project details grouped by Kanban column', async () => {
    const app = createTestApp();
    (prisma as any).project = {
      findFirst: vi.fn().mockResolvedValue(mockProjectRecord),
    };

    const res = await request(app)
      .get('/api/v1/projects/proj-1')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tasksByStatus.DONE).toHaveLength(1);
    expect(res.body.data.tasksByStatus.IN_PROGRESS).toHaveLength(1);
    expect(res.body.data.tasksByStatus.TODO).toHaveLength(0);
  });

  it('POST /api/v1/projects should create project and notify workspace', async () => {
    const app = createTestApp();
    (prisma as any).customer = {
      findFirst: vi.fn().mockResolvedValue({ id: customerId }),
    };
    (prisma as any).project = {
      create: vi.fn().mockResolvedValue(mockProjectRecord),
      findFirst: vi.fn().mockResolvedValue(mockProjectRecord),
    };

    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId)
      .send({
        name: 'Brand Identity & Web Overhaul',
        customerId,
        status: 'PLANNING',
        budget: 8500,
        currency: 'USD',
        initialTasks: [{ title: 'Kickoff meeting', status: 'TODO', priority: 'HIGH' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Brand Identity & Web Overhaul');
    expect(NotificationService.createNotification).toHaveBeenCalled();
  });

  it('POST /api/v1/projects/:id/tasks should create task in specified status', async () => {
    const app = createTestApp();
    (prisma as any).project = {
      findFirst: vi.fn().mockResolvedValue(mockProjectRecord),
    };
    (prisma as any).projectTask = {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: 'task-new',
        organizationId: targetOrgId,
        projectId: 'proj-1',
        title: 'Configure CI/CD Pipelines',
        status: 'TODO',
        priority: 'HIGH',
        dueDate: null,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        checklists: [],
      }),
    };

    const res = await request(app)
      .post('/api/v1/projects/proj-1/tasks')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId)
      .send({
        title: 'Configure CI/CD Pipelines',
        status: 'TODO',
        priority: 'HIGH',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Configure CI/CD Pipelines');
  });

  it('PATCH /api/v1/projects/:id/tasks/:taskId should update task status during drag & drop', async () => {
    const app = createTestApp();
    (prisma as any).projectTask = {
      findFirst: vi.fn().mockResolvedValue(mockProjectRecord.tasks[1]),
      update: vi.fn().mockResolvedValue({
        ...mockProjectRecord.tasks[1],
        status: 'DONE',
      }),
    };

    const res = await request(app)
      .patch('/api/v1/projects/proj-1/tasks/task-2')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('x-organization-id', targetOrgId)
      .send({
        status: 'DONE',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DONE');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import flowRulesRoutes from '../../src/modules/flow-rules/flow-rules.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';
import { FlowRuleTrigger, FlowRuleAction } from '@prisma/client';
import { FlowRulesService } from '../../src/modules/flow-rules/flow-rules.service.js';

describe('FlowRules Event-Driven Automation Engine Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const otherOrgId = '987e6543-e89b-42d3-a456-426614174999';
  const ownerUserId = 'usr-owner-1';
  const ruleId = '123e4567-e89b-42d3-a456-426614174111';

  function mockSession(orgId = targetOrgId, role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER') {
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: ownerUserId,
        email: `${role.toLowerCase()}@flowpilot.internal`,
        name: `${role} User`,
        memberships: [
          {
            organizationId: orgId,
            organizationName: 'Acme Advisory Studio',
            role,
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: orgId,
    });
  }

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/flow-rules', flowRulesRoutes);
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession(targetOrgId, 'OWNER');
  });

  const sampleRule = {
    id: ruleId,
    organizationId: targetOrgId,
    title: 'Instant Project Kickoff on Sign',
    description: 'Auto-create project when contract is signed',
    trigger: FlowRuleTrigger.CONTRACT_SIGNED,
    action: FlowRuleAction.CREATE_PROJECT,
    isActive: true,
    conditionsJson: { minAmount: 500 },
    actionConfigJson: { projectTitleTemplate: 'Delivery: {{entityTitle}}' },
    lastTriggeredAt: null,
    executionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    runs: [],
  };

  describe('1. FlowRule CRUD & Validation Endpoints', () => {
    it('POST /api/v1/flow-rules > successfully creates a new automation rule', async () => {
      vi.spyOn(prisma.flowRule, 'create').mockResolvedValue(sampleRule as any);

      const res = await request(createTestApp())
        .post('/api/v1/flow-rules')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          title: 'Instant Project Kickoff on Sign',
          description: 'Auto-create project when contract is signed',
          trigger: 'CONTRACT_SIGNED',
          action: 'CREATE_PROJECT',
          conditions: { minAmount: 500 },
          actionConfig: { projectTitleTemplate: 'Delivery: {{entityTitle}}' },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Instant Project Kickoff on Sign');
      expect(res.body.data.trigger).toBe('CONTRACT_SIGNED');
      expect(res.body.data.action).toBe('CREATE_PROJECT');
    });

    it('POST /api/v1/flow-rules > rejects invalid triggers with HTTP 400', async () => {
      const res = await request(createTestApp())
        .post('/api/v1/flow-rules')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          title: 'Invalid Rule',
          trigger: 'INVALID_TRIGGER_XYZ',
          action: 'CREATE_PROJECT',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/flow-rules > lists tenant rules with filtering', async () => {
      vi.spyOn(prisma.flowRule, 'count').mockResolvedValue(1);
      vi.spyOn(prisma.flowRule, 'findMany').mockResolvedValue([sampleRule as any]);

      const res = await request(createTestApp())
        .get('/api/v1/flow-rules?trigger=CONTRACT_SIGNED')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rules).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.rules[0].id).toBe(ruleId);
    });

    it('GET /api/v1/flow-rules/:id > retrieves rule details with recent executions', async () => {
      const ruleWithRuns = {
        ...sampleRule,
        runs: [
          {
            id: 'run-1',
            ruleId,
            organizationId: targetOrgId,
            status: 'SUCCESS',
            triggerEvent: 'CONTRACT_SIGNED',
            entityId: 'cnt-1',
            executionDurationMs: 42,
            errorMessage: null,
            logsJson: { createdProjectId: 'prj-1' },
            executedAt: new Date(),
          },
        ],
      };

      vi.spyOn(prisma.flowRule, 'findFirst').mockResolvedValue(ruleWithRuns as any);

      const res = await request(createTestApp())
        .get(`/api/v1/flow-rules/${ruleId}`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(ruleId);
      expect(res.body.data.recentExecutions).toHaveLength(1);
      expect(res.body.data.recentExecutions[0].status).toBe('SUCCESS');
    });

    it('PATCH /api/v1/flow-rules/:id/toggle > toggles active status', async () => {
      vi.spyOn(prisma.flowRule, 'findFirst').mockResolvedValue(sampleRule as any);
      vi.spyOn(prisma.flowRule, 'update').mockResolvedValue({
        ...sampleRule,
        isActive: false,
      } as any);

      const res = await request(createTestApp())
        .patch(`/api/v1/flow-rules/${ruleId}/toggle`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(false);
    });

    it('DELETE /api/v1/flow-rules/:id > successfully removes rule', async () => {
      vi.spyOn(prisma.flowRule, 'findFirst').mockResolvedValue(sampleRule as any);
      vi.spyOn(prisma.flowRule, 'delete').mockResolvedValue(sampleRule as any);

      const res = await request(createTestApp())
        .delete(`/api/v1/flow-rules/${ruleId}`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('2. Multi-Tenant Isolation', () => {
    it('prevents tenant B from fetching or modifying tenant A rules', async () => {
      mockSession(otherOrgId);
      vi.spyOn(prisma.flowRule, 'findFirst').mockResolvedValue(null);

      const res = await request(createTestApp())
        .get(`/api/v1/flow-rules/${ruleId}`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', otherOrgId);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Autonomous Event Dispatcher & Condition Matching', () => {
    it('FlowRulesService.dispatch > executes CREATE_PROJECT and logs execution on matching trigger', async () => {
      vi.spyOn(prisma.flowRule, 'findMany').mockResolvedValue([sampleRule as any]);
      vi.spyOn(prisma.project, 'create').mockResolvedValue({
        id: 'prj-auto-1',
        name: 'Delivery: Web App Overhaul',
      } as any);
      vi.spyOn(prisma.flowRuleExecution, 'create').mockResolvedValue({} as any);
      vi.spyOn(prisma.flowRule, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$transaction').mockResolvedValue([{}, {}] as any);

      const count = await FlowRulesService.dispatch(targetOrgId, FlowRuleTrigger.CONTRACT_SIGNED, {
        entityId: 'cnt-100',
        customerId: 'cst-100',
        title: 'Web App Overhaul',
        amount: 2500,
      });

      expect(count).toBe(1);
      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: targetOrgId,
            name: 'Delivery: Web App Overhaul',
            status: 'PLANNING',
          }),
        }),
      );
    });

    it('FlowRulesService.dispatch > skips execution when amount criteria is not met', async () => {
      vi.spyOn(prisma.flowRule, 'findMany').mockResolvedValue([sampleRule as any]); // minAmount: 500
      vi.spyOn(prisma.flowRuleExecution, 'create').mockResolvedValue({} as any);

      const count = await FlowRulesService.dispatch(targetOrgId, FlowRuleTrigger.CONTRACT_SIGNED, {
        entityId: 'cnt-100',
        customerId: 'cst-100',
        title: 'Micro Task',
        amount: 200, // < 500
      });

      expect(count).toBe(0);
      expect(prisma.flowRuleExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SKIPPED',
          }),
        }),
      );
    });
  });

  describe('4. Aggregate Statistics Endpoint', () => {
    it('GET /api/v1/flow-rules/stats > returns calculated operational metrics', async () => {
      vi.spyOn(prisma.flowRule, 'count').mockResolvedValueOnce(5).mockResolvedValueOnce(4);
      vi.spyOn(prisma.flowRuleExecution, 'findMany').mockResolvedValue([
        { status: 'SUCCESS' },
        { status: 'SUCCESS' },
        { status: 'SUCCESS' },
        { status: 'FAILED' },
      ] as any);

      const res = await request(createTestApp())
        .get('/api/v1/flow-rules/stats')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalRules).toBe(5);
      expect(res.body.data.activeRules).toBe(4);
      expect(res.body.data.totalExecutions).toBe(4);
      expect(res.body.data.successfulExecutions).toBe(3);
      expect(res.body.data.successRate).toBe(75);
      expect(res.body.data.estimatedHoursSaved).toBe(0.8);
    });
  });
});

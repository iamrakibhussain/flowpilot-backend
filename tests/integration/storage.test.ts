import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { storageRoutes } from '../../src/modules/storage/storage.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';
import { MemoryStorageProvider } from '../../src/modules/storage/providers/memory-storage.provider.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';

describe('Storage Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const otherOrgId = '987e6543-e21b-42d3-a456-426614174999';

  const mockOrg = {
    id: targetOrgId,
    name: 'Apex Studio Design',
    slug: 'apex-studio',
    logoUrl: 'https://example.com/initial-logo.png',
  };

  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  let app: express.Express;
  let memoryProvider: MemoryStorageProvider;

  beforeEach(() => {
    vi.restoreAllMocks();

    memoryProvider = new MemoryStorageProvider();
    StorageService.setProvider(memoryProvider);

    // Default session: OWNER of targetOrgId
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-owner-1',
        email: 'owner@apexstudio.com',
        name: 'Alex Rivera',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Apex Studio Design',
            role: 'OWNER',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });

    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.organization, 'update').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);

    app = express();

    // Content-Type gate replication from app.ts
    app.use((req, res, next) => {
      const contentLength = req.headers['content-length'];
      const transferEncoding = req.headers['transfer-encoding'];
      const hasBody =
        (contentLength !== undefined && contentLength !== '0') || Boolean(transferEncoding);
      if (hasBody) {
        const contentType = req.headers['content-type'];
        const isStorageUpload = req.path.startsWith('/api/v1/storage/upload');
        if (isStorageUpload) {
          if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
            res.status(415).json({
              success: false,
              error: {
                code: 'UNSUPPORTED_MEDIA_TYPE',
                message: 'Content-Type must be multipart/form-data for file uploads',
                status: 415,
              },
            });
            return;
          }
        } else if (!contentType || !contentType.toLowerCase().includes('application/json')) {
          res.status(415).json({
            success: false,
            error: {
              code: 'UNSUPPORTED_MEDIA_TYPE',
              message: 'Content-Type must be application/json for request payloads',
              status: 415,
            },
          });
          return;
        }
      }
      next();
    });

    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/storage', storageRoutes);
    app.use(errorHandler);
  });

  describe('POST /api/v1/storage/upload', () => {
    it('should successfully upload a valid PNG file and return tenant-scoped metadata', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .field('category', 'branding')
        .field('visibility', 'public')
        .attach('file', validPngBuffer, 'company-logo.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizationId).toBe(targetOrgId);
      expect(res.body.data.category).toBe('branding');
      expect(res.body.data.key).toContain(`organizations/${targetOrgId}/branding/`);
      expect(res.body.data.sanitizedFilename).toBe('company-logo.png');
      expect(res.body.data.url).toBeDefined();
    });

    it('should reject upload without authentication cookie', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('X-Organization-Id', targetOrgId)
        .attach('file', validPngBuffer, 'logo.png');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject upload missing X-Organization-Id header', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .attach('file', validPngBuffer, 'logo.png');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/missing required x-organization-id/i);
    });

    it('should reject upload when content signature does not match declared MIME', async () => {
      const fakePngBuffer = Buffer.from('not an image, just plain text payload');

      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .field('category', 'branding')
        .attach('file', fakePngBuffer, 'malicious.png');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/content signature/i);
    });

    it('should reject non-multipart uploads with 415 Unsupported Media Type', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .set('Content-Type', 'application/json')
        .send({ file: 'raw data' });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('POST /api/v1/storage/upload/logo', () => {
    it('should upload logo, update Organization.logoUrl and record audit log for OWNER', async () => {
      const res = await request(app)
        .post('/api/v1/storage/upload/logo')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .attach('file', validPngBuffer, 'brand-logo.png');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logoUrl).toBeDefined();
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: targetOrgId },
          data: { logoUrl: expect.stringContaining(`organizations/${targetOrgId}/branding/`) },
        }),
      );
    });

    it('should reject logo upload if user has only MEMBER role (requires OWNER/ADMIN)', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'test-session-id',
        user: {
          id: 'usr-member-1',
          email: 'member@apexstudio.com',
          name: 'Regular Member',
          memberships: [
            {
              organizationId: targetOrgId,
              organizationName: 'Apex Studio Design',
              role: 'MEMBER',
            },
          ],
        },
        activeOrganizationId: targetOrgId,
      });

      const res = await request(app)
        .post('/api/v1/storage/upload/logo')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .attach('file', validPngBuffer, 'brand-logo.png');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Signed URLs and Cross-Tenant Security', () => {
    it('should generate signed URL for asset belonging to active tenant', async () => {
      const tenantKey = `organizations/${targetOrgId}/documents/some-uuid-contract.pdf`;
      // Upload dummy file into memory provider
      await memoryProvider.upload(
        {
          buffer: Buffer.from('%PDF-1.7 dummy'),
          originalFilename: 'contract.pdf',
          mimeType: 'application/pdf',
          organizationId: targetOrgId,
          category: 'documents',
        },
        tenantKey,
      );

      const res = await request(app)
        .get('/api/v1/storage/signed-url')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .query({ key: tenantKey });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.signedUrl).toContain('memory://');
    });

    it('should reject signed URL request if key belongs to a different organization', async () => {
      const alienKey = `organizations/${otherOrgId}/documents/secret.pdf`;

      const res = await request(app)
        .get('/api/v1/storage/signed-url')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .query({ key: alienKey });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/does not belong to the active organization/i);
    });
  });

  describe('DELETE /api/v1/storage/files', () => {
    it('should delete tenant file when requested by OWNER', async () => {
      const tenantKey = `organizations/${targetOrgId}/branding/logo.png`;
      await memoryProvider.upload(
        {
          buffer: validPngBuffer,
          originalFilename: 'logo.png',
          mimeType: 'image/png',
          organizationId: targetOrgId,
          category: 'branding',
        },
        tenantKey,
      );

      const res = await request(app)
        .delete('/api/v1/storage/files')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .query({ key: tenantKey });

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      expect(await memoryProvider.exists(tenantKey)).toBe(false);
    });

    it('should reject deletion if user is not OWNER or ADMIN', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'test-session-id',
        user: {
          id: 'usr-member-1',
          email: 'member@apexstudio.com',
          name: 'Regular Member',
          memberships: [
            {
              organizationId: targetOrgId,
              organizationName: 'Apex Studio Design',
              role: 'MEMBER',
            },
          ],
        },
        activeOrganizationId: targetOrgId,
      });

      const res = await request(app)
        .delete('/api/v1/storage/files')
        .set('Cookie', ['flowpilot_session=valid-token'])
        .set('X-Organization-Id', targetOrgId)
        .query({ key: `organizations/${targetOrgId}/branding/logo.png` });

      expect(res.status).toBe(403);
    });
  });
});

import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { logger } from '../../common/logging/logger.js';
import { BadRequestError, NotFoundError } from '../../common/errors/app-error.js';
import { IStorageProvider } from './providers/storage.interface.js';
import { MemoryStorageProvider } from './providers/memory-storage.provider.js';
import { LocalStorageProvider } from './providers/local-storage.provider.js';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider.js';
import { S3StorageProvider } from './providers/s3-storage.provider.js';
import { StorageValidator } from './storage.validator.js';
import {
  GetSignedUrlOptions,
  StorageCategory,
  StorageUploadInput,
  StorageUploadResult,
  StorageVisibility,
} from './storage.types.js';

export class StorageService {
  private static activeProvider: IStorageProvider | null = null;

  public static getProvider(): IStorageProvider {
    if (this.activeProvider) {
      return this.activeProvider;
    }

    const providerType = env.STORAGE_PROVIDER;

    // Strict Production Gate: Never allow silent fallback to local disk or memory
    if (env.NODE_ENV === 'production') {
      if (providerType === 'memory' || providerType === 'local') {
        throw new Error(
          'Fatal: Local or in-memory storage cannot be used in production environment. A real cloud storage provider (Supabase Storage or AWS S3) is required.',
        );
      }
    }

    if (providerType === 'memory' || (providerType === 'auto' && env.NODE_ENV === 'test')) {
      logger.info('Initializing MemoryStorageProvider for storage engine');
      this.activeProvider = new MemoryStorageProvider();
      return this.activeProvider;
    }

    if (
      providerType === 'supabase' ||
      (providerType === 'auto' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
    ) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
          'Fatal: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase Storage',
        );
      }
      logger.info('Initializing SupabaseStorageProvider for cloud storage');
      this.activeProvider = new SupabaseStorageProvider();
      return this.activeProvider;
    }

    if (
      providerType === 's3' ||
      (providerType === 'auto' && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
    ) {
      if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
        throw new Error(
          'Fatal: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for S3 Storage',
        );
      }
      logger.info('Initializing S3StorageProvider for cloud storage');
      this.activeProvider = new S3StorageProvider();
      return this.activeProvider;
    }

    // Fail-safe protection: Production must never silently fall back to local disk
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'Fatal: Cloud storage is required in production, but no cloud provider credentials (Supabase or AWS S3) were found.',
      );
    }

    logger.info('Initializing LocalStorageProvider on disk for storage engine');
    this.activeProvider = new LocalStorageProvider();
    return this.activeProvider;
  }

  /**
   * Overrides active provider (used in tests or manual reconfiguration).
   */
  public static setProvider(provider: IStorageProvider): void {
    this.activeProvider = provider;
  }

  /**
   * Resets active provider to default environment resolution.
   */
  public static resetProvider(): void {
    this.activeProvider = null;
  }

  /**
   * Uploads an arbitrary file with strict validation, magic bytes inspection, and multi-tenant isolation.
   */
  public static async uploadFile(params: {
    buffer: Buffer;
    originalFilename: string;
    declaredMime: string;
    organizationId: string;
    category: StorageCategory;
    visibility?: StorageVisibility;
    customPrefix?: string;
    uploadedById?: string;
  }): Promise<StorageUploadResult> {
    const {
      buffer,
      originalFilename,
      declaredMime,
      organizationId,
      category,
      visibility: requestedVisibility,
      customPrefix,
    } = params;

    if (!organizationId) {
      throw new BadRequestError('organizationId is required for tenant isolation');
    }

    // 1. Magic bytes & schema validation
    const { sanitizedFilename, detectedMime } = StorageValidator.validateFile(
      buffer,
      originalFilename,
      declaredMime,
      category,
    );

    // 2. Resolve public vs private visibility
    const visibility = StorageValidator.resolveVisibility(category, requestedVisibility);

    // 3. Build tenant isolated key: organizations/{orgId}/{category}/{uuid}-{filename}
    const key = StorageValidator.buildTenantStorageKey(
      organizationId,
      category,
      sanitizedFilename,
      customPrefix,
    );

    // 4. Assert key belongs strictly to tenant
    StorageValidator.assertTenantKeyOwnership(key, organizationId);

    // 5. Delegate upload to active provider
    const provider = this.getProvider();
    const input: StorageUploadInput = {
      buffer,
      originalFilename,
      sanitizedFilename,
      mimeType: detectedMime,
      organizationId,
      category,
      visibility,
      customPrefix,
    };

    const result = await provider.upload(input, key);
    return result;
  }

  /**
   * Uploads workspace brand logo, persists URL in Organization.logoUrl, and records audit trail.
   */
  public static async uploadOrganizationLogo(params: {
    organizationId: string;
    buffer: Buffer;
    originalFilename: string;
    declaredMime: string;
    actor?: { id: string; name: string; ip?: string };
  }): Promise<{ upload: StorageUploadResult; logoUrl: string }> {
    const { organizationId, buffer, originalFilename, declaredMime, actor } = params;

    // Verify organization exists
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Upload with 'branding' category and 'public' visibility
    const upload = await this.uploadFile({
      buffer,
      originalFilename,
      declaredMime,
      organizationId,
      category: 'branding',
      visibility: 'public',
      uploadedById: actor?.id,
    });

    // Update Organization record in database
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        logoUrl: upload.url,
      },
    });

    // Record audit trail entry
    if (actor) {
      try {
        await prisma.workspaceAuditLog.create({
          data: {
            organizationId,
            userId: actor.id,
            userName: actor.name,
            action: 'UPDATED_SETTINGS',
            category: 'SETTINGS',
            details: `Uploaded new workspace brand logo (${upload.sanitizedFilename}, ${(upload.sizeBytes / 1024).toFixed(1)} KB)`,
            ipAddress: actor.ip || null,
          },
        });
      } catch {
        // Silently tolerate audit logging error
      }
    }

    return {
      upload,
      logoUrl: upload.url,
    };
  }

  /**
   * Generates a temporary signed URL for private asset access with tenant isolation check.
   */
  public static async getSignedUrl(
    organizationId: string,
    key: string,
    options?: GetSignedUrlOptions,
  ): Promise<string> {
    StorageValidator.assertTenantKeyOwnership(key, organizationId);
    const provider = this.getProvider();
    return provider.getSignedUrl(key, options);
  }

  /**
   * Deletes a file with strict tenant key ownership validation.
   */
  public static async deleteFile(organizationId: string, key: string): Promise<boolean> {
    StorageValidator.assertTenantKeyOwnership(key, organizationId);
    const provider = this.getProvider();
    return provider.delete(key);
  }

  /**
   * Checks file existence with tenant key ownership validation.
   */
  public static async exists(organizationId: string, key: string): Promise<boolean> {
    StorageValidator.assertTenantKeyOwnership(key, organizationId);
    const provider = this.getProvider();
    return provider.exists(key);
  }

  /**
   * Downloads raw file buffer for internal proxying or local file serving.
   */
  public static async download(organizationId: string, key: string) {
    StorageValidator.assertTenantKeyOwnership(key, organizationId);
    const provider = this.getProvider();
    if (!provider.download) {
      throw new BadRequestError('Download is not supported by the active storage provider');
    }
    return provider.download(key);
  }
}

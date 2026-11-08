import { Request, Response, NextFunction } from 'express';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import { StorageService } from './storage.service.js';
import { StorageCategory, StorageVisibility } from './storage.types.js';
import { LocalStorageProvider } from './providers/local-storage.provider.js';
import { StorageValidator } from './storage.validator.js';

export class StorageController {
  /**
   * Generic multi-tenant file upload endpoint.
   */
  public static async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new BadRequestError('No file uploaded. Please include a file in the "file" field.');
      }

      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context is required for file uploads');
      }

      const category = (req.body.category as StorageCategory) || 'branding';
      const visibility = req.body.visibility as StorageVisibility | undefined;
      const customPrefix = req.body.customPrefix as string | undefined;

      const result = await StorageService.uploadFile({
        buffer: file.buffer,
        originalFilename: file.originalname,
        declaredMime: file.mimetype,
        organizationId,
        category,
        visibility,
        customPrefix,
        uploadedById: req.user?.id,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Dedicated endpoint for workspace brand logo uploads.
   */
  public static async uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new BadRequestError(
          'No logo image uploaded. Please include a file in the "file" field.',
        );
      }

      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context is required for logo uploads');
      }

      const result = await StorageService.uploadOrganizationLogo({
        organizationId,
        buffer: file.buffer,
        originalFilename: file.originalname,
        declaredMime: file.mimetype,
        actor: req.user
          ? {
              id: req.user.id,
              name: req.user.name || req.user.email,
              ip: req.ip,
            }
          : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Endpoint to retrieve temporary signed URLs for private assets.
   */
  public static async getSignedUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context is required');
      }

      const key = (req.query.key as string) || (req.body?.key as string);
      if (!key) {
        throw new BadRequestError('File key parameter is required');
      }

      const expiresInSeconds = req.query.expiresIn
        ? parseInt(req.query.expiresIn as string, 10)
        : undefined;
      const downloadFilename = req.query.download as string | undefined;

      const signedUrl = await StorageService.getSignedUrl(organizationId, key, {
        expiresInSeconds,
        downloadFilename,
      });

      res.status(200).json({
        success: true,
        data: {
          key,
          signedUrl,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Endpoint to securely delete a file with tenant isolation and owner/admin authorization.
   */
  public static async deleteFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context is required');
      }

      const key = (req.query.key as string) || (req.body?.key as string) || req.params[0];
      if (!key) {
        throw new BadRequestError('File key parameter is required');
      }

      const deleted = await StorageService.deleteFile(organizationId, key);

      res.status(200).json({
        success: true,
        data: {
          deleted,
          key,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Serves files stored locally under uploads/ with signature verification and tenant protection.
   */
  public static async serveLocalFile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const rawKey = req.params[0] || (req.query.key as string);
      if (!rawKey) {
        throw new BadRequestError('Missing file key');
      }

      const key = decodeURIComponent(rawKey);

      // Defend against path traversal
      if (key.includes('..') || key.includes('\\')) {
        throw new BadRequestError('Invalid file key');
      }

      const provider = StorageService.getProvider();

      // Check signature if private or signed
      const expires = req.query.expires ? parseInt(req.query.expires as string, 10) : 0;
      const sig = req.query.sig as string | undefined;

      if (sig || expires) {
        const local =
          provider instanceof LocalStorageProvider ? provider : new LocalStorageProvider();
        const isValid = local.verifySignature(key, expires, sig || '');
        if (!isValid) {
          throw new ForbiddenError('Invalid or expired signed URL for storage asset');
        }
      }

      if (!provider.download) {
        throw new NotFoundError('File download not supported by active provider');
      }

      const file = await provider.download(key);
      if (!file) {
        throw new NotFoundError('Storage asset not found');
      }

      // Detect MIME type from buffer
      const detectedMime = StorageValidator.detectMimeTypeFromBuffer(file.buffer) || file.mimeType;

      res.setHeader('Content-Type', detectedMime);
      res.setHeader('Content-Length', file.sizeBytes);

      // Set download header if requested
      const downloadName = req.query.download as string | undefined;
      if (downloadName) {
        const sanitized = StorageValidator.sanitizeFilename(downloadName).sanitized;
        res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      // Cache headers: public assets cached for 1 day, signed/private assets no-store
      if (sig) {
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      }

      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  }
}

import path from 'node:path';
import crypto from 'node:crypto';
import { BadRequestError } from '../../common/errors/app-error.js';
import { CATEGORY_CONFIGS, StorageCategory, StorageVisibility } from './storage.types.js';

export class StorageValidator {
  /**
   * Sanitizes user-supplied filename to prevent path traversal, hidden files, or dangerous extensions.
   */
  public static sanitizeFilename(rawFilename: string): {
    sanitized: string;
    extension: string;
    baseName: string;
  } {
    if (!rawFilename || typeof rawFilename !== 'string') {
      return {
        sanitized: `file-${Date.now()}`,
        extension: '',
        baseName: `file-${Date.now()}`,
      };
    }

    // 1. Extract basename to defeat path traversal (e.g. ../../etc/passwd)
    const base = path.basename(rawFilename);

    // 2. Separate extension safely regardless of case
    const ext = path.extname(base);
    const rawBaseName = ext.length > 0 ? base.slice(0, base.length - ext.length) : base;

    // 3. Clean up basename: keep only alphanumeric, hyphens, and underscores, trimming leading/trailing underscores
    const safeBaseName = rawBaseName
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);

    const safeExtension = ext
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '')
      .slice(0, 10);
    const finalBase = safeBaseName || 'asset';
    const sanitized = `${finalBase}${safeExtension}`;

    return {
      sanitized,
      extension: safeExtension,
      baseName: finalBase,
    };
  }

  /**
   * Inspects magic bytes (file signature) to detect spoofed MIME types.
   */
  public static detectMimeTypeFromBuffer(buffer: Buffer): string | null {
    if (!buffer || buffer.length < 4) {
      return null;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // WebP: RIFF ... WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 && // RIFF
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50 // WEBP
    ) {
      return 'image/webp';
    }

    // GIF: GIF87a or GIF89a
    if (
      buffer.length >= 6 &&
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) &&
      buffer[5] === 0x61
    ) {
      return 'image/gif';
    }

    // PDF: %PDF-
    if (
      buffer.length >= 5 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2d
    ) {
      return 'application/pdf';
    }

    // SVG: Check first 512 bytes for <svg tag
    const sample = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf-8');
    if (sample.includes('<svg') && !sample.includes('\0')) {
      return 'image/svg+xml';
    }

    // Text / CSV / JSON
    if (!buffer.subarray(0, Math.min(buffer.length, 256)).includes(0x00)) {
      try {
        JSON.parse(buffer.toString('utf-8'));
        return 'application/json';
      } catch {
        // Not JSON, check if it's text
        return 'text/plain';
      }
    }

    return null;
  }

  /**
   * Validates file buffer, declared MIME, size limits, and category constraints.
   */
  public static validateFile(
    buffer: Buffer,
    originalFilename: string,
    declaredMime: string,
    category: StorageCategory,
  ): {
    sanitizedFilename: string;
    extension: string;
    detectedMime: string;
  } {
    const config = CATEGORY_CONFIGS[category];
    if (!config) {
      throw new BadRequestError(`Unsupported storage category: ${category}`);
    }

    if (!buffer || buffer.length === 0) {
      throw new BadRequestError('Upload payload is empty');
    }

    // 1. Size check
    if (buffer.length > config.maxSizeBytes) {
      const maxMb = Math.round(config.maxSizeBytes / (1024 * 1024));
      throw new BadRequestError(
        `File size (${(buffer.length / (1024 * 1024)).toFixed(2)}MB) exceeds ${maxMb}MB limit for category '${category}'`,
      );
    }

    // 2. Sanitize filename
    const { sanitized, extension } = this.sanitizeFilename(originalFilename);

    // 3. Extension check
    if (!config.allowedExtensions.includes(extension)) {
      throw new BadRequestError(
        `File extension '${extension}' is not allowed for category '${category}'. Allowed: ${config.allowedExtensions.join(', ')}`,
      );
    }

    // 4. Content signature verification (Magic Bytes)
    const detected = this.detectMimeTypeFromBuffer(buffer);
    const mimeParts = (declaredMime || '').toLowerCase().split(';');
    const normalizedDeclared = (mimeParts[0] || '').trim();

    if (!config.allowedMimeTypes.includes(normalizedDeclared)) {
      throw new BadRequestError(
        `MIME type '${normalizedDeclared}' is not permitted for category '${category}'`,
      );
    }

    // Verify magic byte compatibility
    if (detected) {
      // Allow text/plain to match text/csv or application/json
      const isTextMatch =
        (normalizedDeclared === 'text/csv' || normalizedDeclared === 'application/json') &&
        (detected === 'text/plain' || detected === 'application/json');

      if (detected !== normalizedDeclared && !isTextMatch) {
        throw new BadRequestError(
          `File content signature (${detected}) does not match declared MIME type (${normalizedDeclared})`,
        );
      }
    }

    return {
      sanitizedFilename: sanitized,
      extension,
      detectedMime: detected || normalizedDeclared,
    };
  }

  /**
   * Generates a multi-tenant isolated storage key.
   * Format: organizations/{organizationId}/{category}/{uuid}-{sanitizedFilename}
   */
  public static buildTenantStorageKey(
    organizationId: string,
    category: StorageCategory,
    sanitizedFilename: string,
    customPrefix?: string,
  ): string {
    const uuid = crypto.randomUUID();
    const prefix = customPrefix ? `${customPrefix.replace(/[^a-zA-Z0-9_-]/g, '')}/` : '';
    return `organizations/${organizationId}/${category}/${prefix}${uuid}-${sanitizedFilename}`;
  }

  /**
   * Asserts that a storage key strictly belongs to the specified organization.
   * Defeats cross-tenant path manipulation or directory traversal.
   */
  public static assertTenantKeyOwnership(key: string, organizationId: string): void {
    if (!key || typeof key !== 'string') {
      throw new BadRequestError('Invalid storage key');
    }

    // Deny path traversal markers
    if (key.includes('..') || key.includes('\\') || key.includes('//')) {
      throw new BadRequestError('Storage key contains invalid path characters');
    }

    const expectedPrefix = `organizations/${organizationId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new BadRequestError('Storage key does not belong to the active organization');
    }
  }

  /**
   * Determines effective visibility for an asset.
   */
  public static resolveVisibility(
    category: StorageCategory,
    requestedVisibility?: StorageVisibility,
  ): StorageVisibility {
    if (requestedVisibility === 'public' || requestedVisibility === 'private') {
      return requestedVisibility;
    }
    return CATEGORY_CONFIGS[category]?.defaultVisibility ?? 'private';
  }
}

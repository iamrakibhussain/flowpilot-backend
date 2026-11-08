import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../../config/env.js';
import { IStorageProvider, StorageFileDownload } from './storage.interface.js';
import { GetSignedUrlOptions, StorageUploadInput, StorageUploadResult } from '../storage.types.js';

export class LocalStorageProvider implements IStorageProvider {
  public readonly providerName = 'local';
  private readonly rootDir: string;
  private readonly signingSecret: string;

  constructor(rootDir = env.STORAGE_LOCAL_ROOT, signingSecret = env.STORAGE_SIGNING_SECRET) {
    this.rootDir = path.resolve(process.cwd(), rootDir);
    this.signingSecret = signingSecret;
  }

  private resolveSafePath(key: string): string {
    const safeKey = key.replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = path.resolve(this.rootDir, safeKey);

    // Defense-in-depth: Prevent directory escape
    if (!targetPath.startsWith(this.rootDir)) {
      throw new Error(`Security violation: Key '${key}' traverses outside storage root`);
    }

    return targetPath;
  }

  public generateSignature(key: string, expires: number): string {
    return crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${key}:${expires}`)
      .digest('hex');
  }

  public verifySignature(key: string, expires: number, signature: string): boolean {
    if (!signature || !expires || Date.now() > expires) {
      return false;
    }
    const expected = this.generateSignature(key, expires);
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  public async upload(input: StorageUploadInput, key: string): Promise<StorageUploadResult> {
    const fullPath = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.buffer);

    const isPublic = input.visibility === 'public';
    const safeKeyPath = key.split('/').map(encodeURIComponent).join('/');
    const relativeUrl = `/api/v1/storage/files/${safeKeyPath}`;
    const expiryMs = Date.now() + (env.STORAGE_SIGNED_URL_EXPIRY_SECONDS || 900) * 1000;
    const signature = this.generateSignature(key, expiryMs);
    const signedQuery = `?expires=${expiryMs}&sig=${signature}`;
    const signedUrl = `${relativeUrl}${signedQuery}`;

    const effectiveUrl = isPublic ? relativeUrl : signedUrl;

    return {
      key,
      url: effectiveUrl,
      publicUrl: isPublic ? relativeUrl : undefined,
      signedUrl: !isPublic ? signedUrl : undefined,
      originalFilename: input.originalFilename,
      sanitizedFilename: input.sanitizedFilename || key.split('/').pop() || input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      category: input.category,
      organizationId: input.organizationId,
      visibility: input.visibility || 'private',
      createdAt: new Date().toISOString(),
    };
  }

  public async getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string> {
    const exists = await this.exists(key);
    if (!exists) {
      throw new Error(`File not found: ${key}`);
    }

    const expirySeconds = options?.expiresInSeconds || env.STORAGE_SIGNED_URL_EXPIRY_SECONDS || 900;
    const expiryMs = Date.now() + expirySeconds * 1000;
    const signature = this.generateSignature(key, expiryMs);
    const downloadQuery = options?.downloadFilename
      ? `&download=${encodeURIComponent(options.downloadFilename)}`
      : '';

    const safeKeyPath = key.split('/').map(encodeURIComponent).join('/');
    return `/api/v1/storage/files/${safeKeyPath}?expires=${expiryMs}&sig=${signature}${downloadQuery}`;
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(key);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  public async delete(key: string): Promise<boolean> {
    try {
      const fullPath = this.resolveSafePath(key);
      await fs.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  public async download(key: string): Promise<StorageFileDownload | null> {
    try {
      const fullPath = this.resolveSafePath(key);
      const buffer = await fs.readFile(fullPath);
      return {
        buffer,
        mimeType: 'application/octet-stream',
        sizeBytes: buffer.length,
      };
    } catch {
      return null;
    }
  }
}

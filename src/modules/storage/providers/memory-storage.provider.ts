import crypto from 'node:crypto';
import { IStorageProvider, StorageFileDownload } from './storage.interface.js';
import { GetSignedUrlOptions, StorageUploadInput, StorageUploadResult } from '../storage.types.js';

interface InMemoryFileEntry {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  sanitizedFilename: string;
  createdAt: Date;
}

export class MemoryStorageProvider implements IStorageProvider {
  public readonly providerName = 'memory';
  private readonly storage = new Map<string, InMemoryFileEntry>();

  public async upload(input: StorageUploadInput, key: string): Promise<StorageUploadResult> {
    const entry: InMemoryFileEntry = {
      buffer: Buffer.from(input.buffer),
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      originalFilename: input.originalFilename,
      sanitizedFilename: input.sanitizedFilename || key.split('/').pop() || input.originalFilename,
      createdAt: new Date(),
    };

    this.storage.set(key, entry);

    const isPublic = input.visibility === 'public';
    const baseUrl = `memory://${key}`;
    const signedUrl = `memory://${key}?token=${crypto.randomBytes(16).toString('hex')}&expires=${Date.now() + 900000}`;

    return {
      key,
      url: isPublic ? baseUrl : signedUrl,
      publicUrl: isPublic ? baseUrl : undefined,
      signedUrl: !isPublic ? signedUrl : undefined,
      originalFilename: input.originalFilename,
      sanitizedFilename: entry.sanitizedFilename,
      mimeType: input.mimeType,
      sizeBytes: entry.sizeBytes,
      category: input.category,
      organizationId: input.organizationId,
      visibility: input.visibility || 'private',
      createdAt: entry.createdAt.toISOString(),
    };
  }

  public async getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string> {
    const exists = this.storage.has(key);
    if (!exists) {
      throw new Error(`File not found: ${key}`);
    }

    const expiry = Date.now() + (options?.expiresInSeconds || 900) * 1000;
    const token = crypto.randomBytes(16).toString('hex');
    return `memory://${key}?token=${token}&expires=${expiry}`;
  }

  public async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  public async delete(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  public async download(key: string): Promise<StorageFileDownload | null> {
    const entry = this.storage.get(key);
    if (!entry) {
      return null;
    }
    return {
      buffer: Buffer.from(entry.buffer),
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
    };
  }

  public clear(): void {
    this.storage.clear();
  }
}

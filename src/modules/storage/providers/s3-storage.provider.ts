import { env } from '../../../config/env.js';
import { IStorageProvider, StorageFileDownload } from './storage.interface.js';
import { GetSignedUrlOptions, StorageUploadInput, StorageUploadResult } from '../storage.types.js';

export class S3StorageProvider implements IStorageProvider {
  public readonly providerName = 's3';
  private readonly bucketPublic: string;
  private readonly bucketPrivate: string;
  private readonly region: string;
  private readonly endpoint?: string;

  constructor(
    bucketPublic = env.STORAGE_BUCKET_PUBLIC,
    bucketPrivate = env.STORAGE_BUCKET_PRIVATE,
    region = env.AWS_REGION,
    endpoint = env.AWS_ENDPOINT,
  ) {
    this.bucketPublic = bucketPublic;
    this.bucketPrivate = bucketPrivate;
    this.region = region;
    this.endpoint = endpoint;
  }

  private getBucket(visibility: 'public' | 'private'): string {
    return visibility === 'public' ? this.bucketPublic : this.bucketPrivate;
  }

  private getBaseUrl(bucket: string): string {
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/+$/, '')}/${bucket}`;
    }
    return `https://${bucket}.s3.${this.region}.amazonaws.com`;
  }

  public async upload(input: StorageUploadInput, key: string): Promise<StorageUploadResult> {
    const visibility = input.visibility || 'private';
    const bucket = this.getBucket(visibility);
    const baseUrl = this.getBaseUrl(bucket);
    const fileUrl = `${baseUrl}/${key}`;

    // Note: S3 direct PUT / AWS Signature V4 REST call
    const isPublic = visibility === 'public';

    return {
      key,
      url: fileUrl,
      publicUrl: isPublic ? fileUrl : undefined,
      signedUrl: !isPublic ? await this.getSignedUrl(key) : undefined,
      originalFilename: input.originalFilename,
      sanitizedFilename: input.sanitizedFilename || key.split('/').pop() || input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      category: input.category,
      organizationId: input.organizationId,
      visibility,
      createdAt: new Date().toISOString(),
    };
  }

  public async getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string> {
    const bucket = this.bucketPrivate;
    const baseUrl = this.getBaseUrl(bucket);
    const expires = Math.floor(
      Date.now() / 1000 +
        (options?.expiresInSeconds || env.STORAGE_SIGNED_URL_EXPIRY_SECONDS || 900),
    );
    // Presigned S3 query representation
    return `${baseUrl}/${key}?X-Amz-Expires=${expires}`;
  }

  public async exists(key: string): Promise<boolean> {
    // S3 HEAD object check stub
    return Boolean(key);
  }

  public async delete(key: string): Promise<boolean> {
    // S3 DELETE object stub
    return Boolean(key);
  }

  public async download(_key: string): Promise<StorageFileDownload | null> {
    return null;
  }
}

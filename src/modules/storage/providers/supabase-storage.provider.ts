import { env } from '../../../config/env.js';
import { IStorageProvider, StorageFileDownload } from './storage.interface.js';
import { GetSignedUrlOptions, StorageUploadInput, StorageUploadResult } from '../storage.types.js';

export class SupabaseStorageProvider implements IStorageProvider {
  public readonly providerName = 'supabase';
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly publicBucket: string;
  private readonly privateBucket: string;

  constructor(
    supabaseUrl = env.SUPABASE_URL || '',
    serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '',
    publicBucket = env.STORAGE_BUCKET_PUBLIC,
    privateBucket = env.STORAGE_BUCKET_PRIVATE,
  ) {
    this.supabaseUrl = supabaseUrl.replace(/\/+$/, '');
    this.serviceRoleKey = serviceRoleKey;
    this.publicBucket = publicBucket;
    this.privateBucket = privateBucket;
  }

  private getBucket(visibility: 'public' | 'private'): string {
    return visibility === 'public' ? this.publicBucket : this.privateBucket;
  }

  public async upload(input: StorageUploadInput, key: string): Promise<StorageUploadResult> {
    const visibility = input.visibility || 'private';
    const bucket = this.getBucket(visibility);
    const url = `${this.supabaseUrl}/storage/v1/object/${bucket}/${key}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': input.mimeType,
        'x-upsert': 'true',
      },
      body: input.buffer,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase Storage upload failed (${res.status}): ${errText}`);
    }

    const publicUrl =
      visibility === 'public'
        ? `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${key}`
        : undefined;

    let signedUrl: string | undefined;
    if (visibility === 'private') {
      signedUrl = await this.getSignedUrl(key, { expiresInSeconds: 900 });
    }

    return {
      key,
      url: publicUrl || signedUrl || key,
      publicUrl,
      signedUrl,
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
    const isPublicCategory = key.includes('/branding/') || key.includes('/avatars/');
    const bucket = isPublicCategory ? this.publicBucket : this.privateBucket;
    const url = `${this.supabaseUrl}/storage/v1/object/sign/${bucket}/${key}`;
    const expiresIn = options?.expiresInSeconds || env.STORAGE_SIGNED_URL_EXPIRY_SECONDS || 900;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expiresIn,
        transform: options?.downloadFilename ? { download: options.downloadFilename } : undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase Storage getSignedUrl failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const rawSignedPath = data.signedURL || data.signedUrl;
    if (!rawSignedPath) {
      throw new Error('Supabase Storage signedURL not returned in response');
    }

    const cleanPath = rawSignedPath.startsWith('/storage/v1')
      ? rawSignedPath
      : `/storage/v1${rawSignedPath.startsWith('/') ? '' : '/'}${rawSignedPath}`;

    return `${this.supabaseUrl}${cleanPath}`;
  }

  public async exists(key: string): Promise<boolean> {
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      try {
        const url = `${this.supabaseUrl}/storage/v1/object/info/${bucket}/${key}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.serviceRoleKey}`,
            apikey: this.serviceRoleKey,
          },
        });
        if (res.ok) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  public async delete(key: string): Promise<boolean> {
    let success = false;
    for (const bucket of [this.publicBucket, this.privateBucket]) {
      try {
        const url = `${this.supabaseUrl}/storage/v1/object/${bucket}`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.serviceRoleKey}`,
            apikey: this.serviceRoleKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: [key] }),
        });
        if (res.ok) {
          success = true;
        }
      } catch {
        // continue
      }
    }
    return success;
  }

  public async download(key: string): Promise<StorageFileDownload | null> {
    for (const bucket of [this.privateBucket, this.publicBucket]) {
      try {
        const url = `${this.supabaseUrl}/storage/v1/object/${bucket}/${key}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.serviceRoleKey}`,
            apikey: this.serviceRoleKey,
          },
        });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuf),
            mimeType: res.headers.get('content-type') || 'application/octet-stream',
            sizeBytes: arrayBuf.byteLength,
          };
        }
      } catch {
        // continue
      }
    }
    return null;
  }
}

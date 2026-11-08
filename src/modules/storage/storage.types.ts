export type StorageCategory = 'branding' | 'documents' | 'avatars' | 'exports' | 'attachments';

export type StorageVisibility = 'public' | 'private';

export interface StorageUploadInput {
  buffer: Buffer;
  originalFilename: string;
  sanitizedFilename?: string;
  mimeType: string;
  organizationId: string;
  category: StorageCategory;
  visibility?: StorageVisibility;
  customPrefix?: string;
}

export interface StorageUploadResult {
  key: string;
  url: string;
  publicUrl?: string;
  signedUrl?: string;
  originalFilename: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: StorageCategory;
  organizationId: string;
  visibility: StorageVisibility;
  createdAt: string;
}

export interface GetSignedUrlOptions {
  expiresInSeconds?: number;
  downloadFilename?: string;
}

export interface StoredFileRecord {
  id: string;
  organizationId: string;
  key: string;
  url: string;
  originalFilename: string;
  sanitizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  category: StorageCategory;
  visibility: StorageVisibility;
  uploadedById?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryValidationConfig {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxSizeBytes: number;
  defaultVisibility: StorageVisibility;
}

export const CATEGORY_CONFIGS: Record<StorageCategory, CategoryValidationConfig> = {
  branding: {
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    defaultVisibility: 'public',
  },
  avatars: {
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    maxSizeBytes: 2 * 1024 * 1024, // 2MB
    defaultVisibility: 'public',
  },
  documents: {
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv'],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.csv'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    defaultVisibility: 'private',
  },
  attachments: {
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'text/csv',
    ],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    defaultVisibility: 'private',
  },
  exports: {
    allowedMimeTypes: ['text/csv', 'application/json', 'application/pdf'],
    allowedExtensions: ['.csv', '.json', '.pdf'],
    maxSizeBytes: 15 * 1024 * 1024, // 15MB
    defaultVisibility: 'private',
  },
};

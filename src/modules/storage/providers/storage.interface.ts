import { GetSignedUrlOptions, StorageUploadInput, StorageUploadResult } from '../storage.types.js';

export interface StorageFileDownload {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface IStorageProvider {
  readonly providerName: string;

  /**
   * Uploads file buffer into cloud/local storage destination.
   */
  upload(input: StorageUploadInput, key: string): Promise<StorageUploadResult>;

  /**
   * Generates a temporary signed URL for private asset access or download.
   */
  getSignedUrl(key: string, options?: GetSignedUrlOptions): Promise<string>;

  /**
   * Checks whether a file exists at the specified key.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Deletes a file at the specified key.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Downloads file buffer (primarily used for local provider file streaming or virus scanning).
   */
  download?(key: string): Promise<StorageFileDownload | null>;
}


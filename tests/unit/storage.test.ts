import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageValidator } from '../../src/modules/storage/storage.validator.js';
import { MemoryStorageProvider } from '../../src/modules/storage/providers/memory-storage.provider.js';
import { LocalStorageProvider } from '../../src/modules/storage/providers/local-storage.provider.js';
import { SupabaseStorageProvider } from '../../src/modules/storage/providers/supabase-storage.provider.js';
import { StorageService } from '../../src/modules/storage/storage.service.js';
import { env } from '../../src/config/env.js';

describe('StorageValidator Unit Tests', () => {
  describe('sanitizeFilename', () => {
    it('should sanitize path traversal attempts and strip directory separators', () => {
      const malicious = '../../../../etc/passwd.png';
      const result = StorageValidator.sanitizeFilename(malicious);
      expect(result.sanitized).not.toContain('..');
      expect(result.sanitized).not.toContain('/');
      expect(result.sanitized).toBe('passwd.png');
      expect(result.extension).toBe('.png');
    });

    it('should strip illegal characters and preserve safe extension', () => {
      const weird = 'my brand @ logo (1) #2?.JPEG';
      const result = StorageValidator.sanitizeFilename(weird);
      expect(result.extension).toBe('.jpeg');
      expect(result.sanitized).toBe('my_brand_logo_1_2.jpeg');
    });

    it('should fallback gracefully for empty or invalid names', () => {
      const empty = StorageValidator.sanitizeFilename('');
      expect(empty.sanitized).toMatch(/^file-\d+/);
    });
  });

  describe('detectMimeTypeFromBuffer (Magic Bytes)', () => {
    it('should detect PNG magic bytes', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(StorageValidator.detectMimeTypeFromBuffer(pngBuffer)).toBe('image/png');
    });

    it('should detect JPEG magic bytes', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(StorageValidator.detectMimeTypeFromBuffer(jpegBuffer)).toBe('image/jpeg');
    });

    it('should detect WebP magic bytes', () => {
      // 'RIFF' .... 'WEBP'
      const webpBuffer = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP'),
      ]);
      expect(StorageValidator.detectMimeTypeFromBuffer(webpBuffer)).toBe('image/webp');
    });

    it('should detect PDF magic bytes', () => {
      const pdfBuffer = Buffer.from('%PDF-1.7\n%some content');
      expect(StorageValidator.detectMimeTypeFromBuffer(pdfBuffer)).toBe('application/pdf');
    });

    it('should detect SVG format from text stream', () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100"></svg>');
      expect(StorageValidator.detectMimeTypeFromBuffer(svgBuffer)).toBe('image/svg+xml');
    });
  });

  describe('validateFile constraints', () => {
    it('should pass validation for a valid PNG logo', () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22]);
      const res = StorageValidator.validateFile(validPng, 'logo.png', 'image/png', 'branding');
      expect(res.sanitizedFilename).toBe('logo.png');
      expect(res.extension).toBe('.png');
      expect(res.detectedMime).toBe('image/png');
    });

    it('should reject file when magic bytes do not match declared MIME', () => {
      // Disguised shell/text file pretending to be image/png
      const fakePng = Buffer.from('<?php echo "exploit"; ?>');
      expect(() =>
        StorageValidator.validateFile(fakePng, 'exploit.png', 'image/png', 'branding'),
      ).toThrowError(/content signature/i);
    });

    it('should reject file exceeding category size limit', () => {
      // Branding has 5MB limit; test with 6MB buffer
      const oversized = Buffer.alloc(6 * 1024 * 1024);
      // Give it PNG magic bytes so it only fails on size
      oversized[0] = 0x89;
      oversized[1] = 0x50;
      oversized[2] = 0x4e;
      oversized[3] = 0x47;
      oversized[4] = 0x0d;
      oversized[5] = 0x0a;
      oversized[6] = 0x1a;
      oversized[7] = 0x0a;

      expect(() =>
        StorageValidator.validateFile(oversized, 'huge.png', 'image/png', 'branding'),
      ).toThrowError(/exceeds 5MB limit/i);
    });

    it('should reject unpermitted file extensions for category', () => {
      const exeBuffer = Buffer.from('MZ\x90\x00');
      expect(() =>
        StorageValidator.validateFile(
          exeBuffer,
          'malware.exe',
          'application/octet-stream',
          'branding',
        ),
      ).toThrowError(/extension '\.exe' is not allowed/i);
    });
  });

  describe('Multi-tenant isolation key formatting', () => {
    it('should generate properly isolated key with org prefix', () => {
      const orgId = '77777777-7777-7777-7777-777777777777';
      const key = StorageValidator.buildTenantStorageKey(orgId, 'branding', 'logo.png');
      expect(key.startsWith(`organizations/${orgId}/branding/`)).toBe(true);
      expect(key.endsWith('-logo.png')).toBe(true);
    });

    it('should assert ownership and reject cross-tenant key access', () => {
      const orgA = '11111111-1111-1111-1111-111111111111';
      const orgB = '22222222-2222-2222-2222-222222222222';
      const keyA = `organizations/${orgA}/branding/some-uuid-logo.png`;

      // Ownership valid for orgA
      expect(() => StorageValidator.assertTenantKeyOwnership(keyA, orgA)).not.toThrow();

      // Ownership rejected for orgB
      expect(() => StorageValidator.assertTenantKeyOwnership(keyA, orgB)).toThrowError(
        /does not belong to the active organization/i,
      );
    });

    it('should reject keys containing path traversal characters', () => {
      const orgA = '11111111-1111-1111-1111-111111111111';
      const maliciousKey = `organizations/${orgA}/branding/../../../etc/passwd`;

      expect(() => StorageValidator.assertTenantKeyOwnership(maliciousKey, orgA)).toThrowError(
        /invalid path characters/i,
      );
    });
  });
});

describe('Providers Unit Tests', () => {
  describe('MemoryStorageProvider', () => {
    it('should upload, check existence, download, and delete in-memory files', async () => {
      const provider = new MemoryStorageProvider();
      const testBuffer = Buffer.from('hello in-memory world');
      const key = 'organizations/test-org/branding/uuid-logo.png';

      const uploadResult = await provider.upload(
        {
          buffer: testBuffer,
          originalFilename: 'logo.png',
          mimeType: 'image/png',
          organizationId: 'test-org',
          category: 'branding',
          visibility: 'public',
        },
        key,
      );

      expect(uploadResult.key).toBe(key);
      expect(await provider.exists(key)).toBe(true);

      const downloaded = await provider.download(key);
      expect(downloaded?.buffer.toString()).toBe('hello in-memory world');

      const signedUrl = await provider.getSignedUrl(key, { expiresInSeconds: 60 });
      expect(signedUrl).toContain('memory://');
      expect(signedUrl).toContain('token=');

      const deleted = await provider.delete(key);
      expect(deleted).toBe(true);
      expect(await provider.exists(key)).toBe(false);
    });
  });

  describe('LocalStorageProvider HMAC Signatures & Security', () => {
    const testLocalRoot = path.join(process.cwd(), 'tmp-test-uploads');
    const secret = 'super-secret-signing-key-for-test-32chars';
    let provider: LocalStorageProvider;

    beforeEach(async () => {
      provider = new LocalStorageProvider(testLocalRoot, secret);
    });

    afterEach(async () => {
      try {
        await fs.rm(testLocalRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('should generate and verify valid HMAC-SHA256 signatures', () => {
      const key = 'organizations/org-1/branding/file.png';
      const expires = Date.now() + 60000;
      const sig = provider.generateSignature(key, expires);

      expect(provider.verifySignature(key, expires, sig)).toBe(true);

      // Fails on tampered signature
      const tamperedSig = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
      expect(provider.verifySignature(key, expires, tamperedSig)).toBe(false);

      // Fails on altered key
      expect(provider.verifySignature('organizations/org-2/branding/file.png', expires, sig)).toBe(
        false,
      );

      // Fails on expired timestamp
      const expiredMs = Date.now() - 1000;
      const expiredSig = provider.generateSignature(key, expiredMs);
      expect(provider.verifySignature(key, expiredMs, expiredSig)).toBe(false);
    });

    it('should save file to disk safely and verify download', async () => {
      const testBuffer = Buffer.from('disk file content');
      const key = 'organizations/org-test/documents/doc.txt';

      const res = await provider.upload(
        {
          buffer: testBuffer,
          originalFilename: 'doc.txt',
          mimeType: 'text/plain',
          organizationId: 'org-test',
          category: 'documents',
          visibility: 'private',
        },
        key,
      );

      expect(await provider.exists(key)).toBe(true);
      expect(res.signedUrl).toContain('sig=');

      const file = await provider.download(key);
      expect(file?.buffer.toString()).toBe('disk file content');

      await provider.delete(key);
      expect(await provider.exists(key)).toBe(false);
    });
  });

  describe('SupabaseStorageProvider', () => {
    const fakeUrl = 'https://test-project.supabase.co';
    const fakeKey = 'fake-service-role-key-for-test';
    let provider: SupabaseStorageProvider;

    beforeEach(() => {
      provider = new SupabaseStorageProvider(
        fakeUrl,
        fakeKey,
        'flowpilot-public',
        'flowpilot-private',
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should upload a public asset and return publicUrl', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ Key: 'flowpilot-public/branding/logo.png' }), {
          status: 200,
        }),
      );

      const buffer = Buffer.from('fake-png-content');
      const key = 'organizations/org-123/branding/logo.png';
      const result = await provider.upload(
        {
          buffer,
          originalFilename: 'logo.png',
          mimeType: 'image/png',
          organizationId: 'org-123',
          category: 'branding',
          visibility: 'public',
        },
        key,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0]!;
      expect(call[0]).toBe(`${fakeUrl}/storage/v1/object/flowpilot-public/${key}`);
      expect((call[1]?.headers as Record<string, string>)['apikey']).toBe(fakeKey);
      expect((call[1]?.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${fakeKey}`,
      );
      expect(result.publicUrl).toBe(`${fakeUrl}/storage/v1/object/public/flowpilot-public/${key}`);
      expect(result.url).toBe(`${fakeUrl}/storage/v1/object/public/flowpilot-public/${key}`);
      expect(result.visibility).toBe('public');
    });

    it('should upload a private asset and return signedUrl', async () => {
      // 1st fetch: POST object
      // 2nd fetch: POST sign
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ Key: 'flowpilot-private/documents/doc.pdf' }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              signedURL: '/object/sign/flowpilot-private/documents/doc.pdf?token=abc',
            }),
            { status: 200 },
          ),
        );

      const buffer = Buffer.from('fake-pdf-content');
      const key = 'organizations/org-123/documents/doc.pdf';
      const result = await provider.upload(
        {
          buffer,
          originalFilename: 'doc.pdf',
          mimeType: 'application/pdf',
          organizationId: 'org-123',
          category: 'documents',
          visibility: 'private',
        },
        key,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.signedUrl).toContain(`${fakeUrl}/storage/v1/object/sign/flowpilot-private/`);
      expect(result.signedUrl).toContain('token=abc');
      expect(result.publicUrl).toBeUndefined();
      expect(result.visibility).toBe('private');
    });

    it('should generate signed URL with options and custom expiry', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            signedURL: '/storage/v1/object/sign/flowpilot-private/invoices/inv.pdf?token=xyz',
          }),
          { status: 200 },
        ),
      );

      const key = 'organizations/org-123/documents/invoices/inv.pdf';
      const signedUrl = await provider.getSignedUrl(key, { expiresInSeconds: 600 });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(signedUrl).toBe(
        `${fakeUrl}/storage/v1/object/sign/flowpilot-private/invoices/inv.pdf?token=xyz`,
      );
    });

    it('should check file existence across public and private buckets', async () => {
      // 1st call (publicBucket) fails 404, 2nd call (privateBucket) succeeds 200
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'file.pdf' }), { status: 200 }));

      const exists = await provider.exists('organizations/org-123/documents/file.pdf');
      expect(exists).toBe(true);
    });

    it('should delete file by issuing DELETE request with prefixes', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Successfully deleted' }), { status: 200 }),
        );

      const deleted = await provider.delete('organizations/org-123/branding/logo.png');
      expect(deleted).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should download file buffer from Supabase', async () => {
      const payload = Buffer.from('downloaded-content');
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(payload, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      );

      const downloadResult = await provider.download('organizations/org-123/documents/file.pdf');
      expect(downloadResult).not.toBeNull();
      expect(downloadResult?.buffer.toString()).toBe('downloaded-content');
      expect(downloadResult?.mimeType).toBe('application/pdf');
    });

    it('should throw clear error on failed upload', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Bucket not found', { status: 404 }),
      );

      await expect(
        provider.upload(
          {
            buffer: Buffer.from('data'),
            originalFilename: 'test.png',
            mimeType: 'image/png',
            organizationId: 'org-123',
            category: 'branding',
          },
          'organizations/org-123/branding/test.png',
        ),
      ).rejects.toThrowError(/Supabase Storage upload failed \(404\)/i);
    });
  });

  describe('Production Cloud Storage Fail-Safe Gates', () => {
    afterEach(() => {
      StorageService.resetProvider();
    });

    it('should throw an error and refuse fallback if local or memory storage is requested in production', () => {
      // Temporarily simulate production environment
      const originalNodeEnv = env.NODE_ENV;
      const originalProvider = env.STORAGE_PROVIDER;

      try {
        (env as any).NODE_ENV = 'production';
        (env as any).STORAGE_PROVIDER = 'local';
        StorageService.resetProvider();

        expect(() => StorageService.getProvider()).toThrowError(
          /cannot be used in production environment/i,
        );

        (env as any).STORAGE_PROVIDER = 'memory';
        StorageService.resetProvider();

        expect(() => StorageService.getProvider()).toThrowError(
          /cannot be used in production environment/i,
        );
      } finally {
        (env as any).NODE_ENV = originalNodeEnv;
        (env as any).STORAGE_PROVIDER = originalProvider;
        StorageService.resetProvider();
      }
    });

    it('should fail safely in production when auto mode has no cloud credentials configured', () => {
      const originalNodeEnv = env.NODE_ENV;
      const originalProvider = env.STORAGE_PROVIDER;
      const originalSupabaseUrl = env.SUPABASE_URL;
      const originalSupabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
      const originalAwsKey = env.AWS_ACCESS_KEY_ID;

      try {
        (env as any).NODE_ENV = 'production';
        (env as any).STORAGE_PROVIDER = 'auto';
        (env as any).SUPABASE_URL = undefined;
        (env as any).SUPABASE_SERVICE_ROLE_KEY = undefined;
        (env as any).AWS_ACCESS_KEY_ID = undefined;
        StorageService.resetProvider();

        expect(() => StorageService.getProvider()).toThrowError(
          /cloud storage is required in production, but no cloud provider credentials/i,
        );
      } finally {
        (env as any).NODE_ENV = originalNodeEnv;
        (env as any).STORAGE_PROVIDER = originalProvider;
        (env as any).SUPABASE_URL = originalSupabaseUrl;
        (env as any).SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
        (env as any).AWS_ACCESS_KEY_ID = originalAwsKey;
        StorageService.resetProvider();
      }
    });
  });
});

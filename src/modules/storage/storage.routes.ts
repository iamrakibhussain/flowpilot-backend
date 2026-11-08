import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';
import { StorageController } from './storage.controller.js';

const router = Router();

// Configure Multer with in-memory buffer storage and 20MB ceiling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB absolute maximum ceiling
    files: 1,
  },
});

/**
 * Public or Signed URL Local Asset Serving Endpoint
 * Does not require auth cookie if valid HMAC signature or public file
 */
router.use('/files', (req, _res, next) => {
  if (req.url.includes('%2F') || req.url.includes('%2f')) {
    req.url = req.url.replace(/%2f/gi, '/');
  }
  next();
});

router.get('/files', StorageController.serveLocalFile);
router.get('/files/*', StorageController.serveLocalFile);

/**
 * Authenticated & Tenant-Scoped Storage Routes
 */
router.use(authenticate);

// Generic file upload (MEMBER, ADMIN, OWNER)
router.post('/upload', tenantContextMiddleware(), upload.single('file'), StorageController.upload);

// Dedicated workspace logo upload (ADMIN, OWNER only)
router.post(
  '/upload/logo',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  upload.single('file'),
  StorageController.uploadLogo,
);

// Signed URL retrieval for private tenant files
router.get('/signed-url', tenantContextMiddleware(), StorageController.getSignedUrl);

// File deletion (ADMIN, OWNER only)
router.delete(
  '/files',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  StorageController.deleteFile,
);

router.delete(
  '/files/*',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  StorageController.deleteFile,
);

export const storageRoutes = router;

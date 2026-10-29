import { Router } from 'express';
import { TeamController } from './team.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Public invitation verification & acceptance
router.get('/invitations/verify/:token', TeamController.verifyInvitation);
router.post('/invitations/accept', TeamController.acceptInvitation);

// Protected Workspace Team Management Routes (Requires OWNER or ADMIN)
const protectedRouter = Router();
protectedRouter.use(authenticate);
protectedRouter.use(
  tenantContextMiddleware({
    allowedRoles: ['OWNER', 'ADMIN'],
  }),
);

protectedRouter.get('/members', TeamController.listMembers);
protectedRouter.get('/invitations', TeamController.listInvitations);
protectedRouter.post('/invitations', TeamController.sendInvitation);
protectedRouter.delete('/invitations/:id', TeamController.revokeInvitation);
protectedRouter.patch('/members/:id/role', TeamController.updateMemberRole);
protectedRouter.delete('/members/:id', TeamController.removeMember);

router.use('/', protectedRouter);

export const teamRoutes = router;

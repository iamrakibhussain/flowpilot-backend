import { Request, Response } from 'express';
import { sendSuccess } from '../../common/http/response.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';

export class AuthController {
  public static async login(req: Request, res: Response): Promise<void> {
    const { email } = req.body;
    // Foundation boundary: Authentication logic will be implemented in subsequent phase
    // Return typed boundary response demonstrating contract compatibility
    sendSuccess(
      res,
      {
        message: 'Authentication foundation established. Full credential verification scheduled.',
        email,
      },
      200,
    );
  }

  public static async register(req: Request, res: Response): Promise<void> {
    const { email, name, organizationName } = req.body;
    sendSuccess(
      res,
      {
        message: 'Registration foundation established. Organization provisioning scheduled.',
        user: { email, name },
        organization: { name: organizationName },
      },
      201,
    );
  }

  public static async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie('flowpilot_session');
    sendSuccess(res, { message: 'Logged out successfully' }, 200);
  }

  public static async me(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      throw new UnauthorizedError('Not authenticated');
    }
    sendSuccess(res, req.user, 200);
  }
}

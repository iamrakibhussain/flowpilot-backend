import crypto from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  DUMMY_ARGON2_HASH,
  isValidSessionTokenFormat,
  timingSafeCompare,
} from './crypto.js';
import {
  LoginInput,
  RegisterInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ChangePasswordInput,
  DeleteAccountInput,
} from './auth.types.js';
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../../common/errors/app-error.js';
import { EmailService } from '../../common/email/email.service.js';
import { logger } from '../../common/logging/logger.js';
import { env } from '../../config/env.js';
import {
  AuthenticatedUser,
  OrganizationMembershipSummary,
  UserRole,
} from '../../common/types/index.js';

export interface SessionAuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    isEmailVerified?: boolean;
    emailVerifiedAt?: Date | null;
  };
  activeOrganizationId: string | null;
  memberships: OrganizationMembershipSummary[];
  rawToken: string;
}

export interface ValidatedSession {
  sessionId: string;
  user: AuthenticatedUser;
  activeOrganizationId: string | null;
}

/**
 * System-critical reserved keywords that cannot be claimed as an organization slug.
 * Prevents routing collision, subdomain takeover, and path-traversal impersonation.
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'config',
  'dashboard',
  'docs',
  'graphql',
  'health',
  'internal',
  'login',
  'logout',
  'null',
  'organization',
  'organizations',
  'privacy',
  'public',
  'register',
  'root',
  'security',
  'settings',
  'static',
  'status',
  'superadmin',
  'support',
  'system',
  'terms',
  'undefined',
  'user',
  'users',
  'v1',
  'v2',
  'webhook',
  'webhooks',
  'workspace',
  'workspaces',
]);

/**
 * Generates an SEO-safe, injection-proof organization slug.
 * If the input yields a reserved keyword or insufficient length, safe entropy is appended.
 */
export function slugify(name: string): string {
  const sanitized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized || sanitized.length < 2 || RESERVED_SLUGS.has(sanitized)) {
    return `workspace-${sanitized || 'org'}-${crypto.randomBytes(3).toString('hex')}`;
  }

  return sanitized;
}

export class AuthService {
  public static async register(
    input: RegisterInput,
    metadata: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<SessionAuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const normalizedName = input.name.trim();
    const normalizedOrgName = input.organizationName.trim();

    // 1. Verify email uniqueness
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictError('A user with this email address already exists');
    }

    // 2. Hash password with OWASP-recommended Argon2id parameters
    const passwordHash = await hashPassword(input.password);

    // 3. Generate initial organization slug with collision avoidance
    let slug = slugify(normalizedOrgName);
    const existingOrg = await prisma.organization.findUnique({
      where: { slug },
    });
    if (existingOrg) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    // 4. Generate high-entropy 256-bit cryptographically secure session token
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + env.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // 5. Transactional provisioning: User + Organization + OWNER Membership + Session
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedName,
          passwordHash,
          status: 'ACTIVE',
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: normalizedOrgName,
          slug,
          status: 'ACTIVE',
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'OWNER',
        },
      });

      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          expiresAt,
        },
      });

      return { user, organization };
    });

    const memberships: OrganizationMembershipSummary[] = [
      {
        organizationId: result.organization.id,
        organizationName: result.organization.name,
        role: 'OWNER',
        status: result.organization.status,
      },
    ];

    // 6. Automatically dispatch 6-digit email verification code upon initial registration
    try {
      await this.sendEmailVerification(result.user.id, result.user);
    } catch (emailErr) {
      logger.error(
        {
          event: 'security.auth.register.email_failed',
          userId: result.user.id,
          err: emailErr instanceof Error ? emailErr.message : 'Unknown email dispatch error',
        },
        'Failed to dispatch initial email verification code during registration',
      );
    }

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        isEmailVerified: Boolean(result.user.emailVerifiedAt),
        emailVerifiedAt: result.user.emailVerifiedAt ?? null,
      },
      activeOrganizationId: result.organization.id,
      memberships,
      rawToken,
    };
  }

  public static async login(
    input: LoginInput,
    metadata: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<SessionAuthResult> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // 1. Fetch user by email including organization memberships
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      // Execute Argon2id verification with matching work factor to eliminate timing side-channel user enumeration
      await verifyPassword(DUMMY_ARGON2_HASH, input.password);
      throw new UnauthorizedError('Invalid email or password');
    }

    // 2. Check account status
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('Account is suspended or deactivated');
    }

    // 3. Verify Argon2id password hash
    const isValidPassword = await verifyPassword(user.passwordHash, input.password);
    if (!isValidPassword) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // 4. Generate and store session
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + env.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        expiresAt,
      },
    });

    const memberships: OrganizationMembershipSummary[] = user.memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role as UserRole,
      status: m.organization.status,
    }));

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isEmailVerified: Boolean(user.emailVerifiedAt),
        emailVerifiedAt: user.emailVerifiedAt ?? null,
      },
      activeOrganizationId: memberships[0]?.organizationId ?? null,
      memberships,
      rawToken,
    };
  }

  public static async logout(
    rawToken?: string,
    options: { allDevices?: boolean } = {},
  ): Promise<void> {
    if (!isValidSessionTokenFormat(rawToken)) {
      return;
    }

    try {
      const tokenHash = hashSessionToken(rawToken);

      if (options.allDevices) {
        // Find session to determine associated user ID for full account session revocation
        const session = await prisma.session.findUnique({
          where: { tokenHash },
          select: { userId: true },
        });

        if (session?.userId) {
          await prisma.session.deleteMany({
            where: { userId: session.userId },
          });
          return;
        }
      }

      await prisma.session.deleteMany({
        where: { tokenHash },
      });
    } catch {
      // Graceful error handling on invalid token hash or connection drop
    }
  }

  public static async validateSession(rawToken?: string): Promise<ValidatedSession | null> {
    if (!isValidSessionTokenFormat(rawToken)) {
      return null;
    }

    try {
      const tokenHash = hashSessionToken(rawToken);

      const session = await prisma.session.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              memberships: {
                include: {
                  organization: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        return null;
      }

      // Check expiry
      if (session.expiresAt <= new Date()) {
        // Asynchronously purge expired session without blocking
        prisma.session.delete({ where: { id: session.id } }).catch(() => {});
        return null;
      }

      // Check user status
      if (session.user.status !== 'ACTIVE') {
        return null;
      }

      // Throttle session activity update (once every 5 minutes to minimize database load)
      const now = Date.now();
      const lastActive = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
      if (now - lastActive > 5 * 60 * 1000) {
        prisma.session
          .update({
            where: { id: session.id },
            data: { lastActiveAt: new Date() },
          })
          .catch(() => {});
      }

      const memberships: OrganizationMembershipSummary[] = session.user.memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        role: m.role as UserRole,
        status: m.organization.status,
      }));

      return {
        sessionId: session.id,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          memberships,
          isEmailVerified: Boolean(session.user.emailVerifiedAt),
          emailVerifiedAt: session.user.emailVerifiedAt ?? null,
        },
        activeOrganizationId: memberships[0]?.organizationId ?? null,
      };
    } catch {
      return null;
    }
  }

  public static async forgotPassword(
    input: ForgotPasswordInput,
    _metadata: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<{ message: string }> {
    const normalizedEmail = input.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Timing-attack and user-enumeration defense: Return identical generic message even if email is not found
    if (!user) {
      await verifyPassword(DUMMY_ARGON2_HASH, 'dummy-enumeration-protection');
      return {
        message:
          'If an account with that email exists, password reset instructions have been sent.',
      };
    }

    if (user.status !== 'ACTIVE') {
      return {
        message:
          'If an account with that email exists, password reset instructions have been sent.',
      };
    }

    // Generate high-entropy 256-bit token (64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiry

    // Invalidate previous unused reset tokens and persist new hashed token in an atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    // Dispatch secure email via Nodemailer
    await EmailService.sendPasswordResetEmail(user.email, user.name, rawToken);

    return {
      message: 'If an account with that email exists, password reset instructions have been sent.',
    };
  }

  public static async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const tokenHash = crypto.createHash('sha256').update(input.token.trim()).digest('hex');

    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt !== null ||
      new Date(tokenRecord.expiresAt) < new Date()
    ) {
      throw new UnauthorizedError('Invalid or expired password reset link');
    }

    // Compute new Argon2id hash
    const newPasswordHash = await hashPassword(input.password);

    // Atomically update password, mark reset token as used, and revoke all active sessions
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash: newPasswordHash },
      });

      await tx.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      });

      // High security defense: Invalidate ALL active sessions across all devices on password reset
      await tx.session.deleteMany({
        where: { userId: tokenRecord.userId },
      });
    });

    return {
      message: 'Password has been reset successfully. Please sign in with your new password.',
    };
  }

  public static async sendEmailVerification(
    userId: string,
    existingUser?: { id: string; email: string; name: string; emailVerifiedAt?: Date | null },
  ): Promise<{ message: string; isAlreadyVerified?: boolean }> {
    const user =
      existingUser ||
      (await prisma.user.findUnique({
        where: { id: userId },
      }));

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.emailVerifiedAt) {
      return { message: 'Email address is already verified.', isAlreadyVerified: true };
    }

    // Generate cryptographic 6-digit numeric OTP
    const rawCode = crypto.randomInt(100000, 999999).toString();
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Invalidate old codes and store new hashed code inside an atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.deleteMany({
        where: { userId },
      });

      await tx.emailVerificationCode.create({
        data: {
          userId,
          codeHash,
          expiresAt,
        },
      });
    });

    // Send email via Nodemailer
    await EmailService.sendEmailVerificationCode(user.email, user.name, rawCode);

    return { message: 'Verification code sent to your email.' };
  }

  public static async verifyEmail(
    userId: string,
    input: VerifyEmailInput,
  ): Promise<{ message: string; emailVerifiedAt: Date; isEmailVerified: boolean }> {
    const codeHash = crypto.createHash('sha256').update(input.code.trim()).digest('hex');

    const codeRecord = await prisma.emailVerificationCode.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!codeRecord) {
      throw new UnauthorizedError('Invalid verification code');
    }

    if (new Date(codeRecord.expiresAt) < new Date()) {
      throw new UnauthorizedError('Verification code has expired. Please request a new one.');
    }

    if (!timingSafeCompare(codeRecord.codeHash, codeHash)) {
      throw new UnauthorizedError('Invalid verification code');
    }

    const verifiedAt = new Date();

    // Atomically mark email verified and purge verification codes
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: verifiedAt },
      });

      await tx.emailVerificationCode.deleteMany({
        where: { userId },
      });
    });

    return {
      message: 'Email address verified successfully.',
      emailVerifiedAt: verifiedAt,
      isEmailVerified: true,
    };
  }

  /**
   * Securely changes password for an authenticated session.
   * Re-authenticates current password, enforces OWASP complexity, prevents password reuse,
   * updates Argon2id hash, invalidates all other active sessions, and dispatches security alert.
   */
  public static async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
  ): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('User not found or credentials not initialized');
    }

    // 1. Verify current password
    const isCurrentValid = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!isCurrentValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // 2. Prevent reusing identical password
    const isSamePassword = await verifyPassword(user.passwordHash, input.newPassword);
    if (isSamePassword) {
      throw new BadRequestError('New password must be different from your current password');
    }

    // 3. Hash new password with Argon2id
    const newPasswordHash = await hashPassword(input.newPassword);

    // 4. Update user password and invalidate all OTHER sessions inside an atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      await tx.session.deleteMany({
        where: {
          userId,
          id: { not: currentSessionId },
        },
      });
    });

    // 5. Dispatch security notification email
    try {
      await EmailService.sendPasswordChangedNotification(user.email, user.name);
    } catch {
      // Non-blocking security notification
    }

    return {
      message:
        'Password updated successfully. Other active sessions have been terminated for security.',
    };
  }

  /**
   * Permanently deletes a user account, their sessions, memberships, and sole-owned workspaces.
   * Requires strict re-authentication and explicit confirmation phrase.
   */
  public static async deleteAccount(
    userId: string,
    input: DeleteAccountInput,
  ): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('User not found or credentials not initialized');
    }

    // 1. Verify password
    const isPasswordValid = await verifyPassword(user.passwordHash, input.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Incorrect password. Account deletion aborted.');
    }

    // 2. Validate confirmation phrase
    const confirmation = input.confirmationText.trim().toUpperCase();
    if (confirmation !== 'DELETE' && confirmation !== 'DELETE MY ACCOUNT') {
      throw new BadRequestError('Confirmation phrase must be DELETE or DELETE MY ACCOUNT');
    }

    // 3. Multi-tenant workspace audit & atomic deletion in transaction
    await prisma.$transaction(async (tx) => {
      for (const membership of user.memberships) {
        if (membership.role === 'OWNER') {
          const totalMembers = await tx.membership.count({
            where: { organizationId: membership.organizationId },
          });

          if (totalMembers <= 1) {
            // Sole member of workspace: cascade delete organization
            await tx.organization.delete({
              where: { id: membership.organizationId },
            });
          } else {
            // Multiple members exist: check if another OWNER exists
            const otherOwners = await tx.membership.count({
              where: {
                organizationId: membership.organizationId,
                role: 'OWNER',
                userId: { not: userId },
              },
            });

            if (otherOwners === 0) {
              throw new ForbiddenError(
                `You are the sole owner of workspace "${membership.organization.name}". Please transfer ownership to another team member before deleting your account.`,
              );
            }
          }
        }
      }

      // Delete user (Foreign key cascading deletes sessions, memberships, and tokens)
      await tx.user.delete({
        where: { id: userId },
      });
    });

    // 4. Send farewell notification email after deletion succeeds
    try {
      await EmailService.sendAccountDeletedNotification(user.email, user.name);
    } catch {
      // Non-blocking notification
    }

    return {
      message: 'Your FlowPilot account and personal data have been permanently deleted.',
    };
  }

  /**
   * Automated cleanup maintenance: Permanently purges expired sessions, expired/used reset tokens,
   * and expired verification codes to maintain database performance and hygiene.
   */
  public static async cleanupExpiredTokens(): Promise<{
    expiredSessions: number;
    expiredResetTokens: number;
    expiredVerificationCodes: number;
  }> {
    const now = new Date();
    const [sessions, resetTokens, verificationCodes] = await prisma.$transaction([
      prisma.session.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      prisma.passwordResetToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
        },
      }),
      prisma.emailVerificationCode.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);

    return {
      expiredSessions: sessions.count,
      expiredResetTokens: resetTokens.count,
      expiredVerificationCodes: verificationCodes.count,
    };
  }
}

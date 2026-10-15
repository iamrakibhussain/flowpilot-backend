import crypto from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from './crypto.js';
import { LoginInput, RegisterInput } from './auth.types.js';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../../common/errors/app-error.js';
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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  );
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

    // 2. Hash password with Argon2id
    const passwordHash = await hashPassword(input.password);

    // 3. Generate initial organization slug with collision avoidance
    let slug = slugify(normalizedOrgName);
    const existingOrg = await prisma.organization.findUnique({
      where: { slug },
    });
    if (existingOrg) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    // 4. Generate high-entropy session token
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
      },
    ];

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
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
    }));

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      activeOrganizationId: memberships[0]?.organizationId ?? null,
      memberships,
      rawToken,
    };
  }

  public static async logout(rawToken?: string): Promise<void> {
    if (!rawToken || typeof rawToken !== 'string') {
      return;
    }

    try {
      const tokenHash = hashSessionToken(rawToken);
      await prisma.session.deleteMany({
        where: { tokenHash },
      });
    } catch {
      // Graceful error handling on invalid token hash or connection drop
    }
  }

  public static async validateSession(rawToken?: string): Promise<ValidatedSession | null> {
    if (!rawToken || typeof rawToken !== 'string') {
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

      const memberships: OrganizationMembershipSummary[] = session.user.memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        role: m.role as UserRole,
      }));

      return {
        sessionId: session.id,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          memberships,
        },
        activeOrganizationId: memberships[0]?.organizationId ?? null,
      };
    } catch {
      return null;
    }
  }
}

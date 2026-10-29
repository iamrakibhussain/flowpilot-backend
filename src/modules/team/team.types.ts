import { Role } from '@prisma/client';

export interface TeamMemberItem {
  id: string; // membership id
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
  staffProfile?: {
    id: string;
    roleTitle: string;
    avatarBg: string;
    initials: string;
    status: string;
    shiftStart: string;
    shiftEnd: string;
  } | null;
}

export interface TeamInvitationItem {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  status: string;
  inviterName: string;
  staffMemberId?: string | null;
  staffMemberName?: string | null;
  expiresAt: string;
  createdAt: string;
  acceptUrl?: string;
}

export interface SendInvitationInput {
  email: string;
  role: Role;
  staffMemberId?: string;
}

export interface VerifyInvitationResult {
  valid: boolean;
  email: string;
  organizationName: string;
  organizationSlug: string;
  inviterName: string;
  role: Role;
  userExists: boolean;
}

export interface AcceptInvitationInput {
  token: string;
  name?: string;
  password?: string;
}

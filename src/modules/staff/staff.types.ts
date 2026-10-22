import { StaffStatus } from '@prisma/client';

export interface StaffItem {
  id: string;
  organizationId: string;
  name: string;
  roleTitle: string;
  email?: string | null;
  initials: string;
  avatarBg: string;
  status: StaffStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffInput {
  name: string;
  roleTitle: string;
  email?: string;
  avatarBg?: string;
  status?: StaffStatus;
}

import { StaffStatus, StaffTier } from '@prisma/client';

export interface StaffServiceItem {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
}

export interface StaffItem {
  id: string;
  organizationId: string;
  userId?: string | null;
  name: string;
  roleTitle: string;
  email: string | null;
  phone: string | null;
  initials: string;
  avatarBg: string;
  status: StaffStatus;
  tier: StaffTier;
  hourlyRate: number | null;
  commissionRate: number | null;
  workingDays: string[];
  shiftStart: string;
  shiftEnd: string;
  bio: string | null;
  services: StaffServiceItem[];
  appointmentCount: number;
  revenueGenerated: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffInput {
  name: string;
  roleTitle: string;
  email?: string;
  phone?: string;
  avatarBg?: string;
  status?: StaffStatus;
  tier?: StaffTier;
  hourlyRate?: number;
  commissionRate?: number;
  workingDays?: string[];
  shiftStart?: string;
  shiftEnd?: string;
  bio?: string;
  serviceIds?: string[];
}

export interface UpdateStaffInput {
  name?: string;
  roleTitle?: string;
  email?: string | null;
  phone?: string | null;
  avatarBg?: string;
  status?: StaffStatus;
  tier?: StaffTier;
  hourlyRate?: number | null;
  commissionRate?: number | null;
  workingDays?: string[];
  shiftStart?: string;
  shiftEnd?: string;
  bio?: string | null;
  serviceIds?: string[];
}

export interface StaffFilterQuery {
  search?: string;
  status?: StaffStatus;
  tier?: StaffTier;
  serviceId?: string;
}

export interface StaffMetrics {
  totalStaff: number;
  availableStaff: number;
  inSessionStaff: number;
  onBreakStaff: number;
  offlineStaff: number;
  totalAppointments: number;
  totalRevenueBilled: number;
  utilizationRate: number;
}

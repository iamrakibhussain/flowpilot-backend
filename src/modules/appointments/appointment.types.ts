import { AppointmentStatus, AppointmentType } from '@prisma/client';

export interface AppointmentListItem {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  servicePrice?: number | null;
  staffMemberId?: string | null;
  staffMemberName?: string | null;
  staffMemberRole?: string | null;
  staffAvatarBg?: string | null;
  staffInitials?: string | null;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  type: AppointmentType;
  location?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAppointmentsQuery {
  startDate?: string;
  endDate?: string;
  customerId?: string;
  staffMemberId?: string;
  serviceId?: string;
  status?: AppointmentStatus;
  type?: AppointmentType;
  search?: string;
}

export interface CreateAppointmentInput {
  customerId: string;
  serviceId?: string;
  staffMemberId?: string;
  title?: string;
  scheduledAt: string | Date;
  durationMinutes?: number;
  type?: AppointmentType;
  location?: string;
  notes?: string;
  status?: AppointmentStatus;
}

export interface UpdateAppointmentInput {
  title?: string;
  scheduledAt?: string | Date;
  durationMinutes?: number;
  type?: AppointmentType;
  location?: string;
  notes?: string;
  serviceId?: string | null;
  staffMemberId?: string | null;
}

export interface RescheduleAppointmentInput {
  newScheduledAt: string | Date;
  newDurationMinutes?: number;
  newStaffMemberId?: string;
  reason?: string;
}

export interface UpdateAppointmentStatusInput {
  status: AppointmentStatus;
  notes?: string;
}

export interface CheckConflictInput {
  staffMemberId: string;
  scheduledAt: string | Date;
  durationMinutes: number;
  excludeAppointmentId?: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingAppointment?: {
    id: string;
    title: string;
    scheduledAt: string;
    durationMinutes: number;
    staffMemberName?: string;
  } | null;
}

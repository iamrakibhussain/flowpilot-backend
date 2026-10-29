export interface ServiceStaffMemberSummary {
  id: string;
  name: string;
  roleTitle: string;
  avatarBg: string;
  initials: string;
}

export interface ServiceItem {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  category: string;
  price: number;
  durationMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  isActive: boolean;
  requireDeposit: boolean;
  depositType: string;
  depositAmount?: number | null;
  staffMembers?: ServiceStaffMemberSummary[];
  staffMemberIds?: string[];
  appointmentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  name: string;
  description?: string | null;
  category?: string;
  price: number;
  durationMinutes?: number;
  bufferBefore?: number;
  bufferAfter?: number;
  isActive?: boolean;
  requireDeposit?: boolean;
  depositType?: string;
  depositAmount?: number | null;
  staffMemberIds?: string[];
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  category?: string;
  price?: number;
  durationMinutes?: number;
  bufferBefore?: number;
  bufferAfter?: number;
  isActive?: boolean;
  requireDeposit?: boolean;
  depositType?: string;
  depositAmount?: number | null;
  staffMemberIds?: string[];
}

export interface ServiceListQuery {
  activeOnly?: boolean;
  category?: string;
  search?: string;
}

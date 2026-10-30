export interface PublicServiceItem {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  price: number;
  durationMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  requireDeposit: boolean;
  depositType: string;
  depositAmount?: number | null;
  assignedStaffIds: string[];
}

export interface PublicStaffItem {
  id: string;
  name: string;
  roleTitle: string;
  avatarBg: string;
  initials: string;
  bio?: string | null;
}

export interface PublicOrganizationProfile {
  id: string;
  name: string;
  slug: string;
  bookingEnabled: boolean;
  bookingTitle?: string | null;
  bookingNotice?: string | null;
  logoUrl?: string | null;
  tagline?: string | null;
  brandColor?: string | null;
  customDomain?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  currency?: string;
  timezone?: string;
  minNoticeHours?: number;
  cancellationHours?: number;
  services: PublicServiceItem[];
  staffMembers: PublicStaffItem[];
}

export interface TimeSlot {
  startTime: string; // e.g. "10:00"
  endTime: string; // e.g. "11:00"
  availableStaffIds: string[];
}

export interface PublicBookingInput {
  serviceId: string;
  staffMemberId?: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (e.g. "10:00")
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  notes?: string | null;
}

export interface PublicBookingResult {
  appointmentId: string;
  serviceName: string;
  staffName?: string | null;
  scheduledAt: string;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  status: string;
  requireDeposit: boolean;
  depositAmount?: number | null;
}

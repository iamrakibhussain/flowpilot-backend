import { CustomerStatus } from '@prisma/client';

export interface CustomerListItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  status: CustomerStatus;
  notes: string | null;
  tags: string[];
  address: string | null;
  totalInvoiced: string;
  totalPaid: string;
  appointmentsCount: number;
  invoicesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListResponse {
  customers: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomerNoteEntry {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface CustomerDetailResponse {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  status: CustomerStatus;
  notes: string | null;
  tags: string[];
  address: string | null;
  parsedNotes: CustomerNoteEntry[];
  totalInvoiced: string;
  totalPaid: string;
  outstandingBalance: string;
  appointmentsCount: number;
  invoicesCount: number;
  createdAt: string;
  updatedAt: string;
  appointments: {
    id: string;
    title: string;
    scheduledAt: string;
    durationMinutes: number;
    status: string;
    type: string;
    location: string | null;
    serviceName: string | null;
    staffMemberName: string | null;
  }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    status: string;
    subtotal: string;
    tax: string;
    total: string;
    paidAt: string | null;
    itemsCount: number;
  }[];
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
  tags?: string[];
  address?: string | null;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string | null;
  company?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
  tags?: string[];
  address?: string | null;
}

export interface ListCustomersQuery {
  search?: string;
  status?: CustomerStatus;
  tag?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'createdAt' | 'email' | 'ltv';
  sortOrder?: 'asc' | 'desc';
}

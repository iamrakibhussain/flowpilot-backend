import { InvoiceStatus } from '@prisma/client';

export interface ListInvoicesQuery {
  status?: InvoiceStatus;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateInvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateInvoiceInput {
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  issueDate?: string;
  dueDate: string;
  status?: InvoiceStatus;
  items: CreateInvoiceItemInput[];
  tax?: number;
  notes?: string;
}

export interface UpdateInvoiceInput {
  dueDate?: string;
  notes?: string;
  items?: CreateInvoiceItemInput[];
  tax?: number;
  status?: InvoiceStatus;
}

export interface RecordPaymentInput {
  paidAt?: string;
  paymentMethod?: string;
  referenceNotes?: string;
}

export interface InvoiceListItem {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  paidAt: string | null;
  notes: string | null;
  itemsCount: number;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  isOverdue: boolean;
  daysOverdue: number;
}

export interface InvoiceStatsResponse {
  totalBilled: number;
  cashCollected: number;
  pendingReceivables: number;
  overdueAmount: number;
  counts: {
    total: number;
    paid: number;
    pending: number;
    overdue: number;
    cancelled: number;
  };
  aging: {
    current: number; // not overdue
    days30: number; // 1-30 days overdue
    days60: number; // 31-60 days overdue
    days90Plus: number; // 61+ days overdue
  };
}

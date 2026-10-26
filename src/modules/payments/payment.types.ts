import { TransactionStatus } from '@prisma/client';

export interface PublicInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface PublicInvoiceResponse {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  paidAt: string | null;
  notes: string | null;
  items: PublicInvoiceItem[];
  customer: {
    name: string;
    email: string;
    company: string | null;
  };
  organization: {
    id: string;
    name: string;
    currency: string;
  };
  paymentSettings: {
    isStripeConnected: boolean;
    publishableKey?: string;
    isTestMode: boolean;
    defaultCurrency: string;
    acceptedMethods: string[];
  };
}

export interface CreateCheckoutSessionInput {
  paymentMethod?: string; // "card", "apple_pay", "bkash", etc.
  returnUrl?: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  checkoutUrl?: string;
  clientSecret?: string;
  mode: 'STRIPE' | 'MOCK';
  amount: number;
  currency: string;
  invoiceNumber: string;
}

export interface UpdatePaymentSettingsInput {
  stripeAccountId?: string;
  stripePublishableKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  isTestMode?: boolean;
  defaultCurrency?: string;
  allowPartialPayments?: boolean;
}

export interface PaymentTransactionItem {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  provider: string;
  gatewayReference: string | null;
  paymentMethod: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface ListTransactionsQuery {
  status?: TransactionStatus;
  invoiceId?: string;
  customerId?: string;
  page?: number;
  limit?: number;
}

import { InvoiceStatus, Prisma, Invoice, Customer, InvoiceItem } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { EmailService } from '../../common/email/email.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { env } from '../../config/env.js';
import {
  ListInvoicesQuery,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  RecordPaymentInput,
  InvoiceListItem,
  InvoiceStatsResponse,
} from './invoice.types.js';

type InvoiceWithRelations = Invoice & {
  customer: Customer;
  items: InvoiceItem[];
};

export class InvoiceService {
  /**
   * Helper to format an Invoice entity with calculated business attributes
   */
  private static formatInvoice(inv: InvoiceWithRelations): InvoiceListItem {
    const now = new Date();
    const dueDate = new Date(inv.dueDate);
    const isOverdue = inv.status === InvoiceStatus.PENDING && dueDate.getTime() < now.getTime();
    const daysOverdue = isOverdue
      ? Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      id: inv.id,
      organizationId: inv.organizationId,
      customerId: inv.customerId,
      customerName: inv.customer.name,
      customerEmail: inv.customer.email,
      customerCompany: inv.customer.company || null,
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      status: isOverdue ? InvoiceStatus.OVERDUE : inv.status,
      subtotal: Number(inv.subtotal),
      tax: Number(inv.tax),
      total: Number(inv.total),
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      notes: inv.notes || null,
      itemsCount: inv.items.length,
      items: inv.items.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
      })),
      isOverdue,
      daysOverdue,
      paymentToken: inv.paymentToken || null,
    };
  }

  /**
   * Auto-generate sequential invoice number per organization: INV-YYYY-XXXX
   */
  public static async generateInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const count = await prisma.invoice.count({
      where: {
        organizationId,
        invoiceNumber: {
          startsWith: prefix,
        },
      },
    });

    let nextSequence = count + 1;
    let candidate = `${prefix}${String(nextSequence).padStart(4, '0')}`;

    // Collision guard
    let exists = await prisma.invoice.findFirst({
      where: { organizationId, invoiceNumber: candidate },
      select: { id: true },
    });

    while (exists) {
      nextSequence += 1;
      candidate = `${prefix}${String(nextSequence).padStart(4, '0')}`;
      exists = await prisma.invoice.findFirst({
        where: { organizationId, invoiceNumber: candidate },
        select: { id: true },
      });
    }

    return candidate;
  }

  /**
   * List multi-tenant invoices with filtering, pagination and search
   */
  public static async listInvoices(
    organizationId: string,
    query: ListInvoicesQuery,
  ): Promise<{ invoices: InvoiceListItem[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {
      organizationId,
    };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.status) {
      if (query.status === InvoiceStatus.OVERDUE) {
        where.OR = [
          { status: InvoiceStatus.OVERDUE },
          {
            status: InvoiceStatus.PENDING,
            dueDate: { lt: new Date() },
          },
        ];
      } else {
        where.status = query.status;
      }
    }

    if (query.startDate || query.endDate) {
      where.issueDate = {};
      if (query.startDate) {
        where.issueDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.issueDate.lte = new Date(query.endDate);
      }
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { customer: { email: { contains: term, mode: 'insensitive' } } },
        { customer: { company: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          customer: true,
          items: true,
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      invoices: invoices.map(this.formatInvoice),
      total,
      page,
      limit,
    };
  }

  /**
   * Aggregated financial stats (Total Billed, Cash Collected, Receivables, Aging)
   */
  public static async getInvoiceStats(organizationId: string): Promise<InvoiceStatsResponse> {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId },
      select: {
        id: true,
        status: true,
        subtotal: true,
        tax: true,
        total: true,
        dueDate: true,
        paidAt: true,
      },
    });

    const now = new Date();
    let totalBilled = 0;
    let cashCollected = 0;
    let pendingReceivables = 0;
    let overdueAmount = 0;

    const counts = {
      total: invoices.length,
      paid: 0,
      pending: 0,
      overdue: 0,
      cancelled: 0,
    };

    const aging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90Plus: 0,
    };

    for (const inv of invoices) {
      const total = Number(inv.total);
      const isPastDue = new Date(inv.dueDate).getTime() < now.getTime();

      if (inv.status === InvoiceStatus.PAID) {
        counts.paid += 1;
        cashCollected += total;
        totalBilled += total;
      } else if (inv.status === InvoiceStatus.CANCELLED) {
        counts.cancelled += 1;
      } else if (
        inv.status === InvoiceStatus.OVERDUE ||
        (inv.status === InvoiceStatus.PENDING && isPastDue)
      ) {
        counts.overdue += 1;
        overdueAmount += total;
        totalBilled += total;
        pendingReceivables += total;

        const days = Math.floor(
          (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24),
        );
        if (days <= 30) {
          aging.days30 += total;
        } else if (days <= 60) {
          aging.days60 += total;
        } else {
          aging.days90Plus += total;
        }
      } else {
        // Active Pending
        counts.pending += 1;
        pendingReceivables += total;
        totalBilled += total;
        aging.current += total;
      }
    }

    return {
      totalBilled: Math.round(totalBilled * 100) / 100,
      cashCollected: Math.round(cashCollected * 100) / 100,
      pendingReceivables: Math.round(pendingReceivables * 100) / 100,
      overdueAmount: Math.round(overdueAmount * 100) / 100,
      counts,
      aging: {
        current: Math.round(aging.current * 100) / 100,
        days30: Math.round(aging.days30 * 100) / 100,
        days60: Math.round(aging.days60 * 100) / 100,
        days90Plus: Math.round(aging.days90Plus * 100) / 100,
      },
    };
  }

  /**
   * Fetch single invoice with customer and item details
   */
  public static async getInvoiceById(organizationId: string, id: string): Promise<InvoiceListItem> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        items: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }

    return this.formatInvoice(invoice);
  }

  /**
   * Create new invoice with atomic line items and multi-tenant customer binding
   */
  public static async createInvoice(
    organizationId: string,
    input: CreateInvoiceInput,
  ): Promise<InvoiceListItem> {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestError('Invoice must contain at least one line item');
    }

    // Resolve Customer
    let customerId = input.customerId;
    if (customerId) {
      const existing = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!existing) {
        throw new NotFoundError('Selected customer does not exist in your organization');
      }
    } else if (input.customerName) {
      // Find or create customer
      let cust = await prisma.customer.findFirst({
        where: { organizationId, name: input.customerName },
      });
      if (!cust) {
        const cleanName = input.customerName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const email =
          input.customerEmail ||
          (cleanName.length > 0
            ? `${cleanName}@client.flowpilot.internal`
            : `client-${Date.now().toString(36)}@flowpilot.internal`);

        cust = await prisma.customer.create({
          data: {
            organizationId,
            name: input.customerName,
            email,
          },
        });
      }
      customerId = cust.id;
    } else {
      throw new BadRequestError('Customer ID or Customer Name is required to issue an invoice');
    }

    // Calculate Financial Line Items
    let subtotal = 0;
    const itemsToCreate = input.items.map((item) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const rate = Math.max(0, Number(item.unitPrice) || 0);
      const amount = Math.round(qty * rate * 100) / 100;
      subtotal += amount;

      return {
        description: item.description.trim() || 'Service / Product item',
        quantity: qty,
        unitPrice: new Prisma.Decimal(rate),
        amount: new Prisma.Decimal(amount),
      };
    });

    const tax = Math.max(0, Number(input.tax) || 0);
    const total = Math.round((subtotal + tax) * 100) / 100;

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const dueDate = new Date(input.dueDate);
    if (isNaN(dueDate.getTime())) {
      throw new BadRequestError('A valid due date is required');
    }

    const invoiceNumber = await this.generateInvoiceNumber(organizationId);

    const initialStatus = input.status || InvoiceStatus.PENDING;
    let paidAt: Date | null = null;
    if (initialStatus === InvoiceStatus.PAID) {
      paidAt = new Date();
    }

    const created = await prisma.invoice.create({
      data: {
        organizationId,
        customerId,
        invoiceNumber,
        issueDate,
        dueDate,
        status: initialStatus,
        subtotal: new Prisma.Decimal(subtotal),
        tax: new Prisma.Decimal(tax),
        total: new Prisma.Decimal(total),
        paidAt,
        notes: input.notes || null,
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        customer: true,
        items: true,
      },
    });

    return this.formatInvoice(created);
  }

  /**
   * Update invoice details and items (only allowed if not paid)
   */
  public static async updateInvoice(
    organizationId: string,
    id: string,
    input: UpdateInvoiceInput,
  ): Promise<InvoiceListItem> {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    if (existing.status === InvoiceStatus.PAID && input.items) {
      throw new BadRequestError(
        'Cannot modify line items on an invoice that has already been marked as PAID',
      );
    }

    const updateData: Prisma.InvoiceUpdateInput = {};

    if (input.dueDate) {
      const d = new Date(input.dueDate);
      if (isNaN(d.getTime())) {
        throw new BadRequestError('Invalid due date provided');
      }
      updateData.dueDate = d;
    }

    if (input.notes !== undefined) {
      updateData.notes = input.notes;
    }

    if (input.status) {
      updateData.status = input.status;
      if (input.status === InvoiceStatus.PAID && !existing.paidAt) {
        updateData.paidAt = new Date();
      } else if (input.status !== InvoiceStatus.PAID) {
        updateData.paidAt = null;
      }
    }

    if (input.items && input.items.length > 0) {
      let subtotal = 0;
      const newItems = input.items.map((item) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const rate = Math.max(0, Number(item.unitPrice) || 0);
        const amount = Math.round(qty * rate * 100) / 100;
        subtotal += amount;

        return {
          description: item.description.trim() || 'Service item',
          quantity: qty,
          unitPrice: new Prisma.Decimal(rate),
          amount: new Prisma.Decimal(amount),
        };
      });

      const tax = input.tax !== undefined ? Math.max(0, Number(input.tax)) : Number(existing.tax);
      const total = Math.round((subtotal + tax) * 100) / 100;

      updateData.subtotal = new Prisma.Decimal(subtotal);
      updateData.tax = new Prisma.Decimal(tax);
      updateData.total = new Prisma.Decimal(total);

      // Replace items in transaction
      return prisma.$transaction(async (tx) => {
        await tx.invoiceItem.deleteMany({
          where: { invoiceId: id },
        });

        await tx.invoiceItem.createMany({
          data: newItems.map((it) => ({
            invoiceId: id,
            ...it,
          })),
        });

        const updated = await tx.invoice.update({
          where: { id },
          data: updateData,
          include: {
            customer: true,
            items: true,
          },
        });

        return this.formatInvoice(updated);
      });
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        items: true,
      },
    });

    return this.formatInvoice(updated);
  }

  /**
   * Transition Invoice Lifecycle Status
   */
  public static async updateStatus(
    organizationId: string,
    id: string,
    status: InvoiceStatus,
  ): Promise<InvoiceListItem> {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    const data: Prisma.InvoiceUpdateInput = { status };
    if (status === InvoiceStatus.PAID) {
      data.paidAt = new Date();
    } else if (status === InvoiceStatus.PENDING) {
      data.paidAt = null;
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data,
      include: {
        customer: true,
        items: true,
      },
    });

    return this.formatInvoice(updated);
  }

  /**
   * Record real payment on an invoice
   */
  public static async recordPayment(
    organizationId: string,
    id: string,
    input: RecordPaymentInput,
  ): Promise<InvoiceListItem> {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const methodStr = input.paymentMethod || 'BANK_TRANSFER';
    const auditNote = `[Payment Recorded on ${paidAt.toLocaleDateString()}: Paid via ${methodStr}${input.referenceNotes ? ` | Ref: ${input.referenceNotes}` : ''}]`;
    const newNotes = existing.notes ? `${existing.notes}\n${auditNote}` : auditNote;

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt,
        notes: newNotes,
      },
      include: {
        customer: true,
        items: true,
      },
    });

    return this.formatInvoice(updated);
  }

  /**
   * Delete or void invoice
   */
  public static async deleteInvoice(organizationId: string, id: string): Promise<void> {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    if (existing.status === InvoiceStatus.PAID) {
      throw new BadRequestError(
        'Cannot delete a settled and paid invoice. You may void/cancel it instead.',
      );
    }

    await prisma.invoice.delete({
      where: { id },
    });
  }

  /**
   * Dispatches branded invoice statement directly to client's email (INV-08)
   */
  public static async sendInvoiceEmail(
    organizationId: string,
    id: string,
  ): Promise<{ success: boolean; deliveredTo: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        items: true,
        organization: true,
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }

    if (!invoice.customer.email) {
      throw new BadRequestError('Customer does not have a registered email address');
    }

    // Ensure payment token exists for 1-click online payment
    let paymentToken = invoice.paymentToken;
    if (!paymentToken) {
      paymentToken = crypto.randomBytes(24).toString('hex');
      const paymentTokenExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paymentToken,
          paymentTokenExpiry,
        },
      });
    }

    const payUrl = `${env.FRONTEND_URL}/pay/${paymentToken}`;

    const sent = await EmailService.sendInvoiceStatementEmail({
      to: invoice.customer.email,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total.toString(),
      currency: invoice.organization.currency || 'USD',
      payUrl,
      organizationName: invoice.organization.name,
      brandColor: invoice.organization.brandColor,
      items: invoice.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        amount: it.amount.toString(),
      })),
    });

    if (!sent) {
      throw new BadRequestError('Failed to dispatch invoice email via mail transport');
    }

    // Create audit notification in-app
    await NotificationService.createNotification({
      organizationId,
      type: 'INVOICE_ISSUED',
      title: `Invoice ${invoice.invoiceNumber} Sent`,
      message: `Invoice ${invoice.invoiceNumber} (${invoice.organization.currency} ${invoice.total}) was delivered to ${invoice.customer.name} (${invoice.customer.email}).`,
      actionUrl: `/dashboard/invoices`,
      metadata: { invoiceId: invoice.id, customerId: invoice.customerId },
    });

    return {
      success: true,
      deliveredTo: invoice.customer.email,
    };
  }
}

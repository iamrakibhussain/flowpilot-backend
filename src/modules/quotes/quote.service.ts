import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { EmailService } from '../../common/email/email.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { InvoiceService } from '../invoices/invoice.service.js';
import { env } from '../../config/env.js';
import {
  ListQuotesQuery,
  CreateQuoteInput,
  UpdateQuoteInput,
  QuoteListItem,
  QuoteDetailResponse,
  QuoteStatsResponse,
  AcceptQuoteInput,
  DeclineQuoteInput,
  QuoteStatus,
} from './quote.types.js';

interface RawQuoteItem {
  id: string;
  quoteId: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number;
  amount: Prisma.Decimal | number;
  sortOrder: number;
  service?: { id: string; name: string } | null;
}

interface RawQuoteToken {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface RawQuoteWithRelations {
  id: string;
  organizationId: string;
  customerId: string;
  createdById: string | null;
  quoteNumber: string;
  title: string;
  status: QuoteStatus;
  subtotal: Prisma.Decimal | number;
  taxRate: Prisma.Decimal | number;
  taxAmount: Prisma.Decimal | number;
  discountType: string;
  discountAmount: Prisma.Decimal | number;
  totalAmount: Prisma.Decimal | number;
  issuedAt: Date;
  expiresAt: Date | null;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  signerName: string | null;
  signerEmail: string | null;
  signerIp: string | null;
  signatureData: string | null;
  clientNotes: string | null;
  introduction: string | null;
  terms: string | null;
  notes: string | null;
  convertedInvoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    brandColor: string | null;
    logoUrl?: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    currency: string;
  };
  convertedInvoice?: {
    id: string;
    invoiceNumber: string;
  } | null;
  items: RawQuoteItem[];
  publicTokens?: RawQuoteToken[];
}

// Type-safe model accessor to ensure compatibility across compile & runtime
const prismaQuotes = prisma as unknown as {
  quote: {
    findMany: (args: unknown) => Promise<RawQuoteWithRelations[]>;
    findFirst: (args: unknown) => Promise<RawQuoteWithRelations | null>;
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<RawQuoteWithRelations>;
    update: (args: unknown) => Promise<RawQuoteWithRelations>;
    delete: (args: unknown) => Promise<unknown>;
  };
  quoteItem: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
  quoteToken: {
    findUnique: (
      args: unknown,
    ) => Promise<(RawQuoteToken & { quote: RawQuoteWithRelations }) | null>;
    findFirst: (
      args: unknown,
    ) => Promise<(RawQuoteToken & { quote: RawQuoteWithRelations }) | null>;
    create: (args: unknown) => Promise<RawQuoteToken>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export class QuoteService {
  /**
   * Format quote database record into clean API presentation DTO
   */
  private static formatQuote(
    q: RawQuoteWithRelations,
    publicToken?: string | null,
  ): QuoteDetailResponse {
    const now = new Date();
    const isExpired =
      q.status !== 'ACCEPTED' &&
      q.status !== 'DECLINED' &&
      Boolean(q.expiresAt && new Date(q.expiresAt).getTime() < now.getTime());

    const status: QuoteStatus = isExpired ? 'EXPIRED' : q.status;

    return {
      id: q.id,
      organizationId: q.organizationId,
      customerId: q.customerId,
      customerName: q.customer.name,
      customerEmail: q.customer.email,
      customerCompany: q.customer.company || null,
      customerPhone: q.customer.phone || null,
      quoteNumber: q.quoteNumber,
      title: q.title,
      status,
      subtotal: Number(q.subtotal),
      taxRate: Number(q.taxRate),
      taxAmount: Number(q.taxAmount),
      discountType: q.discountType,
      discountAmount: Number(q.discountAmount),
      totalAmount: Number(q.totalAmount),
      issuedAt: q.issuedAt.toISOString(),
      expiresAt: q.expiresAt ? q.expiresAt.toISOString() : null,
      viewedAt: q.viewedAt ? q.viewedAt.toISOString() : null,
      acceptedAt: q.acceptedAt ? q.acceptedAt.toISOString() : null,
      declinedAt: q.declinedAt ? q.declinedAt.toISOString() : null,
      signerName: q.signerName || null,
      signerEmail: q.signerEmail || null,
      signerIp: q.signerIp || null,
      signatureData: q.signatureData || null,
      clientNotes: q.clientNotes || null,
      introduction: q.introduction || null,
      terms: q.terms || null,
      notes: q.notes || null,
      convertedInvoiceId: q.convertedInvoiceId || null,
      convertedInvoiceNumber: q.convertedInvoice?.invoiceNumber || null,
      itemsCount: q.items?.length || 0,
      items: (q.items || []).map((it) => ({
        id: it.id,
        serviceId: it.serviceId || null,
        serviceName: it.service?.name || null,
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        sortOrder: it.sortOrder,
      })),
      organization: {
        id: q.organization.id,
        name: q.organization.name,
        slug: q.organization.slug,
        brandColor: q.organization.brandColor || '#2563eb',
        logoUrl: q.organization.logoUrl || null,
        contactEmail: q.organization.contactEmail || null,
        contactPhone: q.organization.contactPhone || null,
        address: q.organization.address || null,
        currency: q.organization.currency || 'USD',
      },
      publicToken: publicToken || null,
      isExpired,
    };
  }

  /**
   * Generates sequential proposal number per organization: EST-YYYY-XXXX
   */
  public static async generateQuoteNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `EST-${year}-`;

    const count = await prismaQuotes.quote.count({
      where: {
        organizationId,
        quoteNumber: { startsWith: prefix },
      },
    });

    let nextSequence = count + 1;
    let candidate = `${prefix}${String(nextSequence).padStart(4, '0')}`;

    let exists = await prismaQuotes.quote.findFirst({
      where: { organizationId, quoteNumber: candidate },
    });

    while (exists) {
      nextSequence += 1;
      candidate = `${prefix}${String(nextSequence).padStart(4, '0')}`;
      exists = await prismaQuotes.quote.findFirst({
        where: { organizationId, quoteNumber: candidate },
      });
    }

    return candidate;
  }

  /**
   * List quotes with pagination and status filtering
   */
  public static async listQuotes(
    organizationId: string,
    query: ListQuotesQuery,
  ): Promise<{ quotes: QuoteListItem[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { organizationId };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.status) {
      if (query.status === 'EXPIRED') {
        where.expiresAt = { lt: new Date() };
        where.status = { notIn: ['ACCEPTED', 'DECLINED'] };
      } else {
        where.status = query.status;
      }
    }

    if (query.startDate || query.endDate) {
      const issuedFilter: Record<string, unknown> = {};
      if (query.startDate) issuedFilter.gte = new Date(query.startDate);
      if (query.endDate) issuedFilter.lte = new Date(query.endDate);
      where.issuedAt = issuedFilter;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { quoteNumber: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { customer: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [quotes, total] = await Promise.all([
      prismaQuotes.quote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          organization: true,
          convertedInvoice: { select: { id: true, invoiceNumber: true } },
          items: {
            orderBy: { sortOrder: 'asc' },
            include: { service: { select: { id: true, name: true } } },
          },
        },
      }),
      prismaQuotes.quote.count({ where }),
    ]);

    return {
      quotes: quotes.map((q) => this.formatQuote(q)),
      total,
      page,
      limit,
    };
  }

  /**
   * Get single quote by ID with complete details
   */
  public static async getQuoteById(
    organizationId: string,
    id: string,
  ): Promise<QuoteDetailResponse> {
    const quote = await prismaQuotes.quote.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        organization: true,
        convertedInvoice: { select: { id: true, invoiceNumber: true } },
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { service: { select: { id: true, name: true } } },
        },
      },
    });

    if (!quote) {
      throw new NotFoundError('Proposal / Estimate not found');
    }

    return this.formatQuote(quote);
  }

  /**
   * Aggregated quote metrics for dashboard KPI cards
   */
  public static async getQuoteStats(organizationId: string): Promise<QuoteStatsResponse> {
    const quotes = await prismaQuotes.quote.findMany({
      where: { organizationId },
      include: {
        customer: true,
        organization: true,
        items: true,
      },
    });

    const now = new Date();
    let totalEstimatedValue = 0;
    let acceptedValue = 0;
    let pendingReviewValue = 0;

    const counts = {
      total: quotes.length,
      draft: 0,
      sent: 0,
      viewed: 0,
      accepted: 0,
      declined: 0,
      expired: 0,
    };

    for (const q of quotes) {
      const total = Number(q.totalAmount);
      const isExpired =
        q.status !== 'ACCEPTED' &&
        q.status !== 'DECLINED' &&
        Boolean(q.expiresAt && new Date(q.expiresAt).getTime() < now.getTime());

      if (isExpired) {
        counts.expired += 1;
      } else if (q.status === 'ACCEPTED') {
        counts.accepted += 1;
        acceptedValue += total;
        totalEstimatedValue += total;
      } else if (q.status === 'SENT' || q.status === 'VIEWED') {
        if (q.status === 'SENT') counts.sent += 1;
        if (q.status === 'VIEWED') counts.viewed += 1;
        pendingReviewValue += total;
        totalEstimatedValue += total;
      } else if (q.status === 'DECLINED') {
        counts.declined += 1;
      } else {
        counts.draft += 1;
        totalEstimatedValue += total;
      }
    }

    const nonDraftCount =
      counts.sent + counts.viewed + counts.accepted + counts.declined + counts.expired;
    const acceptanceRate =
      nonDraftCount > 0 ? Math.round((counts.accepted / nonDraftCount) * 100 * 10) / 10 : 0;

    return {
      totalEstimatedValue: Math.round(totalEstimatedValue * 100) / 100,
      acceptedValue: Math.round(acceptedValue * 100) / 100,
      pendingReviewValue: Math.round(pendingReviewValue * 100) / 100,
      acceptanceRate,
      counts,
    };
  }

  /**
   * Create a new Estimate / Proposal
   */
  public static async createQuote(
    organizationId: string,
    userId: string,
    input: CreateQuoteInput,
  ): Promise<QuoteDetailResponse> {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestError('Proposal must contain at least one line item');
    }

    // Resolve or Auto-Provision Customer
    let customerId = input.customerId;
    if (customerId) {
      const existing = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!existing) {
        throw new NotFoundError('Selected customer does not exist in your workspace');
      }
    } else if (input.customerName) {
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
            phone: input.customerPhone || null,
            company: input.customerCompany || null,
          },
        });
      }
      customerId = cust.id;
    } else {
      throw new BadRequestError('Customer ID or Customer Name is required to build a proposal');
    }

    // Calculate line items, subtotal, tax, and discount
    let subtotal = 0;
    const itemsToCreate = input.items.map((it, idx) => {
      const qty = Math.max(1, Number(it.quantity) || 1);
      const rate = Math.max(0, Number(it.unitPrice) || 0);
      const amount = Math.round(qty * rate * 100) / 100;
      subtotal += amount;

      return {
        serviceId: it.serviceId || null,
        description: it.description.trim() || 'Service Item',
        quantity: qty,
        unitPrice: new Prisma.Decimal(rate),
        amount: new Prisma.Decimal(amount),
        sortOrder: it.sortOrder ?? idx,
      };
    });

    const taxRate = Math.max(0, Math.min(100, Number(input.taxRate) || 0));
    const discountType = input.discountType || 'FIXED';
    let discountAmount = Math.max(0, Number(input.discountAmount) || 0);

    if (discountType === 'PERCENT') {
      discountAmount = Math.round(((subtotal * discountAmount) / 100) * 100) / 100;
    }
    discountAmount = Math.min(subtotal, discountAmount);

    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const taxAmount = Math.round(((taxableAmount * taxRate) / 100) * 100) / 100;
    const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

    const quoteNumber = await this.generateQuoteNumber(organizationId);

    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days default validity

    const created = await prismaQuotes.quote.create({
      data: {
        organizationId,
        customerId,
        createdById: userId,
        quoteNumber,
        title: input.title?.trim() || 'Service Proposal & Estimate',
        status: input.status || 'DRAFT',
        subtotal: new Prisma.Decimal(subtotal),
        taxRate: new Prisma.Decimal(taxRate),
        taxAmount: new Prisma.Decimal(taxAmount),
        discountType,
        discountAmount: new Prisma.Decimal(discountAmount),
        totalAmount: new Prisma.Decimal(totalAmount),
        expiresAt,
        introduction: input.introduction?.trim() || null,
        terms: input.terms?.trim() || null,
        notes: input.notes?.trim() || null,
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        customer: true,
        organization: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { service: { select: { id: true, name: true } } },
        },
      },
    });

    return this.formatQuote(created);
  }

  /**
   * Update an existing Quote (only permitted if not ACCEPTED)
   */
  public static async updateQuote(
    organizationId: string,
    id: string,
    input: UpdateQuoteInput,
  ): Promise<QuoteDetailResponse> {
    const existing = await prismaQuotes.quote.findFirst({
      where: { id, organizationId },
      include: { customer: true, organization: true, items: true },
    });

    if (!existing) {
      throw new NotFoundError('Proposal not found');
    }

    if (existing.status === 'ACCEPTED' && input.items) {
      throw new BadRequestError(
        'Cannot modify items of a proposal that has already been digitally accepted',
      );
    }

    const updateData: Record<string, unknown> = {};

    if (input.title) updateData.title = input.title.trim();
    if (input.introduction !== undefined)
      updateData.introduction = input.introduction?.trim() || null;
    if (input.terms !== undefined) updateData.terms = input.terms?.trim() || null;
    if (input.notes !== undefined) updateData.notes = input.notes?.trim() || null;
    if (input.status) updateData.status = input.status;
    if (input.customerId) updateData.customerId = input.customerId;
    if (input.expiresAt !== undefined) {
      updateData.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }

    if (input.items && input.items.length > 0) {
      let subtotal = 0;
      const newItems = input.items.map((it, idx) => {
        const qty = Math.max(1, Number(it.quantity) || 1);
        const rate = Math.max(0, Number(it.unitPrice) || 0);
        const amount = Math.round(qty * rate * 100) / 100;
        subtotal += amount;

        return {
          serviceId: it.serviceId || null,
          description: it.description.trim() || 'Service Item',
          quantity: qty,
          unitPrice: new Prisma.Decimal(rate),
          amount: new Prisma.Decimal(amount),
          sortOrder: it.sortOrder ?? idx,
        };
      });

      const taxRate =
        input.taxRate !== undefined ? Number(input.taxRate) : Number(existing.taxRate);
      const discountType = input.discountType || existing.discountType;
      let discountAmount =
        input.discountAmount !== undefined
          ? Number(input.discountAmount)
          : Number(existing.discountAmount);

      if (discountType === 'PERCENT') {
        discountAmount = Math.round(((subtotal * discountAmount) / 100) * 100) / 100;
      }
      discountAmount = Math.min(subtotal, discountAmount);

      const taxableAmount = Math.max(0, subtotal - discountAmount);
      const taxAmount = Math.round(((taxableAmount * taxRate) / 100) * 100) / 100;
      const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

      updateData.subtotal = new Prisma.Decimal(subtotal);
      updateData.taxRate = new Prisma.Decimal(taxRate);
      updateData.taxAmount = new Prisma.Decimal(taxAmount);
      updateData.discountType = discountType;
      updateData.discountAmount = new Prisma.Decimal(discountAmount);
      updateData.totalAmount = new Prisma.Decimal(totalAmount);

      // Replace items
      await prismaQuotes.quoteItem.deleteMany({ where: { quoteId: id } });
      updateData.items = { create: newItems };
    }

    const updated = await prismaQuotes.quote.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        organization: true,
        convertedInvoice: { select: { id: true, invoiceNumber: true } },
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { service: { select: { id: true, name: true } } },
        },
      },
    });

    return this.formatQuote(updated);
  }

  /**
   * Delete draft proposal
   */
  public static async deleteQuote(organizationId: string, id: string): Promise<void> {
    const existing = await prismaQuotes.quote.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Proposal not found');
    }

    if (existing.status === 'ACCEPTED') {
      throw new BadRequestError(
        'Cannot delete a digitally accepted proposal with legal audit history',
      );
    }

    await prismaQuotes.quote.delete({ where: { id } });
  }

  /**
   * Issue & Send Proposal to Customer with high-entropy cryptographic token
   */
  public static async sendQuote(
    organizationId: string,
    id: string,
  ): Promise<{ success: boolean; publicUrl: string; deliveredTo: string }> {
    const quote = await prismaQuotes.quote.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        organization: true,
        items: true,
      },
    });

    if (!quote) {
      throw new NotFoundError('Proposal not found');
    }

    // Generate cryptographic 256-bit token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpiry = quote.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await prismaQuotes.quoteToken.create({
      data: {
        quoteId: quote.id,
        tokenHash,
        expiresAt: tokenExpiry,
      },
    });

    // Update status to SENT if currently DRAFT
    if (quote.status === 'DRAFT') {
      await prismaQuotes.quote.update({
        where: { id: quote.id },
        data: { status: 'SENT' },
      });
    }

    const publicUrl = `${env.FRONTEND_URL}/quote/${rawToken}`;

    // Dispatches notification email
    if (quote.customer.email) {
      try {
        await EmailService.sendMail({
          to: quote.customer.email,
          subject: `Estimate & Proposal ${quote.quoteNumber} from ${quote.organization.name}`,
          text: `Hello ${quote.customer.name}, We have prepared a formal estimate for your review: "${quote.title}" (${quote.organization.currency} ${Number(quote.totalAmount).toFixed(2)}). Review and sign online: ${publicUrl}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px;">
              <div style="margin-bottom: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px;">
                <h1 style="color: #0f172a; font-size: 22px; margin: 0 0 8px 0;">${quote.organization.name}</h1>
                <p style="color: #64748b; font-size: 14px; margin: 0;">Service Proposal: <strong>${quote.quoteNumber}</strong></p>
              </div>
              <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hello <strong>${quote.customer.name}</strong>,</p>
              <p style="color: #334155; font-size: 15px; line-height: 1.6;">
                We have prepared a formal estimate for your review: <strong>"${quote.title}"</strong>.
              </p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 24px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="color: #64748b; font-size: 14px;">Total Estimated Investment:</span>
                  <strong style="color: #0f172a; font-size: 18px;">${quote.organization.currency} ${Number(quote.totalAmount).toFixed(2)}</strong>
                </div>
                <div style="color: #64748b; font-size: 13px;">
                  Valid until: ${new Date(tokenExpiry).toLocaleDateString()}
                </div>
              </div>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${publicUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block;">
                  Review & Digitally Sign Proposal
                </a>
              </div>
              <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 32px;">
                You can review deliverables, request modifications, or accept online with a single click.
              </p>
            </div>
          `,
        });
      } catch {
        // Continue even if SMTP transport is mock/disabled
      }
    }

    // In-app workspace notification
    await NotificationService.createNotification({
      organizationId,
      type: 'QUOTE_SENT',
      title: `Proposal ${quote.quoteNumber} Dispatched`,
      message: `Estimate ${quote.quoteNumber} (${quote.organization.currency} ${Number(quote.totalAmount).toFixed(2)}) sent to ${quote.customer.name}.`,
      actionUrl: `/dashboard/quotes`,
      metadata: { quoteId: quote.id, customerId: quote.customerId },
    });

    return {
      success: true,
      publicUrl,
      deliveredTo: quote.customer.email,
    };
  }

  /**
   * 1-Click Convert an Accepted Proposal into a formal Invoice
   */
  public static async convertToInvoice(
    organizationId: string,
    _userId: string,
    quoteId: string,
  ): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const quote = await prismaQuotes.quote.findFirst({
      where: { id: quoteId, organizationId },
      include: {
        customer: true,
        organization: true,
        items: true,
        convertedInvoice: true,
      },
    });

    if (!quote) {
      throw new NotFoundError('Proposal not found');
    }

    // If already converted, return existing invoice
    if (quote.convertedInvoiceId && quote.convertedInvoice) {
      return {
        invoiceId: quote.convertedInvoice.id,
        invoiceNumber: quote.convertedInvoice.invoiceNumber,
      };
    }

    // Convert items into invoice item inputs
    const invoiceItems = quote.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
    }));

    const dueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(); // Net 15 default

    const invoice = await InvoiceService.createInvoice(organizationId, {
      customerId: quote.customerId,
      issueDate: new Date().toISOString(),
      dueDate,
      items: invoiceItems,
      tax: Number(quote.taxAmount),
      notes: `Converted from Proposal #${quote.quoteNumber}. ${quote.terms || ''}`.trim(),
    });

    // Link converted invoice back to quote
    await prismaQuotes.quote.update({
      where: { id: quote.id },
      data: {
        convertedInvoiceId: invoice.id,
        status: 'ACCEPTED',
        acceptedAt: quote.acceptedAt || new Date(),
      },
    });

    // Workspace notification
    await NotificationService.createNotification({
      organizationId,
      type: 'INVOICE_ISSUED',
      title: `Invoice ${invoice.invoiceNumber} Generated from ${quote.quoteNumber}`,
      message: `Proposal ${quote.quoteNumber} was converted into Invoice ${invoice.invoiceNumber} (${quote.organization.currency} ${invoice.total}).`,
      actionUrl: `/dashboard/invoices`,
      metadata: { quoteId: quote.id, invoiceId: invoice.id, customerId: quote.customerId },
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  /**
   * PUBLIC API: Retrieve proposal by cryptographic token
   */
  public static async getPublicQuote(token: string): Promise<QuoteDetailResponse> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRecord = await prismaQuotes.quoteToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: {
        quote: {
          include: {
            customer: true,
            organization: true,
            convertedInvoice: { select: { id: true, invoiceNumber: true } },
            items: {
              orderBy: { sortOrder: 'asc' },
              include: { service: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    if (!tokenRecord || !tokenRecord.quote) {
      throw new NotFoundError('Proposal link is invalid or has been revoked');
    }

    const quote = tokenRecord.quote;
    const now = new Date();

    // Check expiry
    if (new Date(tokenRecord.expiresAt).getTime() < now.getTime()) {
      if (quote.status !== 'ACCEPTED' && quote.status !== 'DECLINED') {
        await prismaQuotes.quote.update({
          where: { id: quote.id },
          data: { status: 'EXPIRED' },
        });
      }
    }

    // First-time viewing audit tracker
    if (quote.status === 'SENT' && !quote.viewedAt) {
      await prismaQuotes.quote.update({
        where: { id: quote.id },
        data: {
          status: 'VIEWED',
          viewedAt: now,
        },
      });
      quote.status = 'VIEWED';
      quote.viewedAt = now;
    }

    return this.formatQuote(quote, token);
  }

  /**
   * PUBLIC API: Client digitally accepts proposal with electronic signature
   */
  public static async acceptPublicQuote(
    token: string,
    input: AcceptQuoteInput,
    ipAddress?: string,
  ): Promise<{
    success: boolean;
    quoteNumber: string;
    acceptedAt: string;
    autoInvoiceId?: string;
  }> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRecord = await prismaQuotes.quoteToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: {
        quote: {
          include: {
            customer: true,
            organization: true,
            items: true,
          },
        },
      },
    });

    if (!tokenRecord || !tokenRecord.quote) {
      throw new NotFoundError('Proposal link is invalid or has expired');
    }

    const quote = tokenRecord.quote;
    const now = new Date();

    // Security & Compliance: Verify expiry
    const isExpired =
      new Date(tokenRecord.expiresAt).getTime() < now.getTime() ||
      Boolean(quote.expiresAt && new Date(quote.expiresAt).getTime() < now.getTime()) ||
      quote.status === 'EXPIRED';

    if (isExpired && quote.status !== 'ACCEPTED') {
      await prismaQuotes.quote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestError(
        'This proposal has expired and can no longer be accepted. Please contact the sender for an updated estimate.',
      );
    }

    if (quote.status === 'DECLINED') {
      throw new BadRequestError(
        'This proposal was previously declined. Please contact the sender for a revised proposal.',
      );
    }

    if (quote.status === 'ACCEPTED') {
      return {
        success: true,
        quoteNumber: quote.quoteNumber,
        acceptedAt: quote.acceptedAt?.toISOString() || new Date().toISOString(),
        autoInvoiceId: quote.convertedInvoiceId || undefined,
      };
    }

    const acceptedAt = new Date();

    // Save digital signature and acceptance audit data
    await prismaQuotes.quote.update({
      where: { id: quote.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt,
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail?.trim() || quote.customer.email,
        signerIp: ipAddress || null,
        signatureData: input.signatureData,
        clientNotes: input.clientNotes?.trim() || null,
      },
    });

    // Automatically provision Invoice from accepted quote!
    let autoInvoiceId: string | undefined;
    try {
      const conv = await this.convertToInvoice(quote.organizationId, 'system', quote.id);
      autoInvoiceId = conv.invoiceId;
    } catch {
      // Continue even if automatic invoice creation is deferred
    }

    // In-app alert for business owner
    await NotificationService.createNotification({
      organizationId: quote.organizationId,
      type: 'QUOTE_ACCEPTED',
      title: `🎉 Proposal ${quote.quoteNumber} Digitally Accepted!`,
      message: `${input.signerName} accepted proposal "${quote.title}" (${quote.organization.currency} ${Number(quote.totalAmount).toFixed(2)}).`,
      actionUrl: `/dashboard/quotes`,
      metadata: { quoteId: quote.id, customerId: quote.customerId, autoInvoiceId },
    });

    return {
      success: true,
      quoteNumber: quote.quoteNumber,
      acceptedAt: acceptedAt.toISOString(),
      autoInvoiceId,
    };
  }

  /**
   * PUBLIC API: Client declines proposal with feedback
   */
  public static async declinePublicQuote(
    token: string,
    input: DeclineQuoteInput,
  ): Promise<{ success: boolean; quoteNumber: string }> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenRecord = await prismaQuotes.quoteToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: {
        quote: {
          include: { customer: true, organization: true },
        },
      },
    });

    if (!tokenRecord || !tokenRecord.quote) {
      throw new NotFoundError('Proposal link is invalid or has expired');
    }

    const quote = tokenRecord.quote;

    if (quote.status === 'ACCEPTED') {
      throw new BadRequestError(
        'This proposal has already been digitally accepted and cannot be declined.',
      );
    }

    const declinedAt = new Date();

    await prismaQuotes.quote.update({
      where: { id: quote.id },
      data: {
        status: 'DECLINED',
        declinedAt,
        clientNotes: input.reason?.trim() || null,
      },
    });

    // Alert business
    await NotificationService.createNotification({
      organizationId: quote.organizationId,
      type: 'QUOTE_DECLINED',
      title: `Proposal ${quote.quoteNumber} Declined`,
      message: `${quote.customer.name} declined proposal "${quote.title}" (${quote.organization.currency} ${Number(quote.totalAmount).toFixed(2)}). Reason: ${input.reason || 'None provided'}.`,
      actionUrl: `/dashboard/quotes`,
      metadata: { quoteId: quote.id, customerId: quote.customerId },
    });

    return {
      success: true,
      quoteNumber: quote.quoteNumber,
    };
  }
}

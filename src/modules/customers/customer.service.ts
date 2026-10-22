import { CustomerStatus, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { BadRequestError, NotFoundError } from '../../common/errors/app-error.js';
import {
  CustomerListItem,
  CustomerListResponse,
  CustomerDetailResponse,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersQuery,
  CustomerNoteEntry,
} from './customer.types.js';

export class CustomerService {
  /**
   * Helper to parse structured internal data safely (notes, tags, address)
   */
  private static parseStructuredData(rawNotes: string | null): {
    notes: CustomerNoteEntry[];
    tags: string[];
    address: string | null;
  } {
    if (!rawNotes || !rawNotes.trim()) {
      return { notes: [], tags: [], address: null };
    }
    try {
      const parsed = JSON.parse(rawNotes);
      if (Array.isArray(parsed)) {
        return { notes: parsed, tags: [], address: null };
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return {
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          address: typeof parsed.address === 'string' ? parsed.address : null,
        };
      }
    } catch {
      return {
        notes: [
          {
            id: 'legacy-1',
            authorName: 'Staff Note',
            content: rawNotes,
            createdAt: new Date().toISOString(),
          },
        ],
        tags: [],
        address: null,
      };
    }
    return { notes: [], tags: [], address: null };
  }

  /**
   * Helper to serialize structured internal data (notes, tags, address)
   */
  private static serializeStructuredData(
    notes: CustomerNoteEntry[],
    tags: string[] = [],
    address: string | null = null,
  ): string {
    return JSON.stringify({
      notes,
      tags,
      address,
    });
  }

  /**
   * List customers with search, status filtering, and pagination
   * Strictly isolated to the authenticated user's organizationId
   */
  public static async listCustomers(
    organizationId: string,
    query: ListCustomersQuery,
  ): Promise<CustomerListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const isLtvSort = query.sortBy === 'ltv';
    const prismaSortBy = isLtvSort ? 'createdAt' : (query.sortBy ?? 'createdAt');
    const prismaSortOrder = query.sortOrder ?? 'desc';

    const [total, records] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip: isLtvSort ? 0 : skip,
        take: isLtvSort ? 200 : limit,
        orderBy: { [prismaSortBy]: prismaSortOrder },
        include: {
          _count: {
            select: {
              appointments: true,
              invoices: true,
            },
          },
          invoices: {
            select: {
              total: true,
              status: true,
            },
          },
        },
      }),
    ]);

    let customers: CustomerListItem[] = records.map((c) => {
      let invoicedSum = 0;
      let paidSum = 0;
      for (const inv of c.invoices) {
        const val = Number(inv.total);
        invoicedSum += val;
        if (inv.status === 'PAID') {
          paidSum += val;
        }
      }

      const structured = this.parseStructuredData(c.notes);

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        status: c.status,
        notes: c.notes,
        tags: structured.tags,
        address: structured.address,
        totalInvoiced: `$${invoicedSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        totalPaid: `$${paidSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        appointmentsCount: c._count.appointments,
        invoicesCount: c._count.invoices,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });

    if (query.tag && query.tag.trim()) {
      const tagQuery = query.tag.trim().toLowerCase();
      customers = customers.filter((c) => c.tags.some((t) => t.toLowerCase() === tagQuery));
    }

    if (isLtvSort) {
      customers.sort((a, b) => {
        const valA = Number(a.totalPaid.replace(/[^0-9.-]+/g, '')) || 0;
        const valB = Number(b.totalPaid.replace(/[^0-9.-]+/g, '')) || 0;
        return query.sortOrder === 'asc' ? valA - valB : valB - valA;
      });
      customers = customers.slice(skip, skip + limit);
    }

    return {
      customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get 360-degree customer profile with full appointment & invoice history
   */
  public static async getCustomerById(
    organizationId: string,
    customerId: string,
  ): Promise<CustomerDetailResponse> {
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId,
      },
      include: {
        appointments: {
          orderBy: { scheduledAt: 'desc' },
          include: {
            service: true,
            staffMember: true,
          },
        },
        invoices: {
          orderBy: { issueDate: 'desc' },
          include: {
            _count: {
              select: { items: true },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found in this organization');
    }

    let invoicedSum = 0;
    let paidSum = 0;

    for (const inv of customer.invoices) {
      const val = Number(inv.total);
      invoicedSum += val;
      if (inv.status === 'PAID') {
        paidSum += val;
      }
    }

    const outstanding = Math.max(0, invoicedSum - paidSum);
    const structured = this.parseStructuredData(customer.notes);

    return {
      id: customer.id,
      organizationId: customer.organizationId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      status: customer.status,
      notes: customer.notes,
      tags: structured.tags,
      address: structured.address,
      parsedNotes: structured.notes,
      totalInvoiced: `$${invoicedSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      totalPaid: `$${paidSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      outstandingBalance: `$${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      appointmentsCount: customer.appointments.length,
      invoicesCount: customer.invoices.length,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      appointments: customer.appointments.map((apt) => ({
        id: apt.id,
        title: apt.title,
        scheduledAt: apt.scheduledAt.toISOString(),
        durationMinutes: apt.durationMinutes,
        status: apt.status,
        type: apt.type,
        location: apt.location,
        serviceName: apt.service?.name ?? null,
        staffMemberName: apt.staffMember?.name ?? null,
      })),
      invoices: customer.invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate.toISOString(),
        dueDate: inv.dueDate.toISOString(),
        status: inv.status,
        subtotal: `$${Number(inv.subtotal).toFixed(2)}`,
        tax: `$${Number(inv.tax).toFixed(2)}`,
        total: `$${Number(inv.total).toFixed(2)}`,
        paidAt: inv.paidAt?.toISOString() ?? null,
        itemsCount: inv._count.items,
      })),
    };
  }

  /**
   * Create a new customer profile scoped to organization
   */
  public static async createCustomer(
    organizationId: string,
    input: CreateCustomerInput,
  ): Promise<CustomerListItem> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    if (!name || !email) {
      throw new BadRequestError('Customer name and email are required');
    }

    // Check duplicate email within the same organization
    const existing = await prisma.customer.findFirst({
      where: {
        organizationId,
        email,
      },
    });

    if (existing) {
      throw new BadRequestError('A customer with this email already exists in your organization');
    }

    const initialNotesList: CustomerNoteEntry[] = [];
    if (input.notes && input.notes.trim()) {
      initialNotesList.push({
        id: `note-${Date.now()}`,
        authorName: 'Primary Contact Note',
        content: input.notes.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    const structuredNotes = this.serializeStructuredData(
      initialNotesList,
      input.tags ?? [],
      input.address?.trim() ?? null,
    );

    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name,
        email,
        phone: input.phone?.trim() ?? null,
        company: input.company?.trim() ?? null,
        status: input.status ?? CustomerStatus.ACTIVE,
        notes: structuredNotes,
      },
    });

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      status: customer.status,
      notes: customer.notes,
      tags: input.tags ?? [],
      address: input.address?.trim() ?? null,
      totalInvoiced: '$0.00',
      totalPaid: '$0.00',
      appointmentsCount: 0,
      invoicesCount: 0,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  /**
   * Update an existing customer record
   */
  public static async updateCustomer(
    organizationId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerListItem> {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Customer not found in this organization');
    }

    const data: Prisma.CustomerUpdateInput = {};

    if (input.name !== undefined) data.name = input.name.trim();
    if (input.phone !== undefined) data.phone = input.phone ? input.phone.trim() : null;
    if (input.company !== undefined) data.company = input.company ? input.company.trim() : null;
    if (input.status !== undefined) data.status = input.status;

    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (email !== existing.email) {
        const duplicate = await prisma.customer.findFirst({
          where: { organizationId, email, id: { not: customerId } },
        });
        if (duplicate) {
          throw new BadRequestError(
            'Another customer with this email already exists in this organization',
          );
        }
        data.email = email;
      }
    }

    const existingStructured = this.parseStructuredData(existing.notes);
    const updatedTags = input.tags !== undefined ? input.tags : existingStructured.tags;
    const updatedAddress =
      input.address !== undefined
        ? input.address
          ? input.address.trim()
          : null
        : existingStructured.address;

    if (input.tags !== undefined || input.address !== undefined) {
      data.notes = this.serializeStructuredData(
        existingStructured.notes,
        updatedTags,
        updatedAddress,
      );
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data,
      include: {
        _count: {
          select: {
            appointments: true,
            invoices: true,
          },
        },
        invoices: {
          select: {
            total: true,
            status: true,
          },
        },
      },
    });

    let invoicedSum = 0;
    let paidSum = 0;
    for (const inv of updated.invoices) {
      const val = Number(inv.total);
      invoicedSum += val;
      if (inv.status === 'PAID') {
        paidSum += val;
      }
    }

    const finalStructured = this.parseStructuredData(updated.notes);

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      company: updated.company,
      status: updated.status,
      notes: updated.notes,
      tags: finalStructured.tags,
      address: finalStructured.address,
      totalInvoiced: `$${invoicedSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      totalPaid: `$${paidSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      appointmentsCount: updated._count.appointments,
      invoicesCount: updated._count.invoices,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Append an internal operational note to the customer profile
   */
  public static async addNote(
    organizationId: string,
    customerId: string,
    content: string,
    authorName = 'Team Specialist',
  ): Promise<CustomerNoteEntry[]> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new BadRequestError('Note content cannot be empty');
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found in this organization');
    }

    const structured = this.parseStructuredData(customer.notes);
    const newEntry: CustomerNoteEntry = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorName,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    const updatedNotes = [newEntry, ...structured.notes];

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        notes: this.serializeStructuredData(updatedNotes, structured.tags, structured.address),
      },
    });

    return updatedNotes;
  }

  /**
   * Soft-delete / Archive customer
   */
  public static async archiveCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<{ message: string; customerId: string }> {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Customer not found in this organization');
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: { status: CustomerStatus.INACTIVE },
    });

    return {
      message: 'Customer archived successfully',
      customerId,
    };
  }

  /**
   * Reactivate an archived customer
   */
  public static async reactivateCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<{ message: string; customerId: string }> {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Customer not found in this organization');
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: { status: CustomerStatus.ACTIVE },
    });

    return {
      message: 'Customer reactivated successfully',
      customerId,
    };
  }
}

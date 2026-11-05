import crypto from 'node:crypto';
import {
  Prisma,
  RecurringFrequency,
  RecurringStatus,
  InvoiceStatus,
  NotificationType,
  Customer,
  RecurringSchedule,
  RetainerHourLog,
  Invoice,
} from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import { InvoiceService } from '../invoices/invoice.service.js';
import {
  CreateRecurringScheduleInput,
  UpdateRecurringScheduleInput,
  LogRetainerHoursInput,
  ListRecurringSchedulesQuery,
  RecurringScheduleListItem,
  RecurringScheduleDetails,
  RecurringItem,
  RecurringStatsResponse,
} from './recurring.types.js';

type ScheduleWithRelations = RecurringSchedule & {
  customer?: Customer | null;
  retainerLogs?: RetainerHourLog[];
  generatedInvoices?: Partial<Invoice>[];
  _count?: { generatedInvoices: number };
};

export class RecurringService {
  /**
   * Calculate the next execution date based on frequency
   */
  public static calculateNextRunDate(fromDate: Date, frequency: RecurringFrequency): Date {
    const next = new Date(fromDate);

    switch (frequency) {
      case RecurringFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;

      case RecurringFrequency.BI_WEEKLY:
        next.setDate(next.getDate() + 14);
        break;

      case RecurringFrequency.MONTHLY: {
        const targetDay = next.getDate();
        next.setMonth(next.getMonth() + 1);
        // Handle month-end rollover (e.g., Jan 31 -> Feb 28)
        if (next.getDate() !== targetDay) {
          next.setDate(0);
        }
        break;
      }

      case RecurringFrequency.QUARTERLY: {
        const targetDay = next.getDate();
        next.setMonth(next.getMonth() + 3);
        if (next.getDate() !== targetDay) {
          next.setDate(0);
        }
        break;
      }

      case RecurringFrequency.ANNUALLY:
        next.setFullYear(next.getFullYear() + 1);
        break;

      default:
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }

  /**
   * Format Prisma entity into standardized client response
   */
  private static formatSchedule(schedule: ScheduleWithRelations): RecurringScheduleListItem {
    const items = (schedule.itemsJson as RecurringItem[]) || [];
    const latestRetainer =
      schedule.retainerLogs && schedule.retainerLogs.length > 0 ? schedule.retainerLogs[0] : null;

    let currentRetainerLog = null;
    if (latestRetainer) {
      const allocated = Number(latestRetainer.hoursAllocated);
      const logged = Number(latestRetainer.hoursLogged);
      const overage = Number(latestRetainer.overageHours);
      currentRetainerLog = {
        cycleStartDate: latestRetainer.cycleStartDate.toISOString(),
        cycleEndDate: latestRetainer.cycleEndDate.toISOString(),
        hoursAllocated: allocated,
        hoursLogged: logged,
        overageHours: overage,
        hoursRemaining: Math.max(0, Math.round((allocated - logged) * 100) / 100),
      };
    }

    return {
      id: schedule.id,
      organizationId: schedule.organizationId,
      customerId: schedule.customerId,
      customerName: schedule.customer?.name || 'Unknown',
      customerEmail: schedule.customer?.email || '',
      customerCompany: schedule.customer?.company || null,
      title: schedule.title,
      frequency: schedule.frequency,
      status: schedule.status,
      currency: schedule.currency,
      subtotal: Number(schedule.subtotal),
      taxRate: Number(schedule.taxRate),
      taxAmount: Number(schedule.taxAmount),
      total: Number(schedule.total),
      items,
      isRetainer: schedule.isRetainer,
      retainerHours: schedule.retainerHours ? Number(schedule.retainerHours) : null,
      overageHourlyRate: schedule.overageHourlyRate ? Number(schedule.overageHourlyRate) : null,
      startDate: schedule.startDate.toISOString(),
      endDate: schedule.endDate ? schedule.endDate.toISOString() : null,
      nextRunDate: schedule.nextRunDate.toISOString(),
      lastRunDate: schedule.lastRunDate ? schedule.lastRunDate.toISOString() : null,
      totalOccurrences: schedule.totalOccurrences,
      maxOccurrences: schedule.maxOccurrences,
      autoSendEmail: schedule.autoSendEmail,
      paymentDueDays: schedule.paymentDueDays,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
      invoicesCount: schedule._count?.generatedInvoices ?? schedule.generatedInvoices?.length ?? 0,
      currentRetainerLog,
    };
  }

  /**
   * Create a new recurring schedule with atomic validation and optional retainer setup
   */
  public static async createSchedule(
    organizationId: string,
    input: CreateRecurringScheduleInput,
  ): Promise<RecurringScheduleListItem> {
    // 1. Validate customer existence in the organization
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundError('Selected customer does not exist in your organization');
    }

    // 2. Validate and calculate financial items
    let subtotal = 0;
    const processedItems: RecurringItem[] = input.items.map((item) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
      const amount = Math.round(quantity * unitPrice * 100) / 100;
      subtotal += amount;

      return {
        description: item.description.trim(),
        quantity,
        unitPrice,
        amount,
      };
    });

    subtotal = Math.round(subtotal * 100) / 100;
    const taxRate = Math.max(0, Number(input.taxRate) || 0);
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const startDate = new Date(input.startDate);
    if (isNaN(startDate.getTime())) {
      throw new BadRequestError('Invalid start date provided');
    }

    const endDate = input.endDate ? new Date(input.endDate) : null;
    if (endDate && (isNaN(endDate.getTime()) || endDate.getTime() < startDate.getTime())) {
      throw new BadRequestError('End date must be a valid date after the start date');
    }

    const nextRunDate = new Date(startDate);

    // 3. Atomically create schedule & optional initial retainer cycle in transaction
    const schedule = await prisma.$transaction(async (tx) => {
      const created = await tx.recurringSchedule.create({
        data: {
          organizationId,
          customerId: input.customerId,
          title: input.title.trim(),
          frequency: input.frequency,
          status: RecurringStatus.ACTIVE,
          currency: input.currency.toUpperCase(),
          subtotal: new Prisma.Decimal(subtotal),
          taxRate: new Prisma.Decimal(taxRate),
          taxAmount: new Prisma.Decimal(taxAmount),
          total: new Prisma.Decimal(total),
          itemsJson: processedItems,
          isRetainer: Boolean(input.isRetainer),
          retainerHours:
            input.isRetainer && input.retainerHours != null
              ? new Prisma.Decimal(input.retainerHours)
              : null,
          overageHourlyRate:
            input.isRetainer && input.overageHourlyRate != null
              ? new Prisma.Decimal(input.overageHourlyRate)
              : null,
          startDate,
          endDate,
          nextRunDate,
          maxOccurrences: input.maxOccurrences ?? null,
          autoSendEmail: input.autoSendEmail,
          paymentDueDays: input.paymentDueDays,
        },
        include: {
          customer: true,
          retainerLogs: {
            orderBy: { cycleStartDate: 'desc' },
            take: 1,
          },
        },
      });

      // If retainer is configured, initialize the current cycle's retainer hours ledger
      if (created.isRetainer && created.retainerHours) {
        const cycleEndDate = RecurringService.calculateNextRunDate(startDate, created.frequency);
        await tx.retainerHourLog.create({
          data: {
            organizationId,
            scheduleId: created.id,
            cycleStartDate: startDate,
            cycleEndDate,
            hoursAllocated: created.retainerHours,
            hoursLogged: new Prisma.Decimal(0),
            overageHours: new Prisma.Decimal(0),
          },
        });
      }

      return created;
    });

    // Fetch fresh with relations
    return this.getScheduleById(organizationId, schedule.id);
  }

  /**
   * List recurring schedules with multi-tenant filtering, pagination & search
   */
  public static async listSchedules(
    organizationId: string,
    query: ListRecurringSchedulesQuery,
  ): Promise<{
    schedules: RecurringScheduleListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.RecurringScheduleWhereInput = {
      organizationId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.frequency) {
      where.frequency = query.frequency;
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, records] = await Promise.all([
      prisma.recurringSchedule.count({ where }),
      prisma.recurringSchedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status: 'asc' }, { nextRunDate: 'asc' }],
        include: {
          customer: true,
          retainerLogs: {
            orderBy: { cycleStartDate: 'desc' },
            take: 1,
          },
          _count: {
            select: { generatedInvoices: true },
          },
        },
      }),
    ]);

    return {
      schedules: records.map((r) => this.formatSchedule(r)),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch single recurring schedule with customer, latest invoices, and retainer logs
   */
  public static async getScheduleById(
    organizationId: string,
    id: string,
  ): Promise<RecurringScheduleDetails> {
    const schedule = await prisma.recurringSchedule.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        retainerLogs: {
          orderBy: { cycleStartDate: 'desc' },
        },
        generatedInvoices: {
          orderBy: { issueDate: 'desc' },
          take: 15,
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            dueDate: true,
            status: true,
            total: true,
            paidAt: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundError('Recurring schedule not found');
    }

    const formatted = this.formatSchedule(schedule);

    return {
      ...formatted,
      invoices: schedule.generatedInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        issueDate: inv.issueDate.toISOString(),
        dueDate: inv.dueDate.toISOString(),
        status: inv.status,
        total: Number(inv.total),
        paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      })),
      allRetainerLogs: schedule.retainerLogs.map((log) => ({
        id: log.id,
        cycleStartDate: log.cycleStartDate.toISOString(),
        cycleEndDate: log.cycleEndDate.toISOString(),
        hoursAllocated: Number(log.hoursAllocated),
        hoursLogged: Number(log.hoursLogged),
        overageHours: Number(log.overageHours),
        notes: log.notes,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Update an existing recurring schedule
   */
  public static async updateSchedule(
    organizationId: string,
    id: string,
    input: UpdateRecurringScheduleInput,
  ): Promise<RecurringScheduleListItem> {
    const existing = await prisma.recurringSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Recurring schedule not found');
    }

    const data: Prisma.RecurringScheduleUpdateInput = {};

    if (input.title !== undefined) data.title = input.title.trim();
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.currency !== undefined) data.currency = input.currency.toUpperCase();
    if (input.autoSendEmail !== undefined) data.autoSendEmail = input.autoSendEmail;
    if (input.paymentDueDays !== undefined) data.paymentDueDays = input.paymentDueDays;
    if (input.maxOccurrences !== undefined) data.maxOccurrences = input.maxOccurrences;
    if (input.status !== undefined) data.status = input.status;

    if (input.isRetainer !== undefined) {
      data.isRetainer = input.isRetainer;
      if (input.retainerHours !== undefined) {
        data.retainerHours =
          input.retainerHours != null ? new Prisma.Decimal(input.retainerHours) : null;
      }
      if (input.overageHourlyRate !== undefined) {
        data.overageHourlyRate =
          input.overageHourlyRate != null ? new Prisma.Decimal(input.overageHourlyRate) : null;
      }
    }

    if (input.startDate) {
      const sDate = new Date(input.startDate);
      if (!isNaN(sDate.getTime())) {
        data.startDate = sDate;
      }
    }

    if (input.endDate !== undefined) {
      data.endDate = input.endDate ? new Date(input.endDate) : null;
    }

    // Recompute financials if items or taxRate are updated
    if (input.items || input.taxRate !== undefined) {
      const itemsToProcess = input.items || ((existing.itemsJson as RecurringItem[]) ?? []);
      let subtotal = 0;
      const processedItems: RecurringItem[] = itemsToProcess.map((item) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const rate = Math.max(0, Number(item.unitPrice) || 0);
        const amount = Math.round(qty * rate * 100) / 100;
        subtotal += amount;
        return {
          description: item.description.trim(),
          quantity: qty,
          unitPrice: rate,
          amount,
        };
      });

      subtotal = Math.round(subtotal * 100) / 100;
      const taxRate =
        input.taxRate !== undefined ? Math.max(0, Number(input.taxRate)) : Number(existing.taxRate);
      const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;

      data.itemsJson = processedItems;
      data.subtotal = new Prisma.Decimal(subtotal);
      data.taxRate = new Prisma.Decimal(taxRate);
      data.taxAmount = new Prisma.Decimal(taxAmount);
      data.total = new Prisma.Decimal(total);
    }

    await prisma.recurringSchedule.update({
      where: { id },
      data,
    });

    return this.getScheduleById(organizationId, id);
  }

  /**
   * Pause recurring schedule
   */
  public static async pauseSchedule(
    organizationId: string,
    id: string,
  ): Promise<RecurringScheduleListItem> {
    const existing = await prisma.recurringSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Recurring schedule not found');
    }

    await prisma.recurringSchedule.update({
      where: { id },
      data: { status: RecurringStatus.PAUSED },
    });

    return this.getScheduleById(organizationId, id);
  }

  /**
   * Resume recurring schedule
   */
  public static async resumeSchedule(
    organizationId: string,
    id: string,
  ): Promise<RecurringScheduleListItem> {
    const existing = await prisma.recurringSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Recurring schedule not found');
    }

    const now = new Date();
    const updateData: Prisma.RecurringScheduleUpdateInput = {
      status: RecurringStatus.ACTIVE,
    };

    // If nextRunDate has lapsed while paused, reset nextRunDate to now so it will process in the next run
    if (existing.nextRunDate.getTime() < now.getTime()) {
      updateData.nextRunDate = now;
    }

    await prisma.recurringSchedule.update({
      where: { id },
      data: updateData,
    });

    return this.getScheduleById(organizationId, id);
  }

  /**
   * Cancel recurring schedule
   */
  public static async cancelSchedule(
    organizationId: string,
    id: string,
  ): Promise<RecurringScheduleListItem> {
    const existing = await prisma.recurringSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Recurring schedule not found');
    }

    await prisma.recurringSchedule.update({
      where: { id },
      data: { status: RecurringStatus.CANCELLED },
    });

    return this.getScheduleById(organizationId, id);
  }

  /**
   * Log retainer hours worked against the current billing cycle
   */
  public static async logRetainerHours(
    organizationId: string,
    scheduleId: string,
    input: LogRetainerHoursInput,
  ): Promise<{
    logId: string;
    hoursAllocated: number;
    hoursLogged: number;
    overageHours: number;
    hoursRemaining: number;
  }> {
    const schedule = await prisma.recurringSchedule.findFirst({
      where: { id: scheduleId, organizationId },
    });
    if (!schedule) {
      throw new NotFoundError('Recurring schedule not found');
    }
    if (!schedule.isRetainer || !schedule.retainerHours) {
      throw new BadRequestError(
        'This recurring schedule is not configured as an active hourly retainer',
      );
    }

    const logDate = input.date ? new Date(input.date) : new Date();

    // Find the retainer log for this cycle
    let activeLog = await prisma.retainerHourLog.findFirst({
      where: {
        scheduleId,
        organizationId,
        cycleStartDate: { lte: logDate },
        cycleEndDate: { gt: logDate },
      },
    });

    // If no matching cycle, grab the most recent one or create one
    if (!activeLog) {
      activeLog = await prisma.retainerHourLog.findFirst({
        where: { scheduleId, organizationId },
        orderBy: { cycleStartDate: 'desc' },
      });
    }

    if (!activeLog) {
      // Create new cycle log
      const cycleStart = schedule.startDate;
      const cycleEnd = this.calculateNextRunDate(cycleStart, schedule.frequency);
      activeLog = await prisma.retainerHourLog.create({
        data: {
          organizationId,
          scheduleId,
          cycleStartDate: cycleStart,
          cycleEndDate: cycleEnd,
          hoursAllocated: schedule.retainerHours,
          hoursLogged: new Prisma.Decimal(0),
          overageHours: new Prisma.Decimal(0),
        },
      });
    }

    const currentLogged = Number(activeLog.hoursLogged);
    const allocated = Number(activeLog.hoursAllocated);
    const newLogged = Math.round((currentLogged + input.hours) * 100) / 100;
    const overage = Math.max(0, Math.round((newLogged - allocated) * 100) / 100);

    const updated = await prisma.retainerHourLog.update({
      where: { id: activeLog.id },
      data: {
        hoursLogged: new Prisma.Decimal(newLogged),
        overageHours: new Prisma.Decimal(overage),
        notes: input.notes
          ? `${activeLog.notes ? activeLog.notes + '\n' : ''}[${logDate.toISOString().slice(0, 10)}] +${input.hours}h: ${input.notes}`
          : activeLog.notes,
      },
    });

    return {
      logId: updated.id,
      hoursAllocated: allocated,
      hoursLogged: newLogged,
      overageHours: overage,
      hoursRemaining: Math.max(0, Math.round((allocated - newLogged) * 100) / 100),
    };
  }

  /**
   * Aggregate high-level recurring metrics for dashboard widgets
   */
  public static async getStats(organizationId: string): Promise<RecurringStatsResponse> {
    const schedules = await prisma.recurringSchedule.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { generatedInvoices: true },
        },
      },
    });

    let activeSchedules = 0;
    let pausedSchedules = 0;
    let completedSchedules = 0;
    let activeRetainers = 0;
    let estimatedMRR = 0;
    let totalGeneratedInvoices = 0;

    for (const s of schedules) {
      totalGeneratedInvoices += s._count.generatedInvoices;

      if (s.status === RecurringStatus.ACTIVE) {
        activeSchedules += 1;
        if (s.isRetainer) activeRetainers += 1;

        const total = Number(s.total);
        switch (s.frequency) {
          case RecurringFrequency.WEEKLY:
            estimatedMRR += total * 4.33;
            break;
          case RecurringFrequency.BI_WEEKLY:
            estimatedMRR += total * 2.16;
            break;
          case RecurringFrequency.MONTHLY:
            estimatedMRR += total;
            break;
          case RecurringFrequency.QUARTERLY:
            estimatedMRR += total / 3;
            break;
          case RecurringFrequency.ANNUALLY:
            estimatedMRR += total / 12;
            break;
        }
      } else if (s.status === RecurringStatus.PAUSED) {
        pausedSchedules += 1;
      } else if (s.status === RecurringStatus.COMPLETED) {
        completedSchedules += 1;
      }
    }

    return {
      totalSchedules: schedules.length,
      activeSchedules,
      pausedSchedules,
      completedSchedules,
      activeRetainers,
      estimatedMRR: Math.round(estimatedMRR * 100) / 100,
      totalGeneratedInvoices,
    };
  }

  /**
   * Autonomous Billing Processor:
   * Uses PostgreSQL Advisory Lock (ID: 5432001) for strict single-execution concurrency safety.
   * Dispatches invoices for all due schedules across all organizations and rolls cycles forward.
   */
  public static async processDueSchedules(): Promise<{
    processedCount: number;
    invoicesCreated: number;
    completedSchedules: number;
    skipped?: boolean;
  }> {
    // 1. Try to acquire PostgreSQL advisory lock
    const lockResult = await prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(5432001) AS locked;
    `;

    const isLocked = lockResult[0]?.locked ?? false;
    if (!isLocked) {
      logger.info(
        'Recurring schedule processor: advisory lock already held by another instance. Skipping.',
      );
      return { processedCount: 0, invoicesCreated: 0, completedSchedules: 0, skipped: true };
    }

    let processedCount = 0;
    let invoicesCreated = 0;
    let completedSchedules = 0;

    try {
      const now = new Date();

      // 2. Fetch all ACTIVE schedules where nextRunDate <= now
      const dueSchedules = await prisma.recurringSchedule.findMany({
        where: {
          status: RecurringStatus.ACTIVE,
          nextRunDate: { lte: now },
        },
        include: {
          customer: true,
          organization: true,
        },
      });

      logger.info(
        { count: dueSchedules.length },
        'Recurring billing processor: evaluating due recurring schedules',
      );

      for (const schedule of dueSchedules) {
        processedCount += 1;

        // Check if schedule is already past endDate
        if (schedule.endDate && schedule.endDate.getTime() < now.getTime()) {
          await prisma.recurringSchedule.update({
            where: { id: schedule.id },
            data: { status: RecurringStatus.COMPLETED },
          });
          completedSchedules += 1;
          continue;
        }

        // Check if max occurrences already reached
        if (
          schedule.maxOccurrences != null &&
          schedule.totalOccurrences >= schedule.maxOccurrences
        ) {
          await prisma.recurringSchedule.update({
            where: { id: schedule.id },
            data: { status: RecurringStatus.COMPLETED },
          });
          completedSchedules += 1;
          continue;
        }

        // Generate next invoice atomically
        try {
          await prisma.$transaction(async (tx) => {
            const invoiceNumber = await InvoiceService.generateInvoiceNumber(
              schedule.organizationId,
            );
            const dueDate = new Date(now.getTime() + schedule.paymentDueDays * 24 * 60 * 60 * 1000);
            const paymentToken = crypto.randomBytes(32).toString('hex');
            const paymentTokenExpiry = new Date(dueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

            const items = (schedule.itemsJson as RecurringItem[]) || [];

            // 1. Create Invoice
            const invoice = await tx.invoice.create({
              data: {
                organizationId: schedule.organizationId,
                customerId: schedule.customerId,
                recurringScheduleId: schedule.id,
                invoiceNumber,
                issueDate: now,
                dueDate,
                status: InvoiceStatus.PENDING,
                subtotal: schedule.subtotal,
                tax: schedule.taxAmount,
                total: schedule.total,
                paymentToken,
                paymentTokenExpiry,
                notes: `Automated recurring billing for: ${schedule.title}`,
                items: {
                  create: items.map((it) => ({
                    description: it.description,
                    quantity: it.quantity,
                    unitPrice: new Prisma.Decimal(it.unitPrice),
                    amount: new Prisma.Decimal(it.amount ?? it.quantity * it.unitPrice),
                  })),
                },
              },
            });

            invoicesCreated += 1;

            // 2. Advance schedule nextRunDate
            const nextRunDate = RecurringService.calculateNextRunDate(
              schedule.nextRunDate,
              schedule.frequency,
            );
            const newTotalOccurrences = schedule.totalOccurrences + 1;

            let newStatus: RecurringStatus = RecurringStatus.ACTIVE;
            if (schedule.maxOccurrences != null && newTotalOccurrences >= schedule.maxOccurrences) {
              newStatus = RecurringStatus.COMPLETED;
              completedSchedules += 1;
            } else if (schedule.endDate && nextRunDate.getTime() > schedule.endDate.getTime()) {
              newStatus = RecurringStatus.COMPLETED;
              completedSchedules += 1;
            }

            await tx.recurringSchedule.update({
              where: { id: schedule.id },
              data: {
                lastRunDate: now,
                nextRunDate,
                totalOccurrences: newTotalOccurrences,
                status: newStatus,
              },
            });

            // 3. If Retainer, create next cycle's retainer hours ledger
            if (schedule.isRetainer && schedule.retainerHours) {
              const cycleEnd = RecurringService.calculateNextRunDate(
                nextRunDate,
                schedule.frequency,
              );
              await tx.retainerHourLog.create({
                data: {
                  organizationId: schedule.organizationId,
                  scheduleId: schedule.id,
                  cycleStartDate: nextRunDate,
                  cycleEndDate: cycleEnd,
                  hoursAllocated: schedule.retainerHours,
                  hoursLogged: new Prisma.Decimal(0),
                  overageHours: new Prisma.Decimal(0),
                },
              });
            }

            // 4. Create internal workspace notification
            await tx.notification.create({
              data: {
                organizationId: schedule.organizationId,
                userId: null,
                type: NotificationType.INVOICE_ISSUED,
                title: `Recurring Invoice ${invoiceNumber} Generated`,
                message: `Automated recurring schedule "${schedule.title}" generated invoice ${invoiceNumber} for ${schedule.customer.name} (${schedule.currency} ${schedule.total}).`,
                actionUrl: `/invoices/${invoice.id}`,
                metadata: {
                  invoiceId: invoice.id,
                  invoiceNumber,
                  scheduleId: schedule.id,
                  customerId: schedule.customerId,
                },
              },
            });
          });
        } catch (scheduleErr) {
          logger.error(
            { err: scheduleErr, scheduleId: schedule.id },
            'Failed to execute single recurring schedule transaction',
          );
        }
      }
    } finally {
      // 3. Always release advisory lock
      await prisma.$queryRaw`SELECT pg_advisory_unlock(5432001);`;
    }

    return {
      processedCount,
      invoicesCreated,
      completedSchedules,
    };
  }
}

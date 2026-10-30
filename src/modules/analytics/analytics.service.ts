import { prisma } from '../../database/prisma.js';
import {
  TimeframeFilter,
  AnalyticsOverviewDto,
  CashflowPointDto,
  ServiceProfitabilityDto,
  StaffProductivityDto,
  CustomerIntelligenceDto,
} from './analytics.types.js';

export class AnalyticsService {
  private static resolveDates(timeframe?: string): {
    startDate: Date;
    endDate: Date;
    prevStartDate: Date;
    prevEndDate: Date;
    filter: TimeframeFilter;
  } {
    const filter = (timeframe || '30d').toLowerCase() as TimeframeFilter;
    const now = new Date();
    const endDate = now;

    let startDate: Date;
    let prevStartDate: Date;
    let prevEndDate: Date;

    if (filter === '7d') {
      startDate = new Date(now.getTime() - 7 * 86400000);
      prevStartDate = new Date(now.getTime() - 14 * 86400000);
      prevEndDate = startDate;
    } else if (filter === '90d') {
      startDate = new Date(now.getTime() - 90 * 86400000);
      prevStartDate = new Date(now.getTime() - 180 * 86400000);
      prevEndDate = startDate;
    } else if (filter === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1);
      const daysIntoYear = Math.floor((now.getTime() - startDate.getTime()) / 86400000);
      prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
      prevEndDate = new Date(prevStartDate.getTime() + daysIntoYear * 86400000);
    } else if (filter === '12m') {
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      prevStartDate = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      prevEndDate = startDate;
    } else if (filter === 'all') {
      startDate = new Date(0);
      prevStartDate = new Date(0);
      prevEndDate = new Date(0);
    } else {
      // Default: 30d
      startDate = new Date(now.getTime() - 30 * 86400000);
      prevStartDate = new Date(now.getTime() - 60 * 86400000);
      prevEndDate = startDate;
    }

    return { startDate, endDate, prevStartDate, prevEndDate, filter };
  }

  private static calcPercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    const diff = ((current - previous) / previous) * 100;
    return Math.round(diff * 10) / 10;
  }

  public static async getOverview(
    organizationId: string,
    timeframe?: string,
  ): Promise<AnalyticsOverviewDto> {
    const { startDate, endDate, prevStartDate, prevEndDate, filter } = this.resolveDates(timeframe);

    // Current period invoices
    const currentPaidInvoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'PAID',
        paidAt: { gte: startDate, lte: endDate },
      },
      select: { total: true, netAmount: true },
    });

    const currentPendingInvoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      select: { total: true },
    });

    // Current period deposits from appointments
    const currentDeposits = await prisma.appointment.findMany({
      where: {
        organizationId,
        depositPaid: true,
        depositAmount: { not: null },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { depositAmount: true },
    });

    // Current period appointments
    const currentAppointments = await prisma.appointment.findMany({
      where: {
        organizationId,
        scheduledAt: { gte: startDate, lte: endDate },
      },
      select: { status: true, durationMinutes: true },
    });

    // Active staff members count
    const staffCount = await prisma.staffMember.count({
      where: { organizationId },
    });

    // --- Current Metrics Calculation ---
    const grossRevenue = currentPaidInvoices.reduce((acc, inv) => acc + Number(inv.total), 0);
    const depositsTotal = currentDeposits.reduce(
      (acc, appt) => acc + Number(appt.depositAmount || 0),
      0,
    );
    const netCashInflow =
      currentPaidInvoices.reduce((acc, inv) => acc + Number(inv.netAmount || inv.total), 0) +
      depositsTotal;

    const paidCount = currentPaidInvoices.length;
    const atv = paidCount > 0 ? Math.round((grossRevenue / paidCount) * 100) / 100 : 0;

    const outstandingAr = currentPendingInvoices.reduce((acc, inv) => acc + Number(inv.total), 0);

    const totalAppointments = currentAppointments.length;
    const completedAppointments = currentAppointments.filter(
      (a) => a.status === 'COMPLETED',
    ).length;
    const cancelledAppointments = currentAppointments.filter(
      (a) => a.status === 'CANCELLED',
    ).length;

    const appointmentFulfillmentRate =
      totalAppointments > 0 ? Math.round((completedAppointments / totalAppointments) * 100) : 100;

    // Capacity utilization: total duration minutes booked / (staffCount * 40h/wk * weeks * 60m)
    const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
    const totalBookedMinutes = currentAppointments
      .filter((a) => a.status !== 'CANCELLED')
      .reduce((acc, a) => acc + (a.durationMinutes || 60), 0);
    const totalAvailableMinutes = Math.max(1, staffCount) * 8 * 60 * (days * (5 / 7));
    const utilizationRate = Math.min(
      100,
      Math.round((totalBookedMinutes / totalAvailableMinutes) * 100),
    );

    // --- Previous Period Metrics Calculation ---
    let grossRevenueChange = 0;
    let netCashChange = 0;
    let atvChange = 0;
    let outstandingArChange = 0;
    let appointmentsChange = 0;

    if (filter !== 'all') {
      const prevPaidInvoices = await prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'PAID',
          paidAt: { gte: prevStartDate, lte: prevEndDate },
        },
        select: { total: true, netAmount: true },
      });

      const prevPendingInvoices = await prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'PENDING',
          issueDate: { gte: prevStartDate, lte: prevEndDate },
        },
        select: { total: true },
      });

      const prevAppointments = await prisma.appointment.findMany({
        where: {
          organizationId,
          scheduledAt: { gte: prevStartDate, lte: prevEndDate },
        },
        select: { id: true },
      });

      const prevGrossRevenue = prevPaidInvoices.reduce((acc, inv) => acc + Number(inv.total), 0);
      const prevNetCash = prevPaidInvoices.reduce(
        (acc, inv) => acc + Number(inv.netAmount || inv.total),
        0,
      );
      const prevAtv = prevPaidInvoices.length > 0 ? prevGrossRevenue / prevPaidInvoices.length : 0;
      const prevOutstandingAr = prevPendingInvoices.reduce(
        (acc, inv) => acc + Number(inv.total),
        0,
      );

      grossRevenueChange = this.calcPercentageChange(grossRevenue, prevGrossRevenue);
      netCashChange = this.calcPercentageChange(netCashInflow, prevNetCash);
      atvChange = this.calcPercentageChange(atv, prevAtv);
      outstandingArChange = this.calcPercentageChange(outstandingAr, prevOutstandingAr);
      appointmentsChange = this.calcPercentageChange(totalAppointments, prevAppointments.length);
    }

    return {
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      netCashInflow: Math.round(netCashInflow * 100) / 100,
      atv,
      outstandingAr: Math.round(outstandingAr * 100) / 100,
      appointmentFulfillmentRate,
      utilizationRate,
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      trends: {
        grossRevenueChange,
        netCashChange,
        atvChange,
        outstandingArChange,
        appointmentsChange,
      },
      timeframe: filter,
    };
  }

  public static async getCashflow(
    organizationId: string,
    timeframe?: string,
  ): Promise<CashflowPointDto[]> {
    const { startDate, endDate } = this.resolveDates(timeframe);

    const [invoices, appointments] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          organizationId,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          total: true,
          status: true,
          issueDate: true,
          paidAt: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          organizationId,
          scheduledAt: { gte: startDate, lte: endDate },
        },
        select: {
          scheduledAt: true,
        },
      }),
    ]);

    // Aggregate by day (YYYY-MM-DD)
    const pointsMap = new Map<
      string,
      { billed: number; collected: number; appointmentsCount: number }
    >();

    // Seed continuous date range if <= 90 days
    const daySpan = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
    if (daySpan <= 90) {
      for (let i = 0; i <= daySpan; i++) {
        const d = new Date(startDate.getTime() + i * 86400000);
        const key = d.toISOString().slice(0, 10);
        pointsMap.set(key, { billed: 0, collected: 0, appointmentsCount: 0 });
      }
    }

    // Populate billed
    for (const inv of invoices) {
      const dayKey = (inv.issueDate || inv.paidAt || new Date()).toISOString().slice(0, 10);
      const existing = pointsMap.get(dayKey) || {
        billed: 0,
        collected: 0,
        appointmentsCount: 0,
      };
      existing.billed += Number(inv.total);
      pointsMap.set(dayKey, existing);
    }

    // Populate collected
    for (const inv of invoices) {
      if (inv.status === 'PAID' && inv.paidAt) {
        const dayKey = inv.paidAt.toISOString().slice(0, 10);
        const existing = pointsMap.get(dayKey) || {
          billed: 0,
          collected: 0,
          appointmentsCount: 0,
        };
        existing.collected += Number(inv.total);
        pointsMap.set(dayKey, existing);
      }
    }

    // Populate appointments
    for (const appt of appointments) {
      const dayKey = appt.scheduledAt.toISOString().slice(0, 10);
      const existing = pointsMap.get(dayKey) || {
        billed: 0,
        collected: 0,
        appointmentsCount: 0,
      };
      existing.appointmentsCount += 1;
      pointsMap.set(dayKey, existing);
    }

    return Array.from(pointsMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        billed: Math.round(data.billed * 100) / 100,
        collected: Math.round(data.collected * 100) / 100,
        appointmentsCount: data.appointmentsCount,
      }));
  }

  public static async getServiceProfitability(
    organizationId: string,
    timeframe?: string,
  ): Promise<ServiceProfitabilityDto[]> {
    const { startDate, endDate } = this.resolveDates(timeframe);

    const services = await prisma.service.findMany({
      where: { organizationId },
      include: {
        appointments: {
          where: {
            scheduledAt: { gte: startDate, lte: endDate },
          },
          select: { id: true, status: true },
        },
      },
    });

    const totalBusinessRevenue = services.reduce(
      (acc, s) => acc + Number(s.price) * s.appointments.length,
      0,
    );

    return services
      .map((s) => {
        const bookingsCount = s.appointments.length;
        const revenueGenerated = Number(s.price) * bookingsCount;
        const sharePercentage =
          totalBusinessRevenue > 0
            ? Math.round((revenueGenerated / totalBusinessRevenue) * 100)
            : 0;

        return {
          id: s.id,
          name: s.name,
          category: s.category || 'General',
          price: Number(s.price),
          bookingsCount,
          revenueGenerated: Math.round(revenueGenerated * 100) / 100,
          sharePercentage,
        };
      })
      .sort((a, b) => b.revenueGenerated - a.revenueGenerated);
  }

  public static async getStaffProductivity(
    organizationId: string,
    timeframe?: string,
  ): Promise<StaffProductivityDto[]> {
    const { startDate, endDate } = this.resolveDates(timeframe);

    const staffMembers = await prisma.staffMember.findMany({
      where: { organizationId },
      include: {
        appointments: {
          where: {
            scheduledAt: { gte: startDate, lte: endDate },
          },
          include: {
            service: { select: { price: true } },
          },
        },
      },
    });

    return staffMembers.map((sm) => {
      const completedAppointments = sm.appointments.filter((a) => a.status === 'COMPLETED');
      const billableMinutes = completedAppointments.reduce(
        (acc, a) => acc + (a.durationMinutes || 60),
        0,
      );
      const revenueAttributed = completedAppointments.reduce(
        (acc, a) => acc + (a.service ? Number(a.service.price) : 0),
        0,
      );

      return {
        id: sm.id,
        name: sm.name,
        roleTitle: sm.roleTitle,
        avatarBg: sm.avatarBg,
        initials: sm.initials,
        status: sm.status,
        completedSessions: completedAppointments.length,
        billableMinutes,
        revenueAttributed: Math.round(revenueAttributed * 100) / 100,
      };
    });
  }

  public static async getCustomerIntelligence(
    organizationId: string,
    timeframe?: string,
  ): Promise<CustomerIntelligenceDto> {
    const { startDate, endDate } = this.resolveDates(timeframe);

    const customers = await prisma.customer.findMany({
      where: { organizationId },
      include: {
        appointments: {
          select: { id: true, scheduledAt: true },
        },
        invoices: {
          where: { status: 'PAID' },
          select: { total: true },
        },
      },
    });

    const totalCustomers = customers.length;
    const newCustomers = customers.filter(
      (c) => c.createdAt >= startDate && c.createdAt <= endDate,
    ).length;

    const repeatCustomers = customers.filter(
      (c) => c.appointments.length > 1 || c.invoices.length > 1,
    ).length;

    const repeatRate =
      totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0;

    const totalPaidRevenue = customers.reduce(
      (acc, c) => acc + c.invoices.reduce((sum, inv) => sum + Number(inv.total), 0),
      0,
    );

    const averageLtv =
      totalCustomers > 0 ? Math.round((totalPaidRevenue / totalCustomers) * 100) / 100 : 0;

    // At risk: customers who haven't had an appointment in 60+ days
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
    const atRiskCount = customers.filter((c) => {
      if (c.appointments.length === 0) return false;
      const latestAppt = c.appointments.reduce(
        (max, a) => (a.scheduledAt > max ? a.scheduledAt : max),
        new Date(0),
      );
      return latestAppt < sixtyDaysAgo;
    }).length;

    return {
      totalCustomers,
      newCustomers,
      repeatCustomers,
      repeatRate,
      averageLtv,
      atRiskCount,
    };
  }

  public static async exportCsv(organizationId: string, timeframe?: string): Promise<string> {
    const overview = await this.getOverview(organizationId, timeframe);
    const services = await this.getServiceProfitability(organizationId, timeframe);
    const staff = await this.getStaffProductivity(organizationId, timeframe);

    const lines: string[] = [];

    // Header & Overview Section
    lines.push('--- EXECUTIVE FINANCIAL & OPERATIONS SUMMARY ---');
    lines.push(`Timeframe,${overview.timeframe}`);
    lines.push(`Gross Revenue,$${overview.grossRevenue.toFixed(2)}`);
    lines.push(`Net Cash Inflow,$${overview.netCashInflow.toFixed(2)}`);
    lines.push(`Average Ticket Value (ATV),$${overview.atv.toFixed(2)}`);
    lines.push(`Outstanding Accounts Receivable,$${overview.outstandingAr.toFixed(2)}`);
    lines.push(`Appointment Fulfillment Rate,${overview.appointmentFulfillmentRate}%`);
    lines.push(`Workforce Utilization Rate,${overview.utilizationRate}%`);
    lines.push('');

    // Services Section
    lines.push('--- SERVICE PORTFOLIO PROFITABILITY ---');
    lines.push('Service Name,Category,Price,Bookings Count,Revenue Generated,Share %');
    for (const s of services) {
      lines.push(
        `"${s.name}","${s.category}",$${s.price.toFixed(2)},${s.bookingsCount},$${s.revenueGenerated.toFixed(2)},${s.sharePercentage}%`,
      );
    }
    lines.push('');

    // Staff Section
    lines.push('--- WORKFORCE PRODUCTIVITY & SPECIALIST ATTRIBUTION ---');
    lines.push('Specialist Name,Role Title,Completed Sessions,Billable Hours,Revenue Attributed');
    for (const sm of staff) {
      const hours = (sm.billableMinutes / 60).toFixed(1);
      lines.push(
        `"${sm.name}","${sm.roleTitle}",${sm.completedSessions},${hours} hrs,$${sm.revenueAttributed.toFixed(2)}`,
      );
    }

    return lines.join('\r\n');
  }
}

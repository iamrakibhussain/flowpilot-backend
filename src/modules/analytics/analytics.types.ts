export type TimeframeFilter = '7d' | '30d' | '90d' | 'ytd' | '12m' | 'all';

export interface AnalyticsTrendSummary {
  grossRevenueChange: number;
  netCashChange: number;
  atvChange: number;
  outstandingArChange: number;
  appointmentsChange: number;
}

export interface AnalyticsOverviewDto {
  grossRevenue: number;
  netCashInflow: number;
  atv: number;
  outstandingAr: number;
  appointmentFulfillmentRate: number;
  utilizationRate: number;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  trends: AnalyticsTrendSummary;
  timeframe: TimeframeFilter;
}

export interface CashflowPointDto {
  date: string; // YYYY-MM-DD
  billed: number;
  collected: number;
  appointmentsCount: number;
}

export interface ServiceProfitabilityDto {
  id: string;
  name: string;
  category: string;
  price: number;
  bookingsCount: number;
  revenueGenerated: number;
  sharePercentage: number;
}

export interface StaffProductivityDto {
  id: string;
  name: string;
  roleTitle: string;
  avatarBg: string;
  initials: string;
  status: string;
  completedSessions: number;
  revenueAttributed: number;
  billableMinutes: number;
}

export interface CustomerIntelligenceDto {
  totalCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  averageLtv: number;
  atRiskCount: number;
}

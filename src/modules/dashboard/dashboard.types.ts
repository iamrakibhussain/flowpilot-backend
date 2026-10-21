export type TimeframeType = '7d' | '30d' | '90d';

export interface ChartDataPoint {
  label: string;
  revenue: string;
  appointments: string;
  cx: number;
  cy: number;
}

export interface ReceivablesBreakdown {
  total: string;
  collectionEfficiency: string;
  avgDso: string;
  settled: {
    amount: string;
    percentage: number;
    count: number;
  };
  pending: {
    amount: string;
    percentage: number;
    count: number;
  };
  overdue: {
    amount: string;
    percentage: number;
    count: number;
  };
}

export interface DashboardMetricsResponse {
  timeframe: TimeframeType;
  revenue: string;
  revenueGrowth: string;
  sparklineD: string;
  sparklineFill: string;
  clients: string;
  clientsGrowth: string;
  appointments: string;
  appointmentsToday: string;
  appointmentsUpcoming: string;
  responseTime: string;
  periodTotalRevenue: string;
  periodTotalAppointments: string;
  dailyAvgRevenue: string;
  dailyAvgAppointments: string;
  chartPathD: string;
  chartAreaD: string;
  xAxisLabels: Array<{ full: string; short: string }>;
  dataPoints: ChartDataPoint[];
  receivables: ReceivablesBreakdown;
}

export interface DashboardActivityItem {
  id: string;
  refCode: string;
  client: string;
  avatarBg: string;
  service: string;
  type: 'invoices' | 'appointments';
  date: string;
  amount: string;
  status: string;
  statusVariant: 'success' | 'info' | 'warning' | 'neutral';
}

export interface TodayScheduleItem {
  id: string;
  time: string;
  title: string;
  client: string;
  location: string;
  status: string;
  type: string;
}

export interface StaffOnDutyItem {
  id: string;
  name: string;
  roleTitle: string;
  initials: string;
  avatarBg: string;
  status: string;
  statusNote: string;
  sessionsToday: string;
}

export interface QuickCreateInvoiceInput {
  customerId?: string;
  customerName?: string;
  description?: string;
  amount: number;
  dueDate?: string;
  status?: string;
  items?: Array<{ description: string; rate: number; quantity: number }>;
}

export interface QuickCreateAppointmentInput {
  customerId?: string;
  customerName?: string;
  serviceId?: string;
  serviceTitle?: string;
  staffMemberId?: string;
  staffName?: string;
  title?: string;
  scheduledAt?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  type?: 'VIDEO' | 'IN_PERSON' | 'PHONE';
  locationType?: string;
  location?: string;
  notes?: string;
}

export interface QuickCreateCustomerInput {
  name: string;
  contactName?: string;
  email: string;
  phone?: string;
  company?: string;
  tier?: string;
  currency?: string;
  assignedStaff?: string;
  notes?: string;
}

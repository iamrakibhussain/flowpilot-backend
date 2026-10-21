import {
  PrismaClient,
  CustomerStatus,
  AppointmentStatus,
  AppointmentType,
  InvoiceStatus,
  StaffStatus,
} from '@prisma/client';
import { hashPassword } from '../src/modules/auth/crypto.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting FlowPilot database seed...');

  let organizations = await prisma.organization.findMany();
  if (organizations.length === 0) {
    console.log('No organizations found. Initializing FlowPilot Demo Workspace & Administrator...');
    const passwordHash = await hashPassword('Admin1234!');
    const demoUser = await prisma.user.create({
      data: {
        email: 'admin@flowpilot.internal',
        name: 'Alex Mercer',
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const demoOrg = await prisma.organization.create({
      data: {
        name: 'FlowPilot Global Operations',
        slug: 'flowpilot-global',
        status: 'ACTIVE',
      },
    });

    await prisma.membership.create({
      data: {
        userId: demoUser.id,
        organizationId: demoOrg.id,
        role: 'OWNER',
      },
    });

    organizations = [demoOrg];
    console.log(
      'Created Demo Workspace: "FlowPilot Global Operations" (User: admin@flowpilot.internal / Admin1234!)',
    );
  }

  console.log(
    `Found ${organizations.length} organization(s). Seeding core business operations for each...`,
  );

  for (const org of organizations) {
    console.log(`Seeding data for organization: "${org.name}" (${org.slug})...`);

    // 1. Services Catalog
    const serviceData = [
      {
        name: 'Enterprise Operations Retainer',
        description:
          'Comprehensive monthly infrastructure, SLA governance, and operational oversight.',
        price: 1450.0,
        durationMinutes: 60,
      },
      {
        name: 'Q4 Executive Strategy Audit',
        description:
          'High-level executive review of KPIs, client retention, and profitability roadmap.',
        price: 950.0,
        durationMinutes: 60,
      },
      {
        name: 'Workflow Automation Setup',
        description: 'Custom end-to-end webhook integration, automated billing, and CRM syncing.',
        price: 2100.0,
        durationMinutes: 90,
      },
      {
        name: 'Security & SLA Compliance Review',
        description: 'SOC2 & PCI-DSS security compliance verification and multi-tenant audit.',
        price: 1800.0,
        durationMinutes: 60,
      },
      {
        name: 'Quarterly Tax & Compliance Filing',
        description: 'Quarterly financial reconciliation, receivables settlement, and tax prep.',
        price: 800.0,
        durationMinutes: 45,
      },
    ];

    const services = [];
    for (const s of serviceData) {
      const existing = await prisma.service.findFirst({
        where: { organizationId: org.id, name: s.name },
      });
      if (!existing) {
        services.push(
          await prisma.service.create({
            data: {
              organizationId: org.id,
              name: s.name,
              description: s.description,
              price: s.price,
              durationMinutes: s.durationMinutes,
            },
          }),
        );
      } else {
        services.push(existing);
      }
    }

    // 2. Staff Members
    const staffData = [
      {
        name: 'Sarah Lin',
        roleTitle: 'Lead Solutions Architect',
        email: 'sarah.lin@flowpilot.internal',
        initials: 'SL',
        avatarBg: 'bg-blue-600',
        status: StaffStatus.AVAILABLE,
      },
      {
        name: 'Marcus Chen',
        roleTitle: 'Operations Consultant',
        email: 'marcus.chen@flowpilot.internal',
        initials: 'MC',
        avatarBg: 'bg-indigo-600',
        status: StaffStatus.IN_SESSION,
      },
      {
        name: 'Elena Rostova',
        roleTitle: 'Client Success Director',
        email: 'elena.rostova@flowpilot.internal',
        initials: 'ER',
        avatarBg: 'bg-purple-600',
        status: StaffStatus.ON_BREAK,
      },
      {
        name: 'David Vance',
        roleTitle: 'Senior Systems Engineer',
        email: 'david.vance@flowpilot.internal',
        initials: 'DV',
        avatarBg: 'bg-emerald-600',
        status: StaffStatus.AVAILABLE,
      },
    ];

    const staffMembers = [];
    for (const staff of staffData) {
      const existing = await prisma.staffMember.findFirst({
        where: { organizationId: org.id, name: staff.name },
      });
      if (!existing) {
        staffMembers.push(
          await prisma.staffMember.create({
            data: {
              organizationId: org.id,
              name: staff.name,
              roleTitle: staff.roleTitle,
              email: staff.email,
              initials: staff.initials,
              avatarBg: staff.avatarBg,
              status: staff.status,
            },
          }),
        );
      } else {
        staffMembers.push(existing);
      }
    }

    // 3. Customers (CRM)
    const customerData = [
      {
        name: 'Apex Global Holdings',
        email: 'billing@apexglobal.com',
        phone: '+1 555-0192',
        company: 'Apex Global',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Dr. Aris Thorne',
        email: 'aris.thorne@thornehealth.org',
        phone: '+1 555-0144',
        company: 'Thorne Health Group',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Crestline Media Agency',
        email: 'accounts@crestlinemedia.com',
        phone: '+1 555-0187',
        company: 'Crestline Media',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Horizon Dynamics LLC',
        email: 'contact@horizondynamics.io',
        phone: '+1 555-0211',
        company: 'Horizon Dynamics',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Vantage Logic Labs',
        email: 'finance@vantagelogic.com',
        phone: '+1 555-0278',
        company: 'Vantage Logic',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'BlueShift Retailers',
        email: 'ops@blueshift.shop',
        phone: '+1 555-0312',
        company: 'BlueShift Corp',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Solstice BioTech',
        email: 'admin@solsticebio.com',
        phone: '+1 555-0365',
        company: 'Solstice BioTech',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'NovaCraft Creative',
        email: 'hello@novacraft.design',
        phone: '+1 555-0421',
        company: 'NovaCraft Studio',
        status: CustomerStatus.ACTIVE,
      },
      {
        name: 'Zenith Logistics Global',
        email: 'dispatch@zenithlogistics.com',
        phone: '+1 555-0499',
        company: 'Zenith Logistics',
        status: CustomerStatus.LEAD,
      },
      {
        name: 'Kinetics Data Corp',
        email: 'ops@kineticsdata.com',
        phone: '+1 555-0550',
        company: 'Kinetics Data',
        status: CustomerStatus.ACTIVE,
      },
    ];

    const customers = [];
    for (const c of customerData) {
      const existing = await prisma.customer.findFirst({
        where: { organizationId: org.id, email: c.email },
      });
      if (!existing) {
        customers.push(
          await prisma.customer.create({
            data: {
              organizationId: org.id,
              name: c.name,
              email: c.email,
              phone: c.phone,
              company: c.company,
              status: c.status,
            },
          }),
        );
      } else {
        customers.push(existing);
      }
    }

    // 4. Invoices (Cash Flow & Receivables Aging Telemetry)
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const daysAhead = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const invoiceData = [
      // SETTLED / PAID (Total ~ $38,400)
      {
        customerIndex: 0,
        number: 'INV-2026-881',
        subtotal: 1450.0,
        tax: 0,
        total: 1450.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(1),
        dueDate: daysAhead(29),
        paidAt: daysAgo(1),
        itemDesc: 'Enterprise Operations Retainer (October)',
      },
      {
        customerIndex: 4,
        number: 'INV-2026-879',
        subtotal: 3200.0,
        tax: 0,
        total: 3200.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(4),
        dueDate: daysAhead(26),
        paidAt: daysAgo(3),
        itemDesc: 'Q4 Executive Strategy Audit & Architecture',
      },
      {
        customerIndex: 3,
        number: 'INV-2026-875',
        subtotal: 4800.0,
        tax: 0,
        total: 4800.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(8),
        dueDate: daysAhead(22),
        paidAt: daysAgo(7),
        itemDesc: 'Multi-Cloud Infrastructure Automation',
      },
      {
        customerIndex: 5,
        number: 'INV-2026-870',
        subtotal: 2100.0,
        tax: 0,
        total: 2100.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(12),
        dueDate: daysAhead(18),
        paidAt: daysAgo(10),
        itemDesc: 'Workflow Automation Integration',
      },
      {
        customerIndex: 2,
        number: 'INV-2026-865',
        subtotal: 6400.0,
        tax: 0,
        total: 6400.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(16),
        dueDate: daysAhead(14),
        paidAt: daysAgo(14),
        itemDesc: 'Media Pipeline High-Throughput SLA Retainer',
      },
      {
        customerIndex: 6,
        number: 'INV-2026-860',
        subtotal: 5500.0,
        tax: 0,
        total: 5500.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(21),
        dueDate: daysAhead(9),
        paidAt: daysAgo(19),
        itemDesc: 'BioTech Compliance Infrastructure Audit',
      },
      {
        customerIndex: 7,
        number: 'INV-2026-855',
        subtotal: 1800.0,
        tax: 0,
        total: 1800.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(25),
        dueDate: daysAhead(5),
        paidAt: daysAgo(24),
        itemDesc: 'Creative Assets Storage Management Retainer',
      },
      {
        customerIndex: 0,
        number: 'INV-2026-850',
        subtotal: 4200.0,
        tax: 0,
        total: 4200.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(32),
        dueDate: daysAgo(2),
        paidAt: daysAgo(28),
        itemDesc: 'Q3 Enterprise Operations Settlement',
      },
      {
        customerIndex: 1,
        number: 'INV-2026-842',
        subtotal: 2450.0,
        tax: 0,
        total: 2450.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(38),
        dueDate: daysAgo(8),
        paidAt: daysAgo(30),
        itemDesc: 'Healthcare Practice Workflow Integration',
      },
      {
        customerIndex: 3,
        number: 'INV-2026-838',
        subtotal: 3800.0,
        tax: 0,
        total: 3800.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(45),
        dueDate: daysAgo(15),
        paidAt: daysAgo(40),
        itemDesc: 'Enterprise Architecture Consulting',
      },
      {
        customerIndex: 4,
        number: 'INV-2026-830',
        subtotal: 2700.0,
        tax: 0,
        total: 2700.0,
        status: InvoiceStatus.PAID,
        issueDate: daysAgo(52),
        dueDate: daysAgo(22),
        paidAt: daysAgo(48),
        itemDesc: 'Q3 Strategic Operations Audit',
      },

      // PENDING NET-30 (Total ~ $6,650)
      {
        customerIndex: 2,
        number: 'INV-2026-885',
        subtotal: 2100.0,
        tax: 0,
        total: 2100.0,
        status: InvoiceStatus.PENDING,
        issueDate: daysAgo(3),
        dueDate: daysAhead(11),
        paidAt: null,
        itemDesc: 'Custom Automation Setup & Webhook Integration',
      },
      {
        customerIndex: 0,
        number: 'INV-2026-886',
        subtotal: 1450.0,
        tax: 0,
        total: 1450.0,
        status: InvoiceStatus.PENDING,
        issueDate: daysAgo(2),
        dueDate: daysAhead(14),
        paidAt: null,
        itemDesc: 'Tier-1 Priority Support Retainer',
      },
      {
        customerIndex: 6,
        number: 'INV-2026-887',
        subtotal: 1800.0,
        tax: 0,
        total: 1800.0,
        status: InvoiceStatus.PENDING,
        issueDate: daysAgo(5),
        dueDate: daysAhead(20),
        paidAt: null,
        itemDesc: 'Security & SLA Compliance Assessment',
      },
      {
        customerIndex: 7,
        number: 'INV-2026-888',
        subtotal: 1300.0,
        tax: 0,
        total: 1300.0,
        status: InvoiceStatus.PENDING,
        issueDate: daysAgo(6),
        dueDate: daysAhead(8),
        paidAt: null,
        itemDesc: 'Creative Operations Pipeline Upgrade',
      },

      // OVERDUE >30d (Total ~ $3,200)
      {
        customerIndex: 5,
        number: 'INV-2026-812',
        subtotal: 1900.0,
        tax: 0,
        total: 1900.0,
        status: InvoiceStatus.OVERDUE,
        issueDate: daysAgo(65),
        dueDate: daysAgo(35),
        paidAt: null,
        itemDesc: 'Delinquent POS Integration Retainer (>30d)',
      },
      {
        customerIndex: 1,
        number: 'INV-2026-805',
        subtotal: 1300.0,
        tax: 0,
        total: 1300.0,
        status: InvoiceStatus.OVERDUE,
        issueDate: daysAgo(72),
        dueDate: daysAgo(42),
        paidAt: null,
        itemDesc: 'Clinic Telemetry Migration (Late Account)',
      },
    ];

    for (const inv of invoiceData) {
      const existing = await prisma.invoice.findFirst({
        where: { organizationId: org.id, invoiceNumber: inv.number },
      });
      if (!existing && customers[inv.customerIndex]) {
        await prisma.invoice.create({
          data: {
            organizationId: org.id,
            customerId: customers[inv.customerIndex].id,
            invoiceNumber: inv.number,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            status: inv.status,
            subtotal: inv.subtotal,
            tax: inv.tax,
            total: inv.total,
            paidAt: inv.paidAt,
            items: {
              create: [
                {
                  description: inv.itemDesc,
                  quantity: 1,
                  unitPrice: inv.subtotal,
                  amount: inv.total,
                },
              ],
            },
          },
        });
      }
    }

    // 5. Appointments (Today's Agenda & Upcoming Bookings)
    const today = new Date();
    const setTime = (hours: number, minutes: number) => {
      const d = new Date(today);
      d.setHours(hours, minutes, 0, 0);
      return d;
    };

    const appointmentData = [
      // Today
      {
        customerIndex: 0,
        serviceIndex: 0,
        staffIndex: 0,
        title: 'Quarterly Operations Review',
        scheduledAt: setTime(10, 0),
        durationMinutes: 60,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.VIDEO,
        location: 'Google Meet',
      },
      {
        customerIndex: 1,
        serviceIndex: 1,
        staffIndex: 1,
        title: 'Client CRM Onboarding Session',
        scheduledAt: setTime(13, 30),
        durationMinutes: 60,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.IN_PERSON,
        location: 'Office Suite B',
      },
      {
        customerIndex: 2,
        serviceIndex: 2,
        staffIndex: 2,
        title: 'Contract Renewal & Expansion',
        scheduledAt: setTime(16, 0),
        durationMinutes: 45,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.PHONE,
        location: 'Voice Bridge',
      },
      // Tomorrow & Upcoming
      {
        customerIndex: 4,
        serviceIndex: 1,
        staffIndex: 0,
        title: 'Executive Strategy Audit',
        scheduledAt: daysAhead(1),
        durationMinutes: 60,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.VIDEO,
        location: 'Zoom Conference',
      },
      {
        customerIndex: 3,
        serviceIndex: 2,
        staffIndex: 1,
        title: 'Workflow Automation Kickoff',
        scheduledAt: daysAhead(2),
        durationMinutes: 90,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.VIDEO,
        location: 'Google Meet',
      },
      {
        customerIndex: 6,
        serviceIndex: 3,
        staffIndex: 3,
        title: 'Infrastructure Security Check',
        scheduledAt: daysAhead(3),
        durationMinutes: 60,
        status: AppointmentStatus.CONFIRMED,
        type: AppointmentType.VIDEO,
        location: 'Secure Bridge',
      },
      // Past completed (last 30 days)
      {
        customerIndex: 0,
        serviceIndex: 0,
        staffIndex: 0,
        title: 'Sprint Retrospective & Health Check',
        scheduledAt: daysAgo(3),
        durationMinutes: 60,
        status: AppointmentStatus.COMPLETED,
        type: AppointmentType.VIDEO,
      },
      {
        customerIndex: 5,
        serviceIndex: 2,
        staffIndex: 1,
        title: 'Retail Store Sync Integration',
        scheduledAt: daysAgo(7),
        durationMinutes: 60,
        status: AppointmentStatus.COMPLETED,
        type: AppointmentType.VIDEO,
      },
      {
        customerIndex: 7,
        serviceIndex: 4,
        staffIndex: 2,
        title: 'Quarterly Compliance Verification',
        scheduledAt: daysAgo(14),
        durationMinutes: 45,
        status: AppointmentStatus.COMPLETED,
        type: AppointmentType.PHONE,
      },
    ];

    for (const apt of appointmentData) {
      if (customers[apt.customerIndex]) {
        const existing = await prisma.appointment.findFirst({
          where: {
            organizationId: org.id,
            customerId: customers[apt.customerIndex].id,
            title: apt.title,
          },
        });
        if (!existing) {
          await prisma.appointment.create({
            data: {
              organizationId: org.id,
              customerId: customers[apt.customerIndex].id,
              serviceId: services[apt.serviceIndex]?.id,
              staffMemberId: staffMembers[apt.staffIndex]?.id,
              title: apt.title,
              scheduledAt: apt.scheduledAt,
              durationMinutes: apt.durationMinutes,
              status: apt.status,
              type: apt.type,
              location: apt.location,
            },
          });
        }
      }
    }
  }

  console.log('FlowPilot database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed script error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

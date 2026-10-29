import { Prisma, Service } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import {
  ServiceItem,
  CreateServiceInput,
  UpdateServiceInput,
  ServiceListQuery,
  ServiceStaffMemberSummary,
} from './service.types.js';

type ServiceWithRelations = Service & {
  staffMembers?: Array<{
    staffMember: {
      id: string;
      name: string;
      roleTitle: string;
      avatarBg: string;
      initials: string;
    };
  }>;
  _count?: {
    appointments?: number;
  };
};

export class ServiceCatalogService {
  private static formatService(service: ServiceWithRelations): ServiceItem {
    const staffMembers: ServiceStaffMemberSummary[] =
      service.staffMembers?.map((item) => ({
        id: item.staffMember.id,
        name: item.staffMember.name,
        roleTitle: item.staffMember.roleTitle,
        avatarBg: item.staffMember.avatarBg,
        initials: item.staffMember.initials,
      })) ?? [];

    return {
      id: service.id,
      organizationId: service.organizationId,
      name: service.name,
      description: service.description ?? null,
      category: service.category || 'General',
      price: Number(service.price),
      durationMinutes: service.durationMinutes,
      bufferBefore: service.bufferBefore ?? 0,
      bufferAfter: service.bufferAfter ?? 0,
      isActive: service.isActive,
      requireDeposit: service.requireDeposit,
      depositType: service.depositType || 'FIXED',
      depositAmount: service.depositAmount ? Number(service.depositAmount) : null,
      staffMembers,
      staffMemberIds: staffMembers.map((s) => s.id),
      appointmentCount: service._count?.appointments ?? 0,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
    };
  }

  public static async listServices(
    organizationId: string,
    query?: ServiceListQuery,
  ): Promise<ServiceItem[]> {
    const whereClause: Prisma.ServiceWhereInput = {
      organizationId,
      ...(query?.activeOnly ? { isActive: true } : {}),
      ...(query?.category && query.category !== 'ALL' ? { category: query.category } : {}),
    };

    if (query?.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    const services = await prisma.service.findMany({
      where: whereClause,
      include: {
        staffMembers: {
          include: {
            staffMember: {
              select: {
                id: true,
                name: true,
                roleTitle: true,
                avatarBg: true,
                initials: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return services.map(this.formatService);
  }

  public static async getServiceById(organizationId: string, id: string): Promise<ServiceItem> {
    const service = await prisma.service.findFirst({
      where: { id, organizationId },
      include: {
        staffMembers: {
          include: {
            staffMember: {
              select: {
                id: true,
                name: true,
                roleTitle: true,
                avatarBg: true,
                initials: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    return this.formatService(service);
  }

  public static async createService(
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<ServiceItem> {
    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestError('Service name is required');
    }
    if (input.price === undefined || input.price < 0) {
      throw new BadRequestError('Service price must be a non-negative number');
    }

    const duration = input.durationMinutes
      ? Math.max(15, Math.min(480, input.durationMinutes))
      : 60;
    const bufferBefore = Math.max(0, Math.min(120, input.bufferBefore ?? 0));
    const bufferAfter = Math.max(0, Math.min(120, input.bufferAfter ?? 0));
    const category = input.category?.trim() || 'General';
    const depositType = input.depositType === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED';

    let validStaffIds: string[] = [];
    if (input.staffMemberIds && input.staffMemberIds.length > 0) {
      const staffInOrg = await prisma.staffMember.findMany({
        where: {
          organizationId,
          id: { in: input.staffMemberIds },
        },
        select: { id: true },
      });
      validStaffIds = staffInOrg.map((s) => s.id);
    }

    const created = await prisma.service.create({
      data: {
        organizationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category,
        price: input.price,
        durationMinutes: duration,
        bufferBefore,
        bufferAfter,
        isActive: input.isActive ?? true,
        requireDeposit: Boolean(input.requireDeposit),
        depositType,
        depositAmount:
          input.depositAmount !== undefined && input.depositAmount !== null
            ? input.depositAmount
            : null,
        staffMembers:
          validStaffIds.length > 0
            ? {
                create: validStaffIds.map((staffMemberId) => ({
                  staffMemberId,
                })),
              }
            : undefined,
      },
      include: {
        staffMembers: {
          include: {
            staffMember: {
              select: {
                id: true,
                name: true,
                roleTitle: true,
                avatarBg: true,
                initials: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    return this.formatService(created);
  }

  public static async updateService(
    organizationId: string,
    id: string,
    input: UpdateServiceInput,
  ): Promise<ServiceItem> {
    const existing = await prisma.service.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Service not found');
    }

    if (input.price !== undefined && input.price < 0) {
      throw new BadRequestError('Service price must be a non-negative number');
    }

    const duration =
      input.durationMinutes !== undefined
        ? Math.max(15, Math.min(480, input.durationMinutes))
        : undefined;

    const bufferBefore =
      input.bufferBefore !== undefined ? Math.max(0, Math.min(120, input.bufferBefore)) : undefined;

    const bufferAfter =
      input.bufferAfter !== undefined ? Math.max(0, Math.min(120, input.bufferAfter)) : undefined;

    if (input.staffMemberIds !== undefined) {
      const validStaff = await prisma.staffMember.findMany({
        where: {
          organizationId,
          id: { in: input.staffMemberIds },
        },
        select: { id: true },
      });
      const validStaffIds = validStaff.map((s) => s.id);

      await prisma.$transaction([
        prisma.staffService.deleteMany({
          where: { serviceId: id },
        }),
        ...(validStaffIds.length > 0
          ? [
              prisma.staffService.createMany({
                data: validStaffIds.map((staffMemberId) => ({
                  serviceId: id,
                  staffMemberId,
                })),
              }),
            ]
          : []),
      ]);
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        description:
          input.description !== undefined ? input.description?.trim() || null : undefined,
        category: input.category !== undefined ? input.category.trim() || 'General' : undefined,
        price: input.price !== undefined ? input.price : undefined,
        durationMinutes: duration,
        bufferBefore,
        bufferAfter,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
        requireDeposit: input.requireDeposit !== undefined ? input.requireDeposit : undefined,
        depositType: input.depositType !== undefined ? input.depositType : undefined,
        depositAmount: input.depositAmount !== undefined ? input.depositAmount : undefined,
      },
      include: {
        staffMembers: {
          include: {
            staffMember: {
              select: {
                id: true,
                name: true,
                roleTitle: true,
                avatarBg: true,
                initials: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    return this.formatService(updated);
  }

  public static async syncServiceStaff(
    organizationId: string,
    id: string,
    staffMemberIds: string[],
  ): Promise<ServiceItem> {
    const service = await prisma.service.findFirst({
      where: { id, organizationId },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    const validStaff = await prisma.staffMember.findMany({
      where: {
        organizationId,
        id: { in: staffMemberIds },
      },
      select: { id: true },
    });
    const validStaffIds = validStaff.map((s) => s.id);

    await prisma.$transaction([
      prisma.staffService.deleteMany({
        where: { serviceId: id },
      }),
      ...(validStaffIds.length > 0
        ? [
            prisma.staffService.createMany({
              data: validStaffIds.map((staffMemberId) => ({
                serviceId: id,
                staffMemberId,
              })),
            }),
          ]
        : []),
    ]);

    return this.getServiceById(organizationId, id);
  }

  public static async deleteService(
    organizationId: string,
    id: string,
  ): Promise<{ id: string; archived: boolean; message: string }> {
    const service = await prisma.service.findFirst({
      where: { id, organizationId },
      include: {
        _count: {
          select: { appointments: true },
        },
      },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    if (service._count.appointments > 0) {
      // Safely archive to maintain referential integrity with historic appointment records
      await prisma.service.update({
        where: { id },
        data: { isActive: false },
      });
      return {
        id,
        archived: true,
        message: 'Service has existing appointment history and was safely archived.',
      };
    }

    await prisma.service.delete({
      where: { id },
    });

    return {
      id,
      archived: false,
      message: 'Service deleted permanently.',
    };
  }

  public static async toggleActive(organizationId: string, id: string): Promise<ServiceItem> {
    const existing = await prisma.service.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Service not found');
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        isActive: !existing.isActive,
      },
      include: {
        staffMembers: {
          include: {
            staffMember: {
              select: {
                id: true,
                name: true,
                roleTitle: true,
                avatarBg: true,
                initials: true,
              },
            },
          },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    return this.formatService(updated);
  }
}

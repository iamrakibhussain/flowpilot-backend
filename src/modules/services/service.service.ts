import { Service } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { ServiceItem, CreateServiceInput, UpdateServiceInput } from './service.types.js';

export class ServiceCatalogService {
  private static formatService(service: Service): ServiceItem {
    return {
      id: service.id,
      organizationId: service.organizationId,
      name: service.name,
      description: service.description ?? null,
      price: Number(service.price),
      durationMinutes: service.durationMinutes,
      isActive: service.isActive,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
    };
  }

  public static async listServices(
    organizationId: string,
    activeOnly = false,
  ): Promise<ServiceItem[]> {
    const services = await prisma.service.findMany({
      where: {
        organizationId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
    });

    return services.map(this.formatService);
  }

  public static async getServiceById(organizationId: string, id: string): Promise<ServiceItem> {
    const service = await prisma.service.findFirst({
      where: { id, organizationId },
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

    const created = await prisma.service.create({
      data: {
        organizationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        price: input.price,
        durationMinutes: duration,
        isActive: input.isActive ?? true,
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

    const updated = await prisma.service.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        description: input.description !== undefined ? input.description.trim() : undefined,
        price: input.price !== undefined ? input.price : undefined,
        durationMinutes: duration,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });

    return this.formatService(updated);
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
    });

    return this.formatService(updated);
  }
}

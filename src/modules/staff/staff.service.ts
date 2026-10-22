import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { StaffStatus, StaffMember } from '@prisma/client';
import { StaffItem, CreateStaffInput } from './staff.types.js';

export class StaffService {
  private static formatStaff(staff: StaffMember): StaffItem {
    return {
      id: staff.id,
      organizationId: staff.organizationId,
      name: staff.name,
      roleTitle: staff.roleTitle,
      email: staff.email ?? null,
      initials: staff.initials,
      avatarBg: staff.avatarBg,
      status: staff.status,
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
    };
  }

  public static async listStaff(organizationId: string): Promise<StaffItem[]> {
    const staff = await prisma.staffMember.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });

    return staff.map(this.formatStaff);
  }

  public static async createStaff(
    organizationId: string,
    input: CreateStaffInput,
  ): Promise<StaffItem> {
    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestError('Staff member name is required');
    }
    if (!input.roleTitle || input.roleTitle.trim().length === 0) {
      throw new BadRequestError('Role or specialization title is required');
    }

    const parts = input.name.trim().split(' ').filter(Boolean);
    const firstWord = parts[0] ?? '';
    const lastWord = parts[parts.length - 1] ?? '';
    const initials =
      parts.length > 1 && firstWord && lastWord
        ? `${firstWord[0] ?? ''}${lastWord[0] ?? ''}`.toUpperCase()
        : input.name.trim().slice(0, 2).toUpperCase();

    const avatarBgs = [
      'bg-blue-600',
      'bg-indigo-600',
      'bg-violet-600',
      'bg-purple-600',
      'bg-rose-600',
      'bg-amber-600',
      'bg-emerald-600',
      'bg-cyan-600',
    ];
    const avatarBg = input.avatarBg ?? avatarBgs[Math.floor(Math.random() * avatarBgs.length)];

    const created = await prisma.staffMember.create({
      data: {
        organizationId,
        name: input.name.trim(),
        roleTitle: input.roleTitle.trim(),
        email: input.email?.trim() || null,
        initials,
        avatarBg,
        status: input.status ?? StaffStatus.AVAILABLE,
      },
    });

    return this.formatStaff(created);
  }

  public static async updateStatus(
    organizationId: string,
    id: string,
    status: StaffStatus,
  ): Promise<StaffItem> {
    const existing = await prisma.staffMember.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Staff member not found');
    }

    const updated = await prisma.staffMember.update({
      where: { id },
      data: { status },
    });

    return this.formatStaff(updated);
  }
}

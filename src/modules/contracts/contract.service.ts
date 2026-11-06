import { randomUUID, createHash } from 'crypto';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { ContractStatus, FlowRuleTrigger, Prisma } from '@prisma/client';
import { logger } from '../../common/logging/logger.js';
import { NotificationService } from '../notifications/notification.service.js';
import { EmailService } from '../../common/email/email.service.js';
import { FlowRulesService } from '../flow-rules/flow-rules.service.js';
import { env } from '../../config/env.js';
import type {
  CreateContractInput,
  UpdateContractInput,
  ListContractsQuery,
  SignContractPublicInput,
  CountersignContractInput,
  DeclineContractInput,
  PublicContractStatement,
} from './contract.types.js';

export class ContractService {
  /**
   * Generates sequential contract number scoped by organization (e.g. CNT-2026-001)
   */
  private static async generateContractNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await prisma.contract.count({
      where: { organizationId },
    });
    const seq = String(count + 1).padStart(3, '0');
    return `CNT-${year}-${seq}`;
  }

  /**
   * Create a new draft contract
   */
  public static async createContract(
    organizationId: string,
    createdById: string,
    input: CreateContractInput,
  ) {
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundError('Customer record not found in organization');
    }

    if (input.quoteId) {
      const quote = await prisma.quote.findFirst({
        where: { id: input.quoteId, organizationId },
      });
      if (!quote) throw new NotFoundError('Linked quote not found in organization');
    }

    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, organizationId },
      });
      if (!project) throw new NotFoundError('Linked project not found in organization');
    }

    const contractNumber = await this.generateContractNumber(organizationId);

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const effectiveDateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const processedContent = input.content
      .replace(/\{\{client_name\}\}/gi, customer.name)
      .replace(/\{\{company_name\}\}/gi, customer.company || customer.name)
      .replace(/\{\{business_name\}\}/gi, org?.name || 'Service Provider')
      .replace(/\{\{effective_date\}\}/gi, effectiveDateStr)
      .replace(/\{\{contract_number\}\}/gi, contractNumber);

    const contract = await prisma.contract.create({
      data: {
        organizationId,
        customerId: input.customerId,
        createdById,
        quoteId: input.quoteId ?? null,
        projectId: input.projectId ?? null,
        title: input.title,
        contractNumber,
        content: processedContent,
        status: ContractStatus.DRAFT,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, company: true },
        },
        quote: {
          select: { id: true, quoteNumber: true, totalAmount: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    logger.info(
      { organizationId, contractId: contract.id, contractNumber },
      'Contract drafted successfully',
    );

    return contract;
  }

  /**
   * List contracts for organization with pagination & status filters
   */
  public static async listContracts(organizationId: string, query: ListContractsQuery = {}) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ContractWhereInput = { organizationId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.quoteId) {
      where.quoteId = query.quoteId;
    }
    if (query.projectId) {
      where.projectId = query.projectId;
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { contractNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { company: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, email: true, company: true },
          },
          quote: {
            select: { id: true, quoteNumber: true, totalAmount: true },
          },
          project: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get single contract by ID strictly scoped to organization
   */
  public static async getContractById(organizationId: string, id: string) {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        quote: {
          select: { id: true, quoteNumber: true, totalAmount: true },
        },
        project: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!contract) {
      throw new NotFoundError(`Contract with ID ${id} not found`);
    }

    return contract;
  }

  /**
   * Update draft contract
   */
  public static async updateContract(
    organizationId: string,
    id: string,
    input: UpdateContractInput,
  ) {
    const existing = await prisma.contract.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError(`Contract with ID ${id} not found`);
    }

    if (
      existing.status === ContractStatus.SIGNED ||
      existing.status === ContractStatus.COUNTERSIGNED
    ) {
      throw new BadRequestError('Cannot modify a signed or finalized contract');
    }

    const data: Prisma.ContractUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (input.customerId !== undefined) data.customerId = input.customerId;
    if (input.quoteId !== undefined) data.quoteId = input.quoteId;
    if (input.projectId !== undefined) data.projectId = input.projectId;
    if (input.status !== undefined) data.status = input.status;
    if (input.expiresAt !== undefined) {
      data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }

    const updated = await prisma.contract.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true, email: true, company: true } },
        quote: { select: { id: true, quoteNumber: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return updated;
  }

  /**
   * Send contract for signature (generates signToken, updates status, and dispatches email)
   */
  public static async sendContract(organizationId: string, id: string) {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        organization: true,
      },
    });

    if (!contract) {
      throw new NotFoundError(`Contract with ID ${id} not found`);
    }

    if (
      contract.status === ContractStatus.SIGNED ||
      contract.status === ContractStatus.COUNTERSIGNED
    ) {
      throw new BadRequestError('Contract is already signed');
    }

    // Generate or refresh high-entropy token
    const token = `tok_sign_${randomUUID().replace(/-/g, '')}`;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30); // 30-day signing window

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        signToken: token,
        signTokenExpiry: expiry,
        status: ContractStatus.PENDING_SIGNATURE,
        issuedAt: new Date(),
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    const signingUrl = `${env.FRONTEND_URL}/sign/${token}`;

    // Dispatch branded email notification to customer
    if (contract.customer.email?.includes('@')) {
      EmailService.sendContractSigningEmail({
        to: contract.customer.email,
        customerName: contract.customer.name,
        contractTitle: contract.title,
        contractNumber: contract.contractNumber,
        signingUrl,
        organizationName: contract.organization.name,
        brandColor: contract.organization.brandColor || undefined,
      }).catch((err) => {
        logger.error({ err }, 'Failed to dispatch contract signing email');
      });
    }

    return {
      contract: updated,
      signingUrl,
    };
  }

  /**
   * Get public sanitized contract statement by signToken for `/sign/[token]`
   */
  public static async getPublicContractByToken(token: string): Promise<PublicContractStatement> {
    const contract = await prisma.contract.findFirst({
      where: { signToken: token },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            brandColor: true,
            contactEmail: true,
            contactPhone: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
          },
        },
      },
    });

    if (!contract) {
      throw new NotFoundError('Contract signing link not found or has been revoked');
    }

    if (contract.signTokenExpiry && new Date() > contract.signTokenExpiry) {
      throw new BadRequestError(
        'This signing link has expired. Please contact the business for a renewed link.',
      );
    }

    // Auto-update to VIEWED if currently PENDING_SIGNATURE
    if (contract.status === ContractStatus.PENDING_SIGNATURE && !contract.viewedAt) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: ContractStatus.VIEWED,
          viewedAt: new Date(),
        },
      });
      contract.status = ContractStatus.VIEWED;
    }

    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      title: contract.title,
      content: contract.content,
      status: contract.status,
      issuedAt: contract.issuedAt.toISOString(),
      expiresAt: contract.expiresAt ? contract.expiresAt.toISOString() : null,
      signedAt: contract.signedAt ? contract.signedAt.toISOString() : null,
      signerName: contract.signerName,
      signerEmail: contract.signerEmail,
      signatureData: contract.signatureData,
      signatureType: contract.signatureType,
      contentChecksum: contract.contentChecksum,
      countersignedAt: contract.countersignedAt ? contract.countersignedAt.toISOString() : null,
      countersignerName: contract.countersignerName,
      countersignatureData: contract.countersignatureData,
      organization: contract.organization,
      customer: contract.customer,
    };
  }

  /**
   * Execute cryptographic public digital signature ceremony
   */
  public static async signContractPublic(
    token: string,
    input: SignContractPublicInput,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const contract = await prisma.contract.findFirst({
      where: { signToken: token },
      include: {
        organization: true,
        customer: true,
      },
    });

    if (!contract) {
      throw new NotFoundError('Contract not found or invalid token');
    }

    if (
      contract.status === ContractStatus.SIGNED ||
      contract.status === ContractStatus.COUNTERSIGNED
    ) {
      throw new BadRequestError('This contract has already been signed');
    }

    if (contract.status === ContractStatus.VOIDED || contract.status === ContractStatus.DECLINED) {
      throw new BadRequestError('This contract is no longer active');
    }

    if (contract.signTokenExpiry && new Date() > contract.signTokenExpiry) {
      throw new BadRequestError('This signing link has expired');
    }

    // Compute cryptographic SHA-256 hash of immutable content
    const contentChecksum = createHash('sha256')
      .update(contract.content + '|' + input.signerEmail + '|' + input.signerName)
      .digest('hex');

    const signed = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.SIGNED,
        signedAt: new Date(),
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail.trim().toLowerCase(),
        signerIp: meta.ipAddress || 'Unknown IP',
        signerUserAgent: meta.userAgent || 'Unknown Browser',
        signatureData: input.signatureData,
        signatureType: input.signatureType,
        contentChecksum,
        clientNotes: input.clientNotes ?? null,
      },
    });

    // In-app notification for business staff/admin
    NotificationService.createNotification({
      organizationId: contract.organizationId,
      type: 'CONTRACT_SIGNED',
      title: `Contract Signed: ${contract.contractNumber}`,
      message: `${contract.title} was signed by ${input.signerName} (${input.signerEmail}).`,
      actionUrl: `/dashboard/contracts?contractId=${contract.id}`,
      metadata: {
        contractId: contract.id,
        customerId: contract.customerId,
        checksum: contentChecksum,
      },
    }).catch((err) => {
      logger.error({ err }, 'Failed to create contract signed notification');
    });

    logger.info(
      {
        contractId: contract.id,
        checksum: contentChecksum,
        signerEmail: input.signerEmail,
      },
      'Contract cryptographically signed by client',
    );

    // Autonomous FlowRules Trigger (non-blocking)
    FlowRulesService.dispatch(contract.organizationId, FlowRuleTrigger.CONTRACT_SIGNED, {
      entityId: contract.id,
      customerId: contract.customerId,
      title: contract.title,
      metadata: {
        signerEmail: input.signerEmail,
        signerName: input.signerName,
      },
    }).catch((err) => {
      logger.error({ err }, 'FlowRules: failed dispatching CONTRACT_SIGNED');
    });

    return {
      success: true,
      contractId: signed.id,
      status: signed.status,
      signedAt: signed.signedAt,
      contentChecksum,
    };
  }

  /**
   * Countersign contract by authenticated staff/owner
   */
  public static async countersignContract(
    organizationId: string,
    id: string,
    userId: string,
    input: CountersignContractInput,
  ) {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId },
      include: { customer: true },
    });

    if (!contract) {
      throw new NotFoundError(`Contract with ID ${id} not found`);
    }

    if (contract.status !== ContractStatus.SIGNED) {
      throw new BadRequestError('Contract must be signed by the client before countersigning');
    }

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        status: ContractStatus.COUNTERSIGNED,
        countersignedAt: new Date(),
        countersignerId: userId,
        countersignerName: input.countersignerName.trim(),
        countersignatureData: input.countersignatureData,
      },
    });

    return updated;
  }

  /**
   * Decline contract by client
   */
  public static async declineContractPublic(token: string, input: DeclineContractInput) {
    const contract = await prisma.contract.findFirst({
      where: { signToken: token },
    });

    if (!contract) {
      throw new NotFoundError('Contract signing link not found');
    }

    if (
      contract.status === ContractStatus.SIGNED ||
      contract.status === ContractStatus.COUNTERSIGNED
    ) {
      throw new BadRequestError('Cannot decline an already signed contract');
    }

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: input.reason.trim(),
      },
    });

    return {
      success: true,
      status: updated.status,
      message: 'Contract declined successfully',
    };
  }

  /**
   * Delete draft contract
   */
  public static async deleteContract(organizationId: string, id: string) {
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId },
    });

    if (!contract) {
      throw new NotFoundError(`Contract with ID ${id} not found`);
    }

    if (contract.status !== ContractStatus.DRAFT) {
      throw new BadRequestError('Only draft contracts can be deleted');
    }

    await prisma.contract.delete({ where: { id } });

    return { success: true };
  }
}

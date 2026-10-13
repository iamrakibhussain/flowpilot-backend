import { z } from 'zod';

export const organizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'BILLING']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

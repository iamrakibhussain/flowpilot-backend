import { z } from 'zod';

export const requestPortalLinkSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address')
    .transform((v) => v.toLowerCase().trim()),
  organizationSlug: z.string().min(1, 'Organization slug is required').trim(),
});

export type RequestPortalLinkInput = z.infer<typeof requestPortalLinkSchema>;

export const verifyPortalTokenSchema = z
  .object({
    organizationSlug: z.string().min(1, 'Organization slug is required').trim(),
    token: z.string().min(16).optional(),
    code: z.string().length(6, 'Verification code must be 6 digits').optional(),
  })
  .refine((data) => data.token || data.code, {
    message: 'Either magic token or 6-digit verification code is required',
    path: ['token'],
  });

export type VerifyPortalTokenInput = z.infer<typeof verifyPortalTokenSchema>;

export const rescheduleAppointmentSchema = z.object({
  newScheduledAt: z.string().datetime({ message: 'Valid ISO 8601 datetime required' }),
});

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason must be at least 3 characters').max(500),
});

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const updatePortalProfileSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  company: z.string().max(100).optional().nullable(),
});

export type UpdatePortalProfileInput = z.infer<typeof updatePortalProfileSchema>;

import { z } from 'zod';
import { isCommonPassword } from './crypto.js';

// Disallow dangerous control characters (0x00-0x1F, 0x7F) in user-supplied strings
const hasNoControlChars = (val: string) => {
  for (let i = 0; i < val.length; i += 1) {
    const code = val.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return false;
    }
  }
  return true;
};

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255, 'Email cannot exceed 255 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters'),
});

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255, 'Email cannot exceed 255 characters'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').refine(hasNoControlChars, {
    message: 'Name contains invalid control characters',
  }),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .refine((pwd) => /[A-Z]/.test(pwd), {
      message: 'Password must contain at least one uppercase letter',
    })
    .refine((pwd) => /[a-z]/.test(pwd), {
      message: 'Password must contain at least one lowercase letter',
    })
    .refine((pwd) => /[0-9]/.test(pwd), {
      message: 'Password must contain at least one number',
    })
    .refine((pwd) => !isCommonPassword(pwd), {
      message:
        'This password is too common or easily guessable. Please choose a stronger password.',
    }),
  organizationName: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name cannot exceed 100 characters')
    .refine(hasNoControlChars, {
      message: 'Organization name contains invalid control characters',
    }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255, 'Email cannot exceed 255 characters'),
});

export const resetPasswordSchema = z.object({
  token: z
    .string()
    .trim()
    .min(32, 'Invalid password reset token')
    .max(128, 'Invalid password reset token'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password cannot exceed 128 characters')
    .refine((pwd) => /[A-Z]/.test(pwd), {
      message: 'Password must contain at least one uppercase letter',
    })
    .refine((pwd) => /[a-z]/.test(pwd), {
      message: 'Password must contain at least one lowercase letter',
    })
    .refine((pwd) => /[0-9]/.test(pwd), {
      message: 'Password must contain at least one number',
    })
    .refine((pwd) => !isCommonPassword(pwd), {
      message:
        'This password is too common or easily guessable. Please choose a stronger password.',
    }),
});

export const verifyEmailSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(128, 'New password cannot exceed 128 characters')
      .refine((pwd) => /[A-Z]/.test(pwd), {
        message: 'New password must contain at least one uppercase letter',
      })
      .refine((pwd) => /[a-z]/.test(pwd), {
        message: 'New password must contain at least one lowercase letter',
      })
      .refine((pwd) => /[0-9]/.test(pwd), {
        message: 'New password must contain at least one number',
      })
      .refine((pwd) => !isCommonPassword(pwd), {
        message:
          'This password is too common or easily guessable. Please choose a stronger password.',
      }),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from your current password',
    path: ['newPassword'],
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required to confirm account deletion'),
  confirmationText: z
    .string()
    .trim()
    .refine(
      (text) => text.toUpperCase() === 'DELETE' || text.toUpperCase() === 'DELETE MY ACCOUNT',
      {
        message: 'Confirmation phrase must be DELETE or DELETE MY ACCOUNT',
      },
    ),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

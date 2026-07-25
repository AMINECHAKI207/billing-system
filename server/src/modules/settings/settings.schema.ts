import { z } from 'zod';

const emptyStringToNull = (value: unknown) => (value === '' ? null : value);
const optionalText = z.preprocess(emptyStringToNull, z.string().optional().nullable());

export const updateCompanySettingsSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(255),
    address: optionalText,
    phone: z.preprocess(emptyStringToNull, z.string().max(50).optional().nullable()),
    email: z.preprocess(emptyStringToNull, z.string().email().optional().nullable()),
    taxNumber: z.preprocess(emptyStringToNull, z.string().max(100).optional().nullable()),
    logoUrl: z.preprocess(emptyStringToNull, z.string().url().optional().nullable()),
    signatureUrl: optionalText,
    stampUrl: optionalText,
    defaultCurrency: z.string().min(3).max(10),
    defaultTaxRate: z.coerce.number().min(0).max(100),
    vatEnabled: z.boolean().default(true),
    moroccoVatRate: z.coerce.number().min(0).max(100).default(20),
    paymentTerms: optionalText,
    bankDetails: optionalText,
  }),
});

export const testEmailSchema = z.object({
  body: z.object({
    recipientEmail: z.string().email('Invalid email address').optional(),
  }),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>['body'];
export type TestEmailInput = z.infer<typeof testEmailSchema>['body'];

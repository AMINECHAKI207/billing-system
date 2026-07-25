import { prisma } from '@config/database';
import { UpdateCompanySettingsInput } from './settings.schema';
import { CompanyAssetKind } from './companyAssetUpload';

const COMPANY_SETTINGS_ID = 1;

export class SettingsRepository {
  async getCompanySettings() {
    return prisma.companySettings.upsert({
      where: { id: COMPANY_SETTINGS_ID },
      create: {
        id: COMPANY_SETTINGS_ID,
        name: 'Billing System Demo',
        address: 'Casablanca, Morocco',
        phone: '+212 600 000 000',
        email: 'billing@example.com',
        taxNumber: 'IF: DEMO',
        defaultCurrency: 'MAD',
        defaultTaxRate: 20,
        vatEnabled: true,
        moroccoVatRate: 20,
        paymentTerms: 'Paiement a 30 jours.',
      },
      update: {},
    });
  }

  async updateCompanySettings(data: UpdateCompanySettingsInput) {
    return prisma.companySettings.upsert({
      where: { id: COMPANY_SETTINGS_ID },
      create: {
        id: COMPANY_SETTINGS_ID,
        ...data,
      },
      update: data,
    });
  }

  async updateCompanyAsset(kind: CompanyAssetKind, url: string | null) {
    const data = kind === 'signature' ? { signatureUrl: url } : { stampUrl: url };

    return prisma.companySettings.upsert({
      where: { id: COMPANY_SETTINGS_ID },
      create: {
        id: COMPANY_SETTINGS_ID,
        name: 'Billing System Demo',
        address: 'Casablanca, Morocco',
        phone: '+212 600 000 000',
        email: 'billing@example.com',
        taxNumber: 'IF: DEMO',
        defaultCurrency: 'MAD',
        defaultTaxRate: 20,
        vatEnabled: true,
        moroccoVatRate: 20,
        paymentTerms: 'Paiement a 30 jours.',
        ...data,
      },
      update: data,
    });
  }

  async isCompanyAssetUsedBySignedInvoice(url?: string | null) {
    if (!url) return false;

    const count = await prisma.invoice.count({
      where: {
        isSigned: true,
        OR: [{ signatureUrl: url }, { stampUrl: url }],
      },
    });

    return count > 0;
  }

  async findRecentEmailLogs(limit = 5) {
    return prisma.invoiceEmailLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            customer: {
              select: { id: true, name: true, company: true, email: true },
            },
          },
        },
        sentBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }
}

export const settingsRepository = new SettingsRepository();

import { TestEmailInput, UpdateCompanySettingsInput } from './settings.schema';
import { settingsRepository } from './settings.repository';
import { getEmailDeliveryStatus, sendEmail } from '@services/email.service';
import {
  CompanyAssetKind,
  processCompanyAssetBackground,
  removeCompanyAsset,
  removeCompanyAssetBackground,
  saveCompanyAsset,
} from './companyAssetUpload';
import { ApiError } from '@utils/ApiError';

export class SettingsService {
  async getCompanySettings() {
    return settingsRepository.getCompanySettings();
  }

  async updateCompanySettings(data: UpdateCompanySettingsInput) {
    const { signatureUrl: _signatureUrl, stampUrl: _stampUrl, ...safeData } = data;
    return settingsRepository.updateCompanySettings({
      ...safeData,
      defaultTaxRate: safeData.moroccoVatRate,
    });
  }

  async uploadCompanyAsset(kind: CompanyAssetKind, file?: Express.Multer.File) {
    if (!file) {
      throw ApiError.badRequest('Image manquante.');
    }

    const settings = await settingsRepository.getCompanySettings();
    const nextUrl = await saveCompanyAsset(file, kind);
    const previousUrl = kind === 'signature' ? settings.signatureUrl : settings.stampUrl;

    try {
      const updatedSettings = await settingsRepository.updateCompanyAsset(kind, nextUrl);
      if (!(await settingsRepository.isCompanyAssetUsedBySignedInvoice(previousUrl))) {
        await removeCompanyAsset(previousUrl);
      }
      return updatedSettings;
    } catch (error) {
      await removeCompanyAsset(nextUrl);
      throw error;
    }
  }

  async deleteCompanyAsset(kind: CompanyAssetKind) {
    const settings = await settingsRepository.getCompanySettings();
    const previousUrl = kind === 'signature' ? settings.signatureUrl : settings.stampUrl;
    const updatedSettings = await settingsRepository.updateCompanyAsset(kind, null);
    if (!(await settingsRepository.isCompanyAssetUsedBySignedInvoice(previousUrl))) {
      await removeCompanyAsset(previousUrl);
    }
    return updatedSettings;
  }

  async removeCompanyAssetBackground(kind: CompanyAssetKind) {
    const settings = await settingsRepository.getCompanySettings();
    const previousUrl = kind === 'signature' ? settings.signatureUrl : settings.stampUrl;
    const nextUrl = await removeCompanyAssetBackground(previousUrl, kind);

    try {
      const updatedSettings = await settingsRepository.updateCompanyAsset(kind, nextUrl);
      if (!(await settingsRepository.isCompanyAssetUsedBySignedInvoice(previousUrl))) {
        await removeCompanyAsset(previousUrl);
      }
      return updatedSettings;
    } catch (error) {
      await removeCompanyAsset(nextUrl);
      throw error;
    }
  }

  removeCompanyAssetBackgroundPreview(file?: Express.Multer.File) {
    return processCompanyAssetBackground(file);
  }

  getEmailStatus() {
    return getEmailDeliveryStatus();
  }

  async sendTestEmail(user: { name: string; email: string }, data: TestEmailInput) {
    const recipientEmail = data.recipientEmail ?? user.email;
    const delivery = await sendEmail({
      to: recipientEmail,
      subject: 'Test configuration email',
      text: [
        `Bonjour ${user.name},`,
        '',
        'Ceci est un email de test envoye depuis le systeme de facturation.',
        'Si le mode local est actif, ce message a ete genere dans le dossier email local configure.',
        '',
        'Configuration email validee.',
      ].join('\n'),
    });

    return {
      to: recipientEmail,
      delivery,
    };
  }
  async sendTelegramLinkCodeEmail(
  user: { name: string; email: string },
  code: string,
  expiresAt: Date
) {
  const delivery = await sendEmail({
    to: user.email,
    subject: "ERP Telegram verification code",
    text: [
      `Bonjour ${user.name},`,
      "",
      "Une demande de connexion Telegram a ete recue pour votre compte ERP.",
      "",
      `Votre code de connexion est : ${code}`,
      "",
      "Commande Telegram :",
      `/link ${code}`,
      "",
      `Ce code expire a : ${expiresAt.toLocaleString()}`,
      "Il ne peut etre utilise qu'une seule fois.",
      "",
      "Si vous n'etes pas a l'origine de cette demande, ignorez cet email.",
    ].join("\n"),
  });

  return {
    to: user.email,
    delivery,
  };
}

  async getRecentEmailLogs() {
    return settingsRepository.findRecentEmailLogs(5);
  }
}

export const settingsService = new SettingsService();

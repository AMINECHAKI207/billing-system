import { env } from '@config/env';
import { logger } from '@config/logger';
import { ApiError } from '@utils/ApiError';
import { parsePagination } from '@utils/pagination';
import { sendEmail } from '@services/email.service';
import { ReminderStatus, ReminderType } from '@prisma/client';
import { CreateReminderInput, ReminderQueryInput } from './reminder.schema';
import { reminderRepository } from './reminder.repository';

export class ReminderService {
  async createReminder(sentById: string, data: CreateReminderInput) {
    const invoice = await reminderRepository.findInvoiceForReminder(data.invoiceId);
    if (!invoice) {
      throw ApiError.notFound('Invoice');
    }

    if (invoice.status === 'DRAFT' || invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      throw ApiError.badRequest('Cannot send reminders for draft, paid or cancelled invoices');
    }

    const recipientEmail = data.recipientEmail ?? invoice.customer.email;
    const subject = data.subject ?? this.buildSubject(data.type, invoice.invoiceNumber);
    const body = data.body ?? this.buildBody(data.type, invoice);

    let status: ReminderStatus = ReminderStatus.PENDING;
    let sentAt: Date | undefined;
    let errorMessage: string | undefined;

    if (data.sendEmail) {
      try {
        const delivery = await sendEmail({ to: recipientEmail, subject, text: body });
        status = ReminderStatus.SENT;
        sentAt = new Date();
        if (delivery.mode === 'local') {
          logger.info('Reminder email generated locally', {
            invoiceId: invoice.id,
            recipientEmail,
            filePath: delivery.filePath,
          });
        }
      } catch (error) {
        status = ReminderStatus.FAILED;
        errorMessage = error instanceof Error ? error.message : 'Unknown email error';
        logger.error('Failed to send reminder email', {
          invoiceId: invoice.id,
          recipientEmail,
          error: errorMessage,
        });
      }
    }

    return reminderRepository.create({
      invoiceId: data.invoiceId,
      sentById,
      type: data.type,
      recipientEmail,
      subject,
      body,
      status,
      sentAt,
      errorMessage,
    });
  }

  async getReminders(query: ReminderQueryInput) {
    const { skip, limit, page } = parsePagination({ page: query.page, limit: query.limit });

    const { data, total } = await reminderRepository.findAll({
      skip,
      take: limit,
      where: {
        ...(query.invoiceId && { invoiceId: query.invoiceId }),
        ...(query.status && { status: query.status }),
        ...(query.type && { type: query.type }),
        ...(query.search && {
          OR: [
            { subject: { contains: query.search, mode: 'insensitive' } },
            { recipientEmail: { contains: query.search, mode: 'insensitive' } },
            { body: { contains: query.search, mode: 'insensitive' } },
            { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
            { invoice: { customer: { name: { contains: query.search, mode: 'insensitive' } } } },
            { invoice: { customer: { company: { contains: query.search, mode: 'insensitive' } } } },
          ],
        }),
      },
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createAutomaticReminderDrafts() {
    const now = new Date();
    const invoices = await reminderRepository.findInvoicesForAutomaticReminders(now);
    const created = [];
    const skipped = [];

    for (const invoice of invoices) {
      const type = invoice.dueDate < now ? ReminderType.AFTER_DUE : ReminderType.BEFORE_DUE;
      const alreadyExists =
        invoice.reminders.some((reminder) => reminder.type === type) ||
        (await reminderRepository.hasReminderOfType(invoice.id, type));

      if (alreadyExists) {
        skipped.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, type });
        continue;
      }

      const reminder = await reminderRepository.create({
        invoiceId: invoice.id,
        sentById: null,
        type,
        recipientEmail: invoice.customer.email,
        subject: this.buildSubject(type, invoice.invoiceNumber),
        body: this.buildBody(type, invoice),
        status: ReminderStatus.PENDING,
      });

      created.push(reminder);
    }

    return {
      created,
      skipped,
      createdCount: created.length,
      skippedCount: skipped.length,
    };
  }

  private buildSubject(type: ReminderType, invoiceNumber: string) {
    const prefix: Record<ReminderType, string> = {
      BEFORE_DUE: 'Rappel avant echeance',
      ON_DUE: 'Facture arrivee a echeance',
      AFTER_DUE: 'Facture en retard',
      MANUAL: 'Rappel de paiement',
    };

    return `${prefix[type]} - ${invoiceNumber}`;
  }

  private buildBody(
    type: ReminderType,
    invoice: Awaited<ReturnType<typeof reminderRepository.findInvoiceForReminder>>
  ) {
    if (!invoice) return '';

    const company = invoice.customer.company ?? invoice.customer.name;
    const balance = new Intl.NumberFormat('fr-MA', {
      style: 'currency',
      currency: invoice.currency,
      minimumFractionDigits: 2,
    }).format(Number(invoice.balanceDue));
    const dueDate = new Intl.DateTimeFormat('fr-MA').format(invoice.dueDate);
    const intro =
      type === ReminderType.AFTER_DUE
        ? 'Sauf erreur de notre part, cette facture est actuellement en retard.'
        : 'Nous vous rappelons cette facture pour faciliter son suivi.';

    return [
      `Bonjour ${company},`,
      '',
      intro,
      `Facture: ${invoice.invoiceNumber}`,
      `Date d'echeance: ${dueDate}`,
      `Solde restant: ${balance}`,
      '',
      'Merci de proceder au reglement ou de nous contacter si un paiement est deja en cours.',
      '',
      'Cordialement,',
      env.COMPANY_NAME,
    ].join('\n');
  }
}

export const reminderService = new ReminderService();

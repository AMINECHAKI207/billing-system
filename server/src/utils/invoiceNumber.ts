import { prisma } from '@config/database';

/**
 * Invoice Number Generator
 *
 * Generates sequential, human-readable invoice numbers:
 *   INV-2024-0001
 *   INV-2024-0002
 *   INV-2025-0001  ← resets each year
 *
 * WHY: Plain UUID invoice IDs are ugly on PDFs and hard to
 * reference in emails/phone calls. "Invoice INV-2024-0042"
 * is what customers actually say.
 *
 * CONCURRENCY SAFETY: the yearly sequence row is updated atomically
 * by the database, so simultaneous invoice creations cannot reuse
 * the same number.
 */
export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const sequence = await prisma.invoiceSequence.upsert({
    where: { year },
    create: {
      year,
      nextNumber: 2,
    },
    update: {
      nextNumber: {
        increment: 1,
      },
    },
  });

  const invoiceNumber = String(sequence.nextNumber - 1).padStart(4, '0');

  return `${prefix}${invoiceNumber}`;
}

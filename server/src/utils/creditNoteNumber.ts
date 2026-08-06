import { prisma } from '@config/database';

export async function generateCreditNoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const sequence = await prisma.creditNoteSequence.upsert({
    where: { year },
    create: { year, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });

  return `CN-${year}-${String(sequence.nextNumber - 1).padStart(4, '0')}`;
}

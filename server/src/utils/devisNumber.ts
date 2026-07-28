import { prisma } from '@config/database';

export async function generateDevisNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DEV-${year}-`;

  const sequence = await prisma.devisSequence.upsert({
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

  const devisNumber = String(sequence.nextNumber - 1).padStart(4, '0');

  return `${prefix}${devisNumber}`;
}

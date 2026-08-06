import { prisma } from '@config/database';

export async function generateContractNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const sequence = await prisma.contractSequence.upsert({
    where: { year },
    create: { year, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });

  return `CTR-${year}-${String(sequence.nextNumber - 1).padStart(4, '0')}`;
}

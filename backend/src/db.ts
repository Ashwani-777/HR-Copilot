import { PrismaClient } from '@prisma/client';

// Query errors are thrown and handled (e.g. unique violation → 409 ALREADY_CHECKED_IN); unexpected
// ones are logged by the central error handler, so Prisma itself only prints warnings.
export const prisma = new PrismaClient({ log: [{ level: 'warn', emit: 'stdout' }] });

export async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed — the minimum reference data the app cannot run without, plus a test
 * admin for walking the loop.
 *
 * Run: node prisma/seed.mjs
 *
 * Idempotent: upserts throughout, safe to run repeatedly.
 *
 * The zones are REAL reference data and belong in every environment — the
 * onboarding form offers them, and a farm without a zone cannot be assessed
 * for movement feasibility. The admin user is test scaffolding: it is only
 * created when SEED_ADMIN_PHONE is set, so production seeds zones alone.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Botswana's veterinary disease-control zones, simplified to the ones the
// pilot region touches. Extend as coverage grows; codes follow DVS usage.
const ZONES = [
  { code: 'Z6', name: 'Zone 6 — Central (Serowe/Palapye)' },
  { code: 'Z3', name: 'Zone 3 — North East' },
  { code: 'Z7', name: 'Zone 7 — Kgatleng' },
  { code: 'Z8', name: 'Zone 8 — South East (Gaborone)' },
  { code: 'Z9', name: 'Zone 9 — Southern' },
];

async function main() {
  for (const zone of ZONES) {
    await prisma.zone.upsert({
      where: { code: zone.code },
      create: zone,
      update: { name: zone.name },
    });
  }
  console.log(`Zones: ${ZONES.length} upserted`);

  // Test admin — only when explicitly asked for. Sign in with this phone via
  // the normal OTP flow; the role is already on the record when you do.
  const adminPhone = process.env.SEED_ADMIN_PHONE;
  if (adminPhone) {
    const e164 = adminPhone.startsWith('+') ? adminPhone : `+267${adminPhone.replace(/^0/, '')}`;
    await prisma.user.upsert({
      where: { phone: e164 },
      create: { phone: e164, roles: ['ADMIN'], tier: 'T2_VERIFIED_FARMER', fullName: 'Test Admin' },
      update: { roles: ['ADMIN'] },
    });
    console.log(`Admin: ${e164} (sign in via OTP as normal)`);
  } else {
    console.log('Admin: skipped (set SEED_ADMIN_PHONE to create one)');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Seed script for load testing: creates N users under a dedicated
 * "Load Test" organization, all emailed loadtest-<n>@isa-test.local.
 * The email prefix is the cleanup key — see loadtest-cleanup.ts.
 *
 * Usage:
 *   LOADTEST_COUNT=1001 npx tsx prisma/loadtest-seed.ts
 */
import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const COUNT = Number(process.env.LOADTEST_COUNT ?? 1001)
const PASSWORD = process.env.LOADTEST_PASSWORD ?? 'LoadTest#2026'
const EMAIL_PREFIX = 'loadtest-'
const EMAIL_DOMAIN = '@isa-test.local'
const ORG_NAME = 'Load Test'

async function main() {
  const hash = bcrypt.hashSync(PASSWORD, 10)

  const org = await prisma.organization.upsert({
    where: { id: 'loadtest-org' },
    update: { active: true, deleted_at: null },
    create: { id: 'loadtest-org', name: ORG_NAME, tier: 'bronze', active: true },
  })

  console.log(`Seeding ${COUNT} load-test users into org "${org.name}" (${org.id})...`)

  for (let i = 1; i <= COUNT; i++) {
    const email = `${EMAIL_PREFIX}${i}${EMAIL_DOMAIN}`
    await prisma.user.upsert({
      where: { email },
      update: { active: true, deleted_at: null, org_id: org.id },
      create: {
        name: `Load Test User ${i}`,
        email,
        password: hash,
        role: Role.user,
        org_id: org.id,
        active: true,
      },
    })
    if (i % 100 === 0) console.log(`  ${i}/${COUNT}`)
  }

  console.log('Done. Login credentials: loadtest-<n>@isa-test.local / ' + PASSWORD)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

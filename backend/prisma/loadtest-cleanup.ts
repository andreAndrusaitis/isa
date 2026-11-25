/**
 * Cleanup script for load testing: deletes everything created by
 * loadtest-seed.ts (org "loadtest-org" + users emailed loadtest-*@isa-test.local)
 * and any tickets they created. Real users/orgs are untouched — filtered
 * strictly by the loadtest org id and email prefix.
 *
 * Usage:
 *   npx tsx prisma/loadtest-cleanup.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const ORG_ID = 'loadtest-org'
const EMAIL_PREFIX = 'loadtest-'
const EMAIL_DOMAIN = '@isa-test.local'

async function main() {
  const users = await prisma.user.findMany({
    where: { org_id: ORG_ID, email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  })
  const userIds = users.map(u => u.id)
  console.log(`Found ${userIds.length} load-test users to remove.`)

  if (userIds.length > 0) {
    const tickets = await prisma.ticket.findMany({
      where: { user_id: { in: userIds } },
      select: { id: true },
    })
    const ticketIds = tickets.map(t => t.id)
    console.log(`Deleting ${ticketIds.length} load-test tickets...`)

    if (ticketIds.length > 0) {
      await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } })
      await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } })
      await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    }

    await prisma.refreshToken.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }

  await prisma.organization.deleteMany({ where: { id: ORG_ID } })
  console.log('Load-test data removed.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

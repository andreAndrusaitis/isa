// Load test for ISA — simulates real user flow: login, browse tickets,
// open a wizard ticket, view it, add a message.
//
// Requires 1001+ users pre-seeded via `LOADTEST_COUNT=1001 npx tsx backend/prisma/loadtest-seed.ts`.
// Run locally:            k6 run k6/load-test.js
// Run via Azure Load Testing: upload this file as the test script .
//
// Env vars:
//   BASE_URL      backend URL, e.g. https://api.example.com (no trailing slash)
//   VUS           target concurrent virtual users (default 1001)
//   RAMP_TIME     time to ramp up to VUS (default 5m)
//   HOLD_TIME     time to hold at VUS (default 5m)

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const VUS = Number(__ENV.VUS || 1001)
const RAMP_TIME = __ENV.RAMP_TIME || '5m'
const HOLD_TIME = __ENV.HOLD_TIME || '5m'
const PASSWORD = __ENV.LOADTEST_PASSWORD || 'LoadTest#2026'

export const errors = new Counter('app_errors')

export const options = {
  stages: [
    { duration: RAMP_TIME, target: VUS },
    { duration: HOLD_TIME, target: VUS },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
}

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}

export default function () {
  // __VU is 1-based and unique per virtual user for the run's lifetime.
  const email = `loadtest-${__VU}@isa-test.local`

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
  })
  const loginOk = check(loginRes, { 'login 200': (r) => r.status === 200 })
  if (!loginOk) { errors.add(1); sleep(1); return }

  const token = loginRes.json('data.accessToken')
  if (!token) { errors.add(1); sleep(1); return }

  sleep(1)

  // Browse: list own tickets
  const listRes = http.get(`${BASE_URL}/api/tickets`, authHeaders(token))
  check(listRes, { 'list tickets 200': (r) => r.status === 200 }) || errors.add(1)

  sleep(1)

  // Wizard: categories -> pick first category + subcategory
  const catRes = http.get(`${BASE_URL}/api/categories`, authHeaders(token))
  check(catRes, { 'categories 200': (r) => r.status === 200 }) || errors.add(1)

  let categoryId = null
  let subcategoryId = null
  const categories = catRes.json('data')
  if (Array.isArray(categories) && categories.length > 0) {
    categoryId = categories[0].id
    const subs = categories[0].subcategories
    if (Array.isArray(subs) && subs.length > 0) subcategoryId = subs[0].id
  }

  sleep(1)

  // Open a ticket
  const createRes = http.post(`${BASE_URL}/api/tickets`, JSON.stringify({
    title: `[LOADTEST] Ticket VU ${__VU} iter ${__ITER}`,
    description: 'Ticket gerado por teste de carga k6 — seguro para exclusão.',
    priority: 'low',
    category_id: categoryId,
    subcategory_id: subcategoryId,
  }), authHeaders(token))
  const createOk = check(createRes, { 'create ticket 201': (r) => r.status === 201 || r.status === 200 })
  if (!createOk) errors.add(1)

  const ticketId = createOk ? createRes.json('data.id') : null

  sleep(2)

  if (ticketId) {
    const getRes = http.get(`${BASE_URL}/api/tickets/${ticketId}`, authHeaders(token))
    check(getRes, { 'get ticket 200': (r) => r.status === 200 }) || errors.add(1)

    sleep(1)

    const msgRes = http.post(`${BASE_URL}/api/tickets/${ticketId}/messages`, JSON.stringify({
      text: 'Mensagem de teste de carga.',
    }), authHeaders(token))
    check(msgRes, { 'add message 2xx': (r) => r.status >= 200 && r.status < 300 }) || errors.add(1)
  }

  sleep(3)
}

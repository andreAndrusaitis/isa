import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Roda o seed de verdade em outro processo. Nenhum caso chega a um banco: ou a guarda
// para antes, ou a conexão recusa na porta 1 do loopback (.invalid nunca resolve).
const BACKEND = path.resolve(__dirname, '..')
const TSX = pathToFileURL(path.join(BACKEND, 'node_modules/tsx/dist/loader.mjs')).href
const REMOTE = 'postgresql://u:p@banco.invalid:5432/x'
const LOCAL = 'postgresql://u:p@127.0.0.1:1/x'
const BLOCKED = 'SEED_TARGET_BLOCKED'

const tempDirs: string[] = []
function emptyDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'seed-guard-'))
  tempDirs.push(dir)
  return dir
}

function runSeed(env: Record<string, string>, cwd = emptyDir()) {
  const { DATABASE_URL, DIRECT_URL, NODE_ENV, DOTENV_CONFIG_PATH, SEED_ALLOW_NON_LOCAL, ...base } = process.env
  const result = spawnSync(process.execPath, ['--import', TSX, path.join(BACKEND, 'prisma/seed.ts')], {
    cwd, env: { ...base, ...env }, encoding: 'utf8', timeout: 60_000,
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const db = (url: string) => ({ DATABASE_URL: url, DIRECT_URL: url })

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('guarda do seed', () => {
  it('recusa banco que não é local antes de gravar qualquer coisa', () => {
    const r = runSeed(db(REMOTE))
    expect(r.status).toBe(1)
    expect(r.output).toContain(BLOCKED)
    expect(r.output).not.toContain('Seeding database')
  }, 90_000)

  it('recusa NODE_ENV=production mesmo em banco local', () => {
    const r = runSeed({ ...db(LOCAL), NODE_ENV: 'production' })
    expect(r.status).toBe(1)
    expect(r.output).toContain(BLOCKED)
  }, 90_000)

  it('recusa quando não sabe qual é o banco', () => {
    expect(runSeed({}).output).toContain(BLOCKED)
  }, 90_000)

  it('enxerga o banco do .env quando DATABASE_URL não vem do ambiente', () => {
    const cwd = emptyDir()
    writeFileSync(path.join(cwd, '.env'), `DATABASE_URL="${LOCAL}"\nDIRECT_URL="${LOCAL}"\n`)
    const r = runSeed({}, cwd)
    expect(r.output).not.toContain(BLOCKED)
    expect(r.output).toContain('Seeding database')
  }, 90_000)

  it('deixa passar banco local fora de produção', () => {
    const r = runSeed(db(LOCAL))
    expect(r.output).not.toContain(BLOCKED)
    expect(r.output).toContain('Seeding database')
  }, 90_000)

  it('SEED_ALLOW_NON_LOCAL=true libera de propósito, com aviso', () => {
    const r = runSeed({ ...db(LOCAL), NODE_ENV: 'production', SEED_ALLOW_NON_LOCAL: 'true' })
    expect(r.output).not.toContain(BLOCKED)
    expect(r.output).toContain('SEED_ALLOW_NON_LOCAL=true')
    expect(r.output).toContain('Seeding database')
  }, 90_000)
})

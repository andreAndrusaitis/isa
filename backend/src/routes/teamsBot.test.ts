import { describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createBotAdapter } from '../teams/bot/adapter'
import { botConfig } from '../teams/bot/config'
import { createTeamsBotRouter } from './teamsBot'

function appWith(router: express.Router) {
  const app = express()
  app.use(express.json())
  app.use('/api/teams', router)
  return app
}

const activity = { type: 'message', text: 'oi', conversation: { id: 'c1' }, serviceUrl: 'https://smba.trafficmanager.net/br/', channelId: 'msteams' }

describe('POST /api/teams/messages', () => {
  it('bot desligado (sem chaves) responde 503 sem processar nada', async () => {
    const res = await request(appWith(createTeamsBotRouter({ adapter: () => null }))).post('/api/teams/messages').send(activity)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('TEAMS_BOT_DISABLED')
  })

  it('no app real, sem TEAMS_BOT_* no ambiente, a rota existe e responde 503', async () => {
    const { default: app } = await import('../app')
    const res = await request(app).post('/api/teams/messages').send(activity)
    expect(res.status).toBe(503)
  }, 60_000)

  it('bot ligado sem token do Bot Framework: 401 do SDK, sem chegar ao bot', async () => {
    const config = { enabled: true, appId: '11111111-1111-4111-8111-111111111111', password: 'segredo', homeTenant: 'aaaaaaaa-4444-4444-8444-444444444444', tenants: ['aaaaaaaa-4444-4444-8444-444444444444'], portalUrl: 'https://portal.test' }
    const assistant = vi.fn()
    const router = createTeamsBotRouter({ adapter: () => createBotAdapter(config), bot: { config: () => config, assistant } })
    const res = await request(appWith(router)).post('/api/teams/messages').send(activity)
    expect(res.status).toBe(401)
    expect(assistant).not.toHaveBeenCalled()

    const forged = await request(appWith(router)).post('/api/teams/messages').set('Authorization', 'Basic abc').send(activity)
    expect(forged.status).toBe(401)
  })
})

describe('botConfig', () => {
  const base = { PORTAL_URL: 'https://portal.test/' } as any

  it('desligado sem as três chaves', () => {
    expect(botConfig({ ...base, TEAMS_BOT_ENABLED: true, TEAMS_BOT_APP_ID: 'a', TEAMS_BOT_APP_PASSWORD: 'b' }).enabled).toBe(false)
  })

  it('ligado com as chaves; lista de tenants em minúsculas, o primeiro é o do app', () => {
    const c = botConfig({ ...base, TEAMS_BOT_ENABLED: true, TEAMS_BOT_APP_ID: 'a', TEAMS_BOT_APP_PASSWORD: 'b', TEAMS_BOT_TENANT_ID: 'AAAAAAAA-4444-4444-8444-444444444444, outro' })
    expect(c).toMatchObject({ enabled: true, homeTenant: 'aaaaaaaa-4444-4444-8444-444444444444', tenants: ['aaaaaaaa-4444-4444-8444-444444444444', 'outro'], portalUrl: 'https://portal.test' })
  })

  it('TEAMS_BOT_ENABLED=false desliga mesmo com as chaves', () => {
    expect(botConfig({ ...base, TEAMS_BOT_ENABLED: false, TEAMS_BOT_APP_ID: 'a', TEAMS_BOT_APP_PASSWORD: 'b', TEAMS_BOT_TENANT_ID: 't' }).enabled).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { roleDenied, areaDenied, TICKET_DENIAL } from './denials'

describe('denials', () => {
  it('roleDenied lista os papéis permitidos (sem admin) e o perfil atual', () => {
    const e = roleDenied(['agent', 'supervisor', 'admin'], 'user')
    expect(e.statusCode).toBe(403)
    expect(e.code).toBe('ROLE_NOT_ALLOWED')
    expect(e.message).toBe('Esta ação é permitida apenas para Analista e Ticket Manager. Seu perfil é Usuário final.')
  })

  it('areaDenied cita a permissão pelo nome e onde pedir', () => {
    const e = areaDenied('queues', 'agent')
    expect(e.code).toBe('PERMISSION_REQUIRED')
    expect(e.message).toContain('"Filas de Atendimento"')
    expect(e.message).toContain('Analista')
    expect(e.message).toContain('Usuários › Permissões')
  })

  it('ORG_OUT_OF_SCOPE cita a empresa', () => {
    expect(TICKET_DENIAL.ORG_OUT_OF_SCOPE('Acme')).toContain('empresa Acme')
  })

  it('QUEUE_NOT_ASSIGNED cita a fila', () => {
    expect(TICKET_DENIAL.QUEUE_NOT_ASSIGNED('N2')).toContain('fila N2')
  })
})

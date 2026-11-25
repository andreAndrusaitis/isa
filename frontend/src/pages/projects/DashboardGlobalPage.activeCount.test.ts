import { describe, expect, it } from 'vitest'
import { countActiveProjects } from './DashboardGlobalPage'

// Só projetos com 1 ou mais tasks abertas entram em "Projetos Ativos".
describe('countActiveProjects', () => {
  it('conta só projetos com task aberta', () => {
    expect(countActiveProjects([{ openTasks: 3 }, { openTasks: 0 }, { openTasks: 1 }])).toBe(2)
  })

  it('projeto sem o número (resposta antiga) não conta', () => {
    expect(countActiveProjects([{ openTasks: undefined }, {}])).toBe(0)
  })

  it('lista vazia dá zero', () => {
    expect(countActiveProjects([])).toBe(0)
  })
})

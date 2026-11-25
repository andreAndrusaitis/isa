import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { richText } from './linkify'

describe('richText', () => {
  it('**texto** vira negrito e o resto continua texto/link', () => {
    const { container } = render(<div>{richText('**Tipo:** Incidente em https://x.com <b>não</b>')}</div>)
    expect(container.querySelector('strong')?.textContent).toBe('Tipo:')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://x.com')
    // HTML do texto não é interpretado
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>não</b>')
  })
})

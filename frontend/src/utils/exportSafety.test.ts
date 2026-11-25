import { describe, expect, it } from 'vitest'
import { csvCell, escapeHtml } from './exportSafety'

describe('escapeHtml', () => {
  it('neutraliza marcação e atributos', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(escapeHtml("a'b&c")).toBe('a&#39;b&amp;c')
  })

  it('não altera texto comum nem acentos', () => {
    expect(escapeHtml('Configuração da impressão — ação nº 3')).toBe('Configuração da impressão — ação nº 3')
  })

  it('nulo vira vazio e número vira texto', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(0)).toBe('0')
  })
})

describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
    ['+1+1', `"'+1+1"`],
    ['-1+cmd', `"'-1+cmd"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\tTAB', `"'\tTAB"`],
    ['\rCR', `"'\rCR"`],
    ['  =1+1', `"'  =1+1"`],
    ['\n=1+1', `"'\n=1+1"`],
  ])('prefixa apóstrofo em %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected)
  })

  it('não mexe em número, nem negativo, nem vindo como texto', () => {
    expect(csvCell(-5)).toBe('"-5"')
    expect(csvCell(-1.5)).toBe('"-1.5"')
    expect(csvCell('-5')).toBe('"-5"')
    expect(csvCell('-1.234,56')).toBe('"-1.234,56"')
    expect(csvCell('+5511999990000')).toBe('"+5511999990000"')
  })

  it('texto comum só ganha as aspas do CSV', () => {
    expect(csvCell('Impressora não liga')).toBe('"Impressora não liga"')
    expect(csvCell('disse "oi"')).toBe('"disse ""oi"""')
    expect(csvCell('a=b')).toBe('"a=b"')
    expect(csvCell(null)).toBe('""')
  })
})

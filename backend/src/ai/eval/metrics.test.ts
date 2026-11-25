import { describe, it, expect } from 'vitest'
import { accuracy, riskCoverage, ece, brier, percentile, DEFAULT_THRESHOLDS } from './metrics'

const s = (confidence: number, correct: boolean) => ({ confidence, correct })

describe('metrics', () => {
  it('accuracy é a fração de acertos (NaN sem amostras)', () => {
    expect(accuracy([s(0.9, true), s(0.2, false), s(0.5, true), s(0.5, true)])).toBe(0.75)
    expect(accuracy([])).toBeNaN()
  })

  it('riskCoverage: cobertura = fração com confiança >= limiar; acerto só entre as cobertas', () => {
    const samples = [s(0.95, true), s(0.9, true), s(0.8, false), s(0.6, true), s(0.3, false)]
    const rows = riskCoverage(samples, [0.5, 0.9, 0.99])
    expect(rows).toEqual([
      { threshold: 0.5, coverage: 0.8, accuracy: 0.75 },
      { threshold: 0.9, coverage: 0.4, accuracy: 1 },
      { threshold: 0.99, coverage: 0, accuracy: NaN },
    ])
  })

  it('riskCoverage usa os limiares padrão', () => {
    expect(riskCoverage([s(1, true)]).map(r => r.threshold)).toEqual(DEFAULT_THRESHOLDS)
    expect(DEFAULT_THRESHOLDS).toEqual([0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95])
  })

  it('ece é 0 quando a confiança bate com o acerto de cada bin', () => {
    expect(ece([s(1, true), s(1, true), s(0, false)])).toBeCloseTo(0)
    expect(ece([s(0.75, true), s(0.75, true), s(0.75, true), s(0.75, false)])).toBeCloseTo(0)
  })

  it('ece pondera |acerto − confiança| pelo tamanho do bin; confiança 1.0 cai no último bin', () => {
    // bin 0.9–1.0: conf média 0.95, acerto 0 → 0.95 × 2/4; bin 0.1–0.2: conf 0.15, acerto 1 → 0.85 × 2/4
    expect(ece([s(0.9, false), s(1, false), s(0.1, true), s(0.2 - 1e-9, true)])).toBeCloseTo(0.9)
  })

  it('brier é o erro quadrático médio da confiança contra o acerto', () => {
    expect(brier([s(1, true), s(0, false)])).toBe(0)
    expect(brier([s(0.8, true), s(0.4, false)])).toBeCloseTo((0.04 + 0.16) / 2)
  })

  it('percentile interpola linearmente e não depende da ordem', () => {
    expect(percentile([3, 1, 2, 4], 50)).toBe(2.5)
    expect(percentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48)
    expect(percentile([7], 95)).toBe(7)
    expect(percentile([], 50)).toBeNaN()
  })
})

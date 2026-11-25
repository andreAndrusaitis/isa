/** Métricas da avaliação offline: acerto, cobertura × acerto e calibração. */
export interface Sample { confidence: number; correct: boolean }
export interface CoverageRow { threshold: number; coverage: number; accuracy: number }

export const DEFAULT_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95]

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export function accuracy(samples: Sample[]): number {
  return mean(samples.map(s => (s.correct ? 1 : 0)))
}

export function riskCoverage(samples: Sample[], thresholds = DEFAULT_THRESHOLDS): CoverageRow[] {
  return thresholds.map(threshold => {
    const covered = samples.filter(s => s.confidence >= threshold)
    return { threshold, coverage: samples.length ? covered.length / samples.length : NaN, accuracy: accuracy(covered) }
  })
}

/** Expected Calibration Error com bins de largura igual; confiança 1.0 cai no último. */
export function ece(samples: Sample[], bins = 10): number {
  const groups: Sample[][] = Array.from({ length: bins }, () => [])
  for (const s of samples) groups[Math.min(bins - 1, Math.floor(s.confidence * bins))].push(s)
  return groups.reduce((sum, g) =>
    g.length ? sum + Math.abs(accuracy(g) - mean(g.map(s => s.confidence))) * g.length / samples.length : sum, 0)
}

export function brier(samples: Sample[]): number {
  return mean(samples.map(s => (s.confidence - (s.correct ? 1 : 0)) ** 2))
}

/** Percentil p (0–100) com interpolação linear entre os vizinhos. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo)
}

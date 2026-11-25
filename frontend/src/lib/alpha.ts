/** Cor com transparência que também aceita var(--token): alpha('var(--blue-500)', 12) */
export const alpha = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

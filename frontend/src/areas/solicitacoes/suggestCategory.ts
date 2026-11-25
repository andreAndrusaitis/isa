/** Palpite de categoria a partir da frase do cliente, sem IA: palavras em comum com nome e descrição. */
interface Sub { id: string; name: string; description?: string | null }
interface Cat extends Sub { subcategories?: Sub[] }

const STOP = new Set('a o as os um uma de da do das dos em no na nos nas e ou que se com sem por para meu minha nao não esta está estou tem ter foi ser muito mais ja já quando como desde isso ele ela eu me ao aos'.split(' '))
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Raiz curta: "senhas" e "senha", "instalar" e "instalação" caem juntas.
const words = (s: string) => [...new Set(plain(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.slice(0, 5)))]

export function suggestCategories(text: string, categories: Cat[], limit = 3): { category: Cat; subcategory?: Sub }[] {
  const said = words(text)
  if (!said.length) return []
  const score = (item: Sub) => {
    const name = words(item.name), desc = words(item.description ?? '')
    return said.reduce((n, w) => n + (name.includes(w) ? 3 : desc.includes(w) ? 1 : 0), 0)
  }
  return categories
    .flatMap(category => [
      { category, subcategory: undefined as Sub | undefined, points: score(category) },
      ...(category.subcategories ?? []).map(subcategory => ({ category, subcategory, points: score(subcategory) + score(category) / 2 })),
    ])
    // Uma palavra solta da descrição é coincidência, não palpite.
    .filter(x => x.points >= 2)
    .sort((a, b) => b.points - a.points)
    .filter((x, i, all) => all.findIndex(y => y.category.id === x.category.id) === i)
    .slice(0, limit)
    .map(({ category, subcategory }) => (subcategory ? { category, subcategory } : { category }))
}

/** Título curto: a primeira frase, cortada em palavra inteira. */
export function titleFrom(text: string, max = 80): string {
  const first = text.trim().split(/[.!?\n]/)[0].trim()
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20))}…`
}

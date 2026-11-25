import {
  ArrowRight, AppWindow, Boxes, CircleHelp, CreditCard, Database, FileText, Headset, KeyRound, Laptop, Mail, MonitorSmartphone, Phone, Printer, ShieldCheck, Users, Wifi, Wrench,
} from 'lucide-react'

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** Ícone pelo nome da categoria; a primeira que casar vence. */
const ICONS: [RegExp, any][] = [
  [/acesso|senha|conta|login|permiss/, KeyRound], [/e-?mail|correio|colabora|outlook/, Mail], [/rede|vpn|wi-?fi|internet|conex/, Wifi],
  [/impress/, Printer], [/telef|ramal|voip/, Phone], [/celular|movel|tablet/, MonitorSmartphone], [/equip|notebook|computador|desktop|hardware|monitor/, Laptop],
  [/seguran|virus|antivirus|phish/, ShieldCheck], [/banco de dados|dados|relatorio/, Database], [/sistema|erp|crm|software|aplica|programa/, AppWindow],
  [/financ|pagamento|fatura|cobran/, CreditCard], [/rh|pessoa|recursos humanos|usuario/, Users], [/document|contrato/, FileText],
  [/manuten|predial|infra/, Wrench], [/compra|estoque|patrim|almox/, Boxes], [/atend|suporte|geral|duvida/, Headset],
]
export const iconFor = (name: string) => ICONS.find(([re]) => re.test(plain(name)))?.[1] ?? CircleHelp

/** Quadro com o ícone da categoria, na cor dela (ou a imagem cadastrada). */
export function CategoryIcon({ category, size = 48 }: { category: { name: string; color?: string | null; icon?: string | null; image_url?: string | null }; size?: number }) {
  const image = category.image_url || (category.icon?.startsWith('data:image') ? category.icon : null)
  const Icon = iconFor(category.name)
  return (
    <span className="cat-icon" aria-hidden style={{ width: size, height: size, '--tone': category.color || 'var(--c1)' } as React.CSSProperties}>
      {image ? <img src={image} alt="" /> : <Icon size={Math.round(size * 0.48)} strokeWidth={1.9} />}
    </span>
  )
}

/** Cartão de assunto: ícone, nome e o que existe dentro. */
export function CategoryCard({ category, on, onPick }: { category: any; on?: boolean; onPick: () => void }) {
  const inside = (category.subcategories ?? []).slice(0, 3).map((s: any) => s.name).join(', ')
  return (
    <button type="button" className="cl-cat" data-on={on || undefined} onClick={onPick}>
      <CategoryIcon category={category} />
      <span><b>{category.name}</b>{(category.description || inside) && <small>{category.description || inside}</small>}</span>
      <ArrowRight size={17} aria-hidden />
    </button>
  )
}

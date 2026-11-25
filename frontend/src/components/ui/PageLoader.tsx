import { createPortal } from 'react-dom'
import { Loading } from './Loading'

/**
 * Carregamento de tela cheia (troca de módulo, chunk lazy, gates).
 * Só aparece após 300ms: carga vinda do cache não pisca a tela.
 * Portal no body porque o PageTransition deixa transform no wrapper e prenderia o fixed.
 */
export function PageLoader({ label }: { label?: string }) {
  return createPortal(<Loading label={label} delay={300} className="page-loader" />, document.body)
}

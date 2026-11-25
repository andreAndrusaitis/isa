import { Modal } from '@/components/ui'
import { SurveyTemplate } from '@/services/surveyService'
import { SurveyFlow } from '../../pages/survey/SurveyFlow'

const PREVIEW_TICKET = { id: '#1000', title: 'Chamado de exemplo' }

/**
 * Mostra ao admin exatamente o fluxo que o cliente final vê ao responder a pesquisa
 * (resolução → perguntas → reabertura), usando um chamado fictício. Nada é enviado à API.
 */
export function SurveyPreviewModal({
  isOpen,
  onClose,
  template
}: {
  isOpen: boolean
  onClose: () => void
  template: SurveyTemplate
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Visualização da pesquisa" width={680}>
      <SurveyFlow
        template={template}
        ticket={PREVIEW_TICKET}
        onSubmit={async () => {}}
      />
    </Modal>
  )
}

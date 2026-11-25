# IA e automações

## Nome da IA

- Fala com o usuário: **Skadi** (portal, Teams, sugestão na abertura, perguntas e orientação). Nome e assinatura em `ai/core/persona.ts` e `frontend/src/utils/skadi.ts`.
- Roda por dentro do sistema: sem nome, sem primeira pessoa. Use "IA" ou o nome da função.
- A Skadi nunca finge ser humana. Mensagens dela no chamado são gravadas pelo usuário de sistema com a assinatura.

## Para quem a Skadi fala

Usuário comum, sem acesso de administrador (`END_USER_SCOPE`):

- linguagem simples e passos curtos;
- nada que exija administrador (instalar, atualizar, registro, portais de administração, licenças). Nesses casos ela oferece abrir um chamado;
- nunca pede senha, código ou dado de pagamento.

## Agentes

| Agente | Modo padrão | Comportamento |
|---|---|---|
| `knowledge` | desligado | Antes da abertura, sugere a solução a partir dos artigos que a pessoa pode ver. Aceitar cria um chamado já resolvido, sem fila, SLA ou pesquisa |
| `triage` | desligado | Tipo, categoria, subcategoria, urgência e impacto. Regras de roteamento sempre prevalecem |
| `intake` | desligado | Confere o checklist do tipo e pergunta o que falta (até 3 perguntas). Na dúvida, não pergunta |
| `guidance` | desligado | Passos de autoatendimento da base de resoluções e do Microsoft Learn, e aviso de chamado parecido |
| `resolution` | ligado à orientação | Transforma chamado fechado em cartão da base de resoluções |

- Modos: `off`, `shadow` (executa e registra, sem efeito) e `apply`. O padrão inicial vem do ambiente (`AI_TRIAGE_MODE`, `AI_INTAKE_MODE`, `AI_GUIDANCE_MODE`); depois vale a tela Agentes de IA.
- Rigor: conservador, equilibrado ou ousado. Muda os limiares de confiança e margem.
- Triagem, completude e orientação rodam em sequência, em segundo plano. Uma falha nunca impede a abertura.
- Texto com pouca informação, teste, resposta solta ou comunicado automático não altera o chamado.
- Categoria escolhida pelo solicitante só é trocada com 95% de confiança.

## Base de conhecimento

- Artigos são divididos em trechos com embedding de 1536 posições (pgvector, índice HNSW).
- O acesso segue empresa, plano e categoria, menos os bloqueios da empresa.
- Resposta com documento, senha ou pedido de credencial é descartada.
- Perguntas sem resposta e avaliações "não útil" viram lacunas, agrupadas por assunto.

## Privacidade

- `maskPII` troca CPF, CNPJ, RG, e-mail, telefone, CEP e senhas antes de enviar ao modelo. Nomes próprios e endereços livres não são detectados.
- Com a IA desligada, nada é enviado ao provedor.

## Regras de roteamento

- Gatilhos: chamado criado, atualizado, reaberto, mensagem do cliente e chamado parado há X horas.
- Condições: solicitante, domínio, empresa, plano, categoria, texto, prioridade, fila, tipo, status, responsável, horário comercial, reaberto.
- Ações: fila, prioridade, tipo, status, categoria, responsável, participante, macro, notificação, webhook, task de projeto, lixeira e parar.
- As regras rodam por prioridade. Por padrão, a primeira que casa (ou executa o "senão") encerra; isso pode ser desligado em cada regra.
- Quem tem carteira restrita só grava regra limitada às próprias empresas. Excluir chamado e disparar webhook exigem a permissão correspondente.

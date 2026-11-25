# SLA e escalonamento

## Prazos

- O plano da empresa define as horas de 1ª resposta e de resolução para cada tipo de chamado. Sem plano: 4 h e 24 h.
- Os prazos contam só em horário comercial (Configurações → Expediente; padrão 08:00–18:00, segunda a sexta, `America/Sao_Paulo`). Feriados nacionais são calculados por `date-holidays`.
- Todo chamado nasce como Incidente. Trocar o tipo recalcula os prazos desde a abertura, somando o tempo já pausado.
- Mudar o plano ou o horário vale só para novos cálculos.
- Código: `utils/businessHours.ts`, `services/tickets.ts`, `services/ticketTypeChange.ts`.

| Plano do seed | 1ª resposta | Resolução |
|---|---|---|
| bronze | 24 h | 96 h |
| silver | 8 h | 32 h |
| gold | 4 h | 16 h |
| platinum | 2 h | 8 h |

São valores de exemplo, editáveis em Configurações → Planos.

## Pausa

Em Pendente o relógio para. Ao sair, os dois prazos crescem pelos minutos úteis parados e o total fica em `total_paused_minutes`. Vários ciclos são somados. Veja [pendências](pendencias.md).

## Escalonamento automático

`jobs/slaChecker.ts`, a cada minuto:

- pega chamados Abertos ou Em Atendimento, ainda não escalonados, a menos de X minutos úteis do prazo (`escalation_minutes` do plano, padrão 30);
- move para a fila de escalação do plano (se ela não existir, o chamado fica sem fila), marca como escalonado e sobe a prioridade para Alta;
- grava evento e auditoria e emite `sla.warning` e `ticket.escalated`.

Pendentes não entram.

## Escalonamento manual

A pessoa escolhe uma regra ativa (`services/escalation.ts`):

| Tipo | O que faz |
|---|---|
| `transfer` | Leva o chamado para outra fila ou analista. Quem transferiu sai, salvo se a regra mantiver a origem |
| `same_ticket` | Atuação conjunta: o responsável fica e um analista ou fila entra no mesmo chamado |
| `child_ticket` | Abre um chamado filho vinculado |
| `category_change` | Troca a categoria e registra a nota |

- O destino pode ser a fila, um analista fixo ou um analista escolhido na hora.
- A regra pode exigir justificativa, mudar a prioridade e valer só para certas filas.
- O escalonamento dá acesso ao chamado, mesmo sem a empresa na carteira.
- Podem escalonar: gestores, o responsável, colaboradores ou, sem responsável, qualquer analista com acesso.
- Chamado resolvido ou fechado não escalona.

## Previsão ao cliente

- O cliente não vê o prazo vencido. Ele lê a previsão: o prazo do plano enquanto está no futuro, ou a nova previsão informada pela equipe (`client_forecast_at`).
- Informar uma previsão não altera o prazo nem os números de SLA e fica no histórico. Só aceita data futura e chamado em aberto, com as mesmas permissões de alterar o chamado.
- Vencido sem nova previsão aparece no Turno com o botão Nova previsão.

## Reabertura e fechamento

- O solicitante confirma a solução e o chamado fecha na hora. A pesquisa pendente só é cobrada depois da confirmação ou do fim do prazo de reabertura.
- Resolvido pode ser reaberto dentro do prazo (padrão 24 h corridas). Fechado é definitivo para o solicitante.
- O novo prazo segue a regra global: SLA da empresa, horas fixas, prazo original ou original mais horas.
- Fechamento automático diário, às 01:00: Resolvido sem atualização nem mensagem do solicitante por N dias (padrão 7).

## Inatividade

A cada 15 minutos, dentro do horário da configuração: chamado Aberto, sem responsável e sem atuação da equipe por N horas úteis (padrão 24) vai para um analista sorteado da fila que atenda a empresa. A prioridade só sobe. Sem analista elegível, nada muda e fica registrado na auditoria.

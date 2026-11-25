# Pendências

Ao colocar um chamado em Pendente, o atendente informa de quem se espera retorno.

| `pending_reason` | Nome | Quando usar |
|---|---|---|
| `pending_user` | Usuário | Informação, teste ou ação do solicitante |
| `pending_vendor` | Fornecedor | Retorno de terceiro ou fabricante |
| `pending_approval` | Aprovação interna | Aprovação de gestor ou compras |
| `pending_parts` | Peça/material | Chegada de equipamento ou material |
| `pending_schedule` | Agendamento | Data combinada com o solicitante |
| `pending_project` | Projeto | Posto pelo sistema ao ligar o chamado a uma task |

Regras (`TicketService.updateTicket`):

1. Tipo de pendência e justificativa são obrigatórios. A evidência (JPG ou PNG) é opcional.
2. Agendamento exige data e hora no futuro. Quando ela chega, um job (a cada 5 minutos) volta o chamado para Em Atendimento e avisa o responsável.
3. Tipo, justificativa e evidência ficam no evento do histórico.
4. O SLA pausa da mesma forma em qualquer tipo.
5. Trocar o tipo com o chamado já pendente exige os mesmos campos e não reinicia a pausa.
6. Ao sair de Pendente, o tipo é limpo no chamado e continua no histórico.
7. Resposta pública do solicitante volta o chamado para Em Atendimento. Nota interna não muda o status.

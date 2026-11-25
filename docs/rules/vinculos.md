# Vínculos e visibilidade

## Empresa, plano e categorias

- Cada empresa tem um plano. O plano define prazos, filas e as categorias liberadas (`plan_categories`, N:N).
- Uma categoria do plano pode ser desligada só para uma empresa (`org_category_blocks`).
- O usuário vê as categorias ativas do plano, menos as desligadas (`GET /categories/available`).
- Plano vencido (`organizations.expires_at`): sem categorias e sem abertura (`403 SLA_PLAN_EXPIRED`). Chamados abertos seguem normais.
- Categoria desligada também não pode ser escolhida na edição ou no escalonamento (`400 CATEGORY_NOT_AVAILABLE`). Regras de roteamento e integrações não são barradas.

## Pessoas

- Login: senha ou Microsoft. Domínios liberados na empresa permitem criar a conta no primeiro login Microsoft.
- E-mail da caixa de atendimento encontra a empresa pelo domínio. Sem empresa, cria uma com o domínio do remetente; remetentes bloqueados são recusados.
- Cargos: usuário, analista, Ticket Manager, gerente e admin. Cada um alcança só os cargos abaixo, dentro do próprio time (`access/grants.ts`).
- Ninguém concede permissão que não tem. Áreas de plataforma só o admin libera.

## Quem vê um chamado

| Quem | Vê |
|---|---|
| Usuário final | Os próprios |
| Analista | Empresas da carteira nas próprias filas, e chamados sem fila se tiver ao menos uma |
| Ticket Manager e gerente | Empresas da carteira. Fila só define notificação |
| Admin | Todos, só leitura |

Além disso, vê o chamado quem é responsável, colaborador, da fila colaboradora ou da fila para onde ele foi escalonado. Equipe sem o módulo Chamados vê só o que abriu.

A carteira é a interseção das empresas marcadas na cadeia de chefia. "Todas" e "Herdar" não restringem; cadeia sem nada marcado não vê nenhuma empresa.

## Chamados e projetos

Um chamado pode ser ligado a uma task. Ele sai do SLA (fica Pendente, por projeto) e o prazo mostrado ao solicitante passa a ser o da task. Regras de roteamento podem criar a task ou vincular uma existente.

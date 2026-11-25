# Administrador

O administrador configura o sistema. Vê todos os chamados, mas não atende.

## Saúde do sistema

Em **Configurações**, mostra o que falta ligar, o que está funcionando, o que mudou em sete dias e uma busca de ajustes por qualquer palavra, como "feriado" ou "cor".

## Configurações

Os ajustes ficam em cinco grupos: **Como atendemos**, **Para onde vai**, **Como falamos**, **Inteligência** e **Acesso e integrações**.

| Tela | Para quê |
|---|---|
| **Filas** | Filas de atendimento. Excluir deixa os chamados sem fila |
| **Categorias** | Categorias, subcategorias e formulários próprios |
| **Respostas prontas** | Modelos de texto |
| **Pesquisas** | Perguntas, convite e opção que reabre o chamado. Um modelo ativo por vez |
| **Planos** | Prazos por tipo, filas, minutos de escalonamento, categorias e pacotes |
| **Pacotes** | Catálogo ligado aos planos |
| **Roteamento** | Gatilhos, condições e ações automáticas, na ordem da lista |
| **Escalonamento** | Regras do botão Escalonar |
| **Inatividade** | Atribuição de chamados que ninguém tocou |
| **Reabertura** | Prazo para reabrir e regra do novo prazo |
| **Fechamento automático** | Dias até fechar um resolvido |
| **Tipos de chamado** | Liga e desliga tipos. Incidente fica sempre ligado |
| **Expediente** | Janela, dias úteis e fuso do SLA |

Mudanças de prazo valem para chamados novos. Antes de excluir um plano, troque o plano das empresas.

## Integrações, marca e acesso

**Integrações:** saída (avisos para outros sistemas) e API externa (chaves). Veja [API_INTEGRATION.md](../docs/API_INTEGRATION.md).

**E-mail:** Envios, Recebidos, Bloqueios e Configuração.

**Aparência:** escolha uma paleta pronta ou três cores: Principal, Destaque e Menu e login. O resto da interface é calculado, com contraste garantido. A prévia mostra claro e escuro antes de salvar.

**Login Microsoft:**

1. No portal da Microsoft, registre um aplicativo e cadastre o endereço de retorno mostrado na tela.
2. Informe o ID do aplicativo e os tenants aceitos. Sem tenant, qualquer conta corporativa passa, e os domínios das empresas decidem.
3. Escolha segredo ou certificado, ligue e salve.
4. Clique em **Testar**.

**Provedor de IA:** Azure OpenAI ou servidor compatível (OpenAI, Ollama, vLLM, LM Studio). Informe endereço, chave e modelos; o embedding precisa gerar 1536 posições. **Testar** confere os dois modelos. Aqui também ficam os limites de uso. Desligado, nada é enviado à IA.

Segredos ficam cifrados e nunca voltam para a tela. **Apagar configuração** volta para as variáveis de ambiente.

**Agentes de IA:** modo (Desligado, Sombra, Aplicar), rigor e opções de cada agente, com execuções e acertos. Comece em Sombra.

**Checklist de abertura:** o que cada tipo de chamado precisa trazer.

**Base de conhecimento:** artigos, categorias, importação e lacunas (perguntas sem resposta).

**Lixeira:** chamados excluídos, com restauração até o prazo de retenção.

## Cadastrar uma empresa

1. Crie a empresa com plano e, se houver, vencimento e domínios.
2. Ligue as categorias ao plano em Planos.
3. Confira as filas e coloque analistas nelas, com a empresa na carteira.
4. Crie os usuários ou libere o domínio para o login Microsoft.
5. Abra um chamado de teste e confira fila, prazo e avisos.

## Permissões

Na ficha da pessoa, em Permissões, ligue áreas e módulos. Webhooks, SLA, lixeira, e-mail e excluir chamados só o administrador libera.

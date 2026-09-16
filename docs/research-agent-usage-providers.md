# Pesquisa de uso e consumo: Claude Code, Cursor e Grok Build

Data da consulta: 16/09/2026.

Escopo: fontes oficiais públicas, sem acessar credenciais, autenticar contas, consultar sessões privadas ou executar inferência paga. Este documento é insumo para o estudo do painel do Metacodex. Codex e a arquitetura local são tratados separadamente. As recomendações abaixo são conclusões de engenharia, não promessas dos fornecedores.

## Conclusão

É viável oferecer uma experiência comum, mas cada integração precisa declarar quais dados consegue obter. O caminho mais completo para contas individuais entre estes fornecedores é o statusline do Claude Code. Cursor tem evidência oficial de tokens locais e de uma tela de uso, com documentação inconsistente entre changelog e schemas de referência. Grok Build tem comandos de uso e statusline, mas falta um contrato público completo para exportar cotas de assinatura. As fontes e limitações estão detalhadas nas seções seguintes.

Para o produto, separar quatro conceitos:

1. **Cota da conta:** percentual utilizado de um plano e próxima renovação.
2. **Consumo da sessão:** tokens de entrada, saída e cache, identificados por sessão e requisição.
3. **Custo estimado:** cálculo ou estimativa do cliente. Não é necessariamente uma cobrança.
4. **Valor reportado para cobrança:** custo fornecido pelo serviço, ainda sujeito ao escopo da consulta e eventual atraso de consolidação.

Não somar percentuais de planos diferentes. Não converter janela de contexto em consumo acumulado. Não deduzir uma cobrança por sessão dividindo o preço mensal da assinatura.

### Matriz de viabilidade e confiança

Confiança abaixo é uma avaliação desta pesquisa. Alta significa contrato oficial explícito; média significa capacidade anunciada, mas contrato incompleto; baixa significa que a integração solicitada não foi documentada nas fontes consultadas.

| Integração | Cotas e reset da assinatura | Tokens da sessão | Custo | Confiança |
| --- | --- | --- | --- | --- |
| Claude Code local | Sim, condições e versão mínima descritas abaixo | OTel; contexto da statusline não é acumulado | Estimado no cliente | Alta documental, execução não testada |
| Cursor CLI local | `/usage` visual; exportação estruturada não confirmada | Anunciados no changelog para hooks e stream-json | Sem contrato local completo validado | Média; referências incompletas |
| Cursor Admin API | Ciclo e limites organizacionais, sem promessa para conta individual | Eventos organizacionais, correlação local pendente | Reportado pelo fornecedor | Alta no contrato, elegibilidade Teams conflitante |
| Grok Build local | `/usage` visual; integração estruturada de assinatura não confirmada | Contexto documentado; consumo completo pendente | Item visual por processo | Média para a TUI; baixa para exportação de cota |
| xAI Management/inference API | Saldo e limites de API, separados da assinatura | Por request/conta API | Cobrado por request e relatórios de API | Alta documental, execução não testada |

As evidências para cada linha estão nas respectivas seções. Grok Build fica explicitamente como suporte parcial: a existência de `/usage` não resolve uma integração estruturada de assinatura. Um conector xAI API seria outra integração e não deve preencher esse vazio com dados de uma conta de API diferente.

## Claude Code

### Caminho recomendado para o MVP individual

O statusline é uma extensão oficial: recebe JSON via stdin, incluindo `session_id`, modelo, custo estimado e dados de contexto. A documentação atual exige **Claude Code v2.1.251 ou posterior** para `rate_limits`: assinantes Pro/Max recebem `five_hour` e `seven_day`, com `used_percentage` e `resets_at` em segundos Unix, após a primeira resposta da API. Gateways Claude apps com limite financeiro podem receber `spend_limit`; o percentual desse campo pode ultrapassar 100. Campos ausentes devem continuar ausentes no painel. [Fonte: statusline](https://code.claude.com/docs/en/statusline).

Atenção: `context_window.total_input_tokens` e `total_output_tokens` representam o contexto/resposta mais recente, não um contador acumulado confiável de consumo. O primeiro inclui entrada sem cache, leitura e escrita de cache. Portanto, o MVP pode apresentar contexto e cotas com essa fonte, mas precisa de telemetria apropriada para somar tokens de uma sessão. [Fonte: campos de contexto do statusline](https://code.claude.com/docs/en/statusline#context-window-fields).

### Instalação por processo e compatibilidade

`claude --settings <arquivo-ou-JSON>` aplica valores apenas à sessão iniciada. As chaves omitidas preservam os valores dos arquivos existentes. Isso permite fornecer `statusLine` em um arquivo pertencente ao Metacodex sem editar a configuração global. O mesmo CLI permite `--session-id` com UUID, útil para estabelecer uma identidade explícita quando criamos uma nova sessão. [Fonte: referência CLI](https://code.claude.com/docs/en/cli-reference).

Configurações gerenciadas têm precedência sobre `--settings`. A flag substitui o valor efetivo da chave conflitante durante aquela sessão; preservar o arquivo global não significa preservar a aparência de uma statusline já configurada. [Fonte: precedência](https://code.claude.com/docs/en/settings#settings-precedence).

Recomendação de implementação: detectar uma statusline existente antes de habilitar a coleta. Um wrapper pode encaminhar o mesmo stdin ao script anterior e preservar seu stdout, enquanto publica apenas campos autorizados para um canal local. Essa composição é uma proposta do Metacodex e exige teste de quoting, timeouts, Windows e configuração gerenciada. Se não for possível preservar a configuração, apresentar a integração como indisponível por conflito. Nunca ignorar políticas gerenciadas nem concatenar comandos arbitrários de forma insegura.

### Uso, custos e assinatura

A documentação atual de custos descreve a seção de sessão dentro de `/usage`. O valor em dólares é calculado localmente com preços de tabela ou preços organizacionais configurados e é estimado. Pro/Max têm consumo incluído na assinatura; esse número não representa uma cobrança incremental. `/clear` reinicia os totais nas versões atuais, comportamento diferente das versões anteriores a v2.1.211. [Fonte: custos](https://code.claude.com/docs/en/costs#using-the-usage-command).

O help center ainda documenta `/cost` para sessões autenticadas por API key. Há diferença de apresentação entre documentos e versões: usar o JSON oficial como contrato de integração e tratar `/cost` e `/usage` como recursos de diagnóstico disponíveis conforme a versão. [Fonte: modelos, uso e limites](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code).

O uso de claude.ai, Claude Code e Claude Desktop compartilha o limite de uso. Consequentemente, uma cota exibida ao lado de uma aba não pertence exclusivamente àquela aba. [Fonte: limites de uso e contexto](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work).

### Consumo acumulado e histórico

OpenTelemetry é o canal oficial para métricas de tokens, custo e sessões, ativado com `CLAUDE_CODE_ENABLE_TELEMETRY=1` e exporters OTLP. Há `claude_code.token.usage`, `claude_code.cost.usage`, `session.id`, identidade de conta quando disponível e atributos adicionais configuráveis. Os custos permanecem aproximações. Prompts e respostas são redigidos por padrão; não habilitar sua captura para um painel de consumo. O formato de transcript local é explicitamente interno e pode mudar entre versões. [Fonte: monitoramento](https://code.claude.com/docs/en/monitoring-usage).

Recomendação: usar OTel apenas se precisarmos do histórico de tokens e custos por sessão, preservando exporters que o usuário já tenha. Persistir observações numéricas e identidades necessárias, com deduplicação. Não usar contagem de caracteres do terminal como estimativa silenciosa de tokens.

### APIs organizacionais, fase posterior

| Necessidade | Contrato oficial | Restrição |
| --- | --- | --- |
| Tokens de API por período | `GET https://api.anthropic.com/v1/organizations/usage_report/messages` | Organização, não conta individual |
| Custo agregado de API | `GET https://api.anthropic.com/v1/organizations/cost_report` | Granularidade diária; valores decimais em centavos; Priority Tier não incluído |
| Analytics Claude Code | `GET https://api.anthropic.com/v1/organizations/usage_report/claude_code` | Diário por usuário, custo estimado, cerca de uma hora de atraso |

Os dois primeiros endpoints aceitam Admin API key, OAuth com `org:admin` ou chave pessoal/de serviço sem escopo de workspace. Chaves de workspace não servem. A consulta de tokens aceita janelas de minuto, hora ou dia e filtros por modelo, workspace e API key. Isso não fornece a cota pessoal Pro/Max. [Fonte: Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api).

Claude Code Analytics usa credenciais administrativas semelhantes e não inclui os backends terceiros listados na documentação. A API não oferece tempo real. [Fonte: Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api).

Claude Enterprise em claude.ai usa outra Analytics API e chave com `read:analytics`, criada pelo Primary Owner. Essa API não está disponível no plano Teams. O painel Console de clientes API tem regras diferentes. [Fonte: analytics de equipes](https://code.claude.com/docs/en/analytics).

## Cursor CLI e conta Cursor

### Dados locais: viáveis, contrato precisa de prova

O changelog oficial registra tokens de entrada, saída e cache por turno em `stream-json` em fevereiro/2026; também registra payloads de hooks com tokens por turno e session ID estável em março/2026. Em julho/2026, `/usage` passou a mostrar uso incluído, gasto adicional, plano e data de renovação. Isso sustenta um spike para métricas locais e confirma a consulta visual de cotas. [Fonte: CLI changelog](https://cursor.com/docs/cli/changelog).

Entretanto, a página `output-format` consultada ainda mostra um resultado final com duração, IDs e texto, sem schema do bloco de tokens. JSON e stream-json são modos de execução com `--print`, não uma exportação que podemos assumir presente na TUI já aberta. Há uma lacuna documental real. [Fonte: output format](https://cursor.com/docs/cli/reference/output-format).

A referência de hooks igualmente não detalha tokens financeiros: `afterAgentResponse` documenta texto; `preCompact` fornece `context_tokens`, percentual e capacidade de contexto. Esses dados de compactação não equivalem a tokens faturáveis. [Fonte: hooks](https://cursor.com/docs/hooks).

Recomendação: Cursor local deve entrar como **integração em validação**, não como impossível. Antes de prometer suporte, coletar uma fixture consentida na versão suportada, confirmar o hook exato, nomes/tipos dos campos, identidade de sessão, semântica por turno e comportamento com cache/retries. Não iniciar uma inferência adicional apenas para obter medição. Não trocar uma sessão interativa por headless para alimentar o painel.

### Cotas individuais

Os planos individuais atuais têm pools separados para modelos Cursor e outros modelos, renovados com o ciclo mensal. O dashboard e as configurações do editor mostram esses pools. A seleção de modelo influencia o consumo. [Fonte: modelos e preços](https://cursor.com/docs/models-and-pricing).

Não foi encontrado nesta pesquisa um endpoint público documentado de leitura dessas cotas individuais nem uma flag que exporte `/usage` em JSON. O comando visual e o dashboard são fallbacks. Isso é uma limitação da evidência encontrada, não prova de inexistência de qualquer mecanismo. Extrair cookies ou reutilizar endpoints internos do dashboard não deve ser dependência do MVP.

### Admin API e custo

A visão geral oficial atual classifica Admin API e Analytics API como **Enterprise**. Admin API usa Basic Auth com a API key como usuário e senha vazia; a criação documentada exige administrador e escopo `admin:*`. Como a credencial é poderosa, um leitor de consumo deve manter uma allowlist estrita dos endpoints de leitura. [Fonte: APIs e autenticação](https://cursor.com/docs/api).

Há divergência editorial: Teams Pricing menciona estatísticas via Admin API de forma geral, enquanto a visão geral restringe a Enterprise. Para planejamento, assumir Enterprise e confirmar elegibilidade real antes de oferecer conexão a Teams. [Fonte: Teams Pricing](https://cursor.com/docs/account/teams/pricing), [Fonte: disponibilidade de APIs](https://cursor.com/docs/api).

| Endpoint em `https://api.cursor.com` | Dados úteis |
| --- | --- |
| `POST /teams/spend` | `spendCents` para on-demand, `overallSpendCents` incluindo uso incluído, limites individuais e início do ciclo |
| `POST /teams/filtered-usage-events` | Modelo, `conversationId` quando presente, tokens/cache, `chargedCents`, tipo de cobrança |
| `POST /teams/daily-usage-data` | Atividade diária; contagem de eventos não equivale necessariamente a unidades faturáveis |

Para reconciliar eventos com totais, a documentação manda somar `chargedCents`. `tokenUsage.totalCents` é custo do modelo e pode excluir a taxa Cursor. Eventos são consolidados por hora; a recomendação é consultar no máximo uma vez por hora. `spendCents` pode ter frações de centavo. [Fonte: Admin API](https://cursor.com/docs/account/teams/admin-api).

Recomendação: tratar esses números como valores reportados pelo provedor para aquele ciclo/escopo, separados de custos estimados locais. Não atribuir o gasto total da pessoa apenas às sessões iniciadas no Metacodex. `conversationId` só deve unir dados quando houver correspondência comprovada com o ID local, nunca por nome, horário ou diretório.

Existe também `GET /v1/agents/{id}/usage`, com tokens por execução de **cloud agents**. Isso não representa a cota de uma conta nem prova acesso ao consumo de qualquer terminal Cursor local. [Fonte: Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints).

## Grok Build e API xAI

### Produto e autenticação

Grok Build é o agente de terminal oficial, com TUI, modo headless e ACP. Aceita login via navegador ou `XAI_API_KEY` e também pode usar modelos customizados. Logo, o nome do agente não determina por si só o provedor de cobrança. [Fonte: Grok Build](https://docs.x.ai/build/overview).

O lançamento anunciou acesso de assinantes SuperGrok e X Premium Plus. Esse anúncio histórico não deve virar uma tabela fixa de elegibilidade atual; identificar o tipo de autenticação e a capacidade efetiva do CLI. [Fonte: anúncio no catálogo oficial](https://x.ai/news).

### Cotas e statusline

`/usage` consulta créditos ou gerenciamento de cobrança; `/context` consulta contexto. [Fonte: comandos](https://docs.x.ai/build/modes-and-commands).

O changelog diferencia autenticações: v0.2.64 ocultou `/usage` e avisos de crédito em autenticação por API key. Versões próximas introduziram saldo pré-pago e auto top-up na tela. Portanto, não assumir que `/usage` está disponível da mesma forma em todos os modos. [Fonte: changelog Grok Build](https://x.ai/build/changelog).

A statusline oficial aceita script por `ui.status_line`, recebe JSON e documenta campos comuns de modelo, contexto, branch e diretório. O item visual `cost` mede o processo atual, reiniciando a contagem em uma retomada. A página não fornece um schema completo de custo nem cotas/reset para o JSON. O modo script está documentado como não testado em Windows. [Fonte: statusline Grok Build](https://docs.x.ai/build/features/status-line).

Recomendação: oferecer inicialmente ligação para o comando/dashboard e suporte parcial, com spike de payload antes de uma promessa de cota integrada. O nome `cost` na TUI não autoriza tratá-lo como despesa efetivamente faturada nem como custo de toda uma sessão retomada. Não foi localizada uma API pública de quota SuperGrok/X Premium para terceiros nas páginas consultadas.

### xAI API: caminho forte para cobrança de API

A Management API usa `https://management-api.x.ai` e uma **management key separada da inference API key**, transmitida como Bearer. A documentação a apresenta para administração empresarial; não assumir que qualquer assinatura pessoal concede essa chave. [Fonte: Management API](https://docs.x.ai/developers/management-api-guide).

Endpoints oficiais relevantes:

| Método e caminho | Resultado |
| --- | --- |
| `POST /v1/billing/teams/{team_id}/usage` | Histórico de uso agregado por período e dimensões |
| `GET /v1/billing/teams/{team_id}/prepaid/balance` | Saldo e movimentos pré-pagos |
| `GET /v1/billing/teams/{team_id}/postpaid/spending-limits` | Limites mensais pós-pagos |
| `GET /v1/billing/teams/{team_id}/postpaid/invoice/preview` | Prévia de cobrança do período |

A resposta histórica sinaliza truncamento com `limitReached`; o painel não pode chamar um resultado parcial de total. Os limites pós-pagos não são o mesmo que saldo pré-pago. [Fonte: billing management](https://docs.x.ai/developers/rest-api-reference/management/billing).

Para requisições de inferência, a xAI documenta `usage.cost_in_usd_ticks`: valor cobrado pela requisição após descontos, incluindo tokens e ferramentas do servidor. A conversão é `USD = ticks / 10^10`. Em streaming, o SDK fornece um total progressivo; usar o valor final da requisição, sem somar todos os chunks. [Fonte: cost tracking](https://docs.x.ai/developers/cost-tracking).

Este é um contrato mais forte de custo do que estimativas de tabela. Porém o Metacodex só pode aproveitá-lo quando um adaptador suportado receber esse campo. A existência do campo na inference API não demonstra que ele esteja exposto pelo Grok Build TUI ou statusline. Management API cobre conta/team API; não mede automaticamente cotas de assinatura consumer.

## Decisões sugeridas para o estudo principal

- **Claude no MVP:** cotas e reset via statusline, com versão mínima e estado de dado ausente. Contexto pode aparecer separado. Histórico de tokens entra por OTel em etapa posterior.
- **Cursor em spike curto:** tokens locais são anunciados oficialmente, mas schema e hook precisam de fixture. Cotas da conta ficam como consulta no produto até existir contrato estruturado validado. Admin API é integração organizacional posterior.
- **Grok parcial:** comando oficial de uso e contexto, sem prometer cotas estruturadas. API xAI pode ganhar um conector organizacional separado.
- **Qualidade por métrica:** registrar `observed`, `estimated` ou `provider_reported`, fonte, versão do CLI, escopo, momento de coleta e janela. Acrescentar `billed` somente quando o campo tiver essa semântica documentada, como custo de request xAI, sem apresentar isso como fatura consolidada.
- **Identidade:** cota pertence à conta; tokens pertencem à sessão/requisição; uso por projeto precisa de correlação exata. Uma mesma conta em várias abas não multiplica sua cota.
- **Privacidade:** coletar números e identificadores necessários. Não armazenar prompts, respostas, conteúdo de arquivos, tokens de autenticação ou cookies para este recurso.

## Riscos e validação pendente

1. A documentação muda rapidamente e pode divergir de snippets de busca. Estas conclusões foram confrontadas com páginas oficiais abertas na data indicada.
2. A identidade da conta não está garantida em todo payload. Se não puder ser estabelecida de forma confiável, exibir escopo desconhecido e não unir contas.
3. Resume, `/clear`, processos paralelos e subagentes exigem deduplicação e tratamento de contadores reiniciados.
4. O spike precisa provar coexistência da statusline Claude, hooks Cursor e políticas gerenciadas, sem alterar preferências globais nem interromper o terminal.
5. Nenhum endpoint autenticado foi testado nesta pesquisa. Disponibilidade para um plano concreto, latência real e schemas efetivos devem ser confirmados durante a implementação, com a conexão escolhida pelo usuário.

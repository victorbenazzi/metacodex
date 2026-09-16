# Coleta de assinaturas pessoais: referência CodexBar

Estudo de 16/09/2026. Fonte inspecionada: repositório `steipete/CodexBar`, commit [`937b20813cf47340093b6c312331c63a52768097`](https://github.com/steipete/CodexBar/tree/937b20813cf47340093b6c312331c63a52768097), cuja mensagem é `docs: update appcast for 0.60.4`.

O código e os testes mostram caminhos de coleta de assinatura pessoal mais completos que os adaptadores atuais do Metacodex. A ausência de um comando público de quota no CLI não impede consultar os endpoints autenticados utilizados pelos aplicativos. Isso corrige a conclusão anterior: a limitação era da integração entregue, não uma impossibilidade geral do Cursor ou do Grok.

Nesta etapa foram lidos código, documentação e fixtures. O clone público não foi executado, instalado ou utilizado para ler credenciais pessoais. Os novos endpoints descritos aqui ainda não foram validados com as contas do usuário; a consulta ACP Grok registrada na etapa anterior continua sendo a prova ao vivo disponível.

## Comparação das fontes

| Provedor | CodexBar | Metacodex atual | Adaptação indicada |
|---|---|---|---|
| Cursor | Sessão do Cursor.app ou cookie do navegador; endpoints de resumo e histórico da conta | Hook opcional com tokens dos turnos locais | Adicionar coleta autenticada da conta e manter os hooks como atividade por projeto |
| Grok | Billing do CLI, proxy HTTP de créditos e enriquecimento gRPC-Web; alternativa por sessão web | ACP validado, com plano e datas; sem franquia na resposta observada | Preservar o ACP atual e adicionar a consulta de créditos com a mesma identidade |
| Codex | OAuth, app-server e extras opcionais do dashboard | app-server com cotas e histórico | Manter a fonte já validada; OAuth seria uma alternativa, não requisito para Cursor/Grok |
| Claude | OAuth de uso, CLI e sessão web | Statusline opcional, vinculada às sessões abertas aqui | OAuth de uso pode fornecer cotas sem depender de uma nova resposta do agente |

Fontes: [Cursor](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/docs/cursor.md), [Grok](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/docs/grok.md), [Codex](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/docs/codex.md), [Claude](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/docs/claude.md).

## Cursor: como a coleta funciona

### Autenticação

No macOS, o modo automático prioriza a sessão do Cursor.app. Ele lê somente a chave `cursorAuth/accessToken` na tabela `ItemTable` do banco `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`. O banco é aberto em modo de leitura, respeitando o WAL. O fallback `immutable=1` só é usado quando os arquivos WAL/SHM estão ausentes e a abertura normal falha, para evitar ler um estado antigo.

O JWT fornece `sub` e `exp`. O CodexBar extrai o identificador de usuário, exige mais de 60 segundos de validade e monta `WorkosCursorSessionToken=<userId>%3A%3A<accessToken>`. Não renova esse token por conta própria. Isso transforma uma sessão já existente do aplicativo em autenticação para os endpoints do próprio Cursor.

Quando essa fonte não funciona, há cookie em cache, importação do navegador e sessão armazenada. Cookie manual é uma seleção explícita e prevalece sobre a busca automática. A leitura do Cursor.app não prova que o Cursor CLI, instalado sem o editor, disponibilize a mesma credencial no mesmo formato; esse cenário precisa de uma fonte própria ou conexão web.

Fontes: [CursorAppAuth.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Cursor/CursorAppAuth.swift), [resolução de sessão](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Cursor/CursorStatusProbe%2BSessionResolution.swift).

### Resumo e identidade

| Requisição | Informação |
|---|---|
| `GET https://cursor.com/api/usage-summary` | Plano, franquia incluída, gasto adicional e ciclo de cobrança |
| `GET https://cursor.com/api/auth/me` | Identidade estável da conta e email |
| `GET https://cursor.com/api/usage?user=ID` | Compatibilidade com planos antigos baseados em requisições |

A autenticação usa o header `Cookie`. O adaptador trata HTTP 401/403 como rejeição de sessão. As consultas são de leitura e não precisam de uma chave administrativa ou de uma conta Enterprise.

Campos relevantes do resumo:

- `membershipType`, `billingCycleStart`, `billingCycleEnd`.
- `individualUsage.plan.used`, `limit`, `remaining` em centavos.
- `individualUsage.plan.totalPercentUsed`, `autoPercentUsed`, `apiPercentUsed` já em percentual. `0.36` significa `0,36%`, não `36%`.
- `individualUsage.onDemand.used/limit` em centavos, separado da franquia incluída.
- `breakdown.total` representa uso acumulado, não o limite da franquia.

O parser do Metacodex deve preferir o percentual total publicado. Se for necessário calcular uma razão, somente usar `used / limit * 100` quando ambos forem válidos e o limite for positivo. Não copiar o fallback final do CodexBar que retorna zero quando nenhuma fonte de percentual existe. Também não sintetizar uma média de faixas como total sem uma regra explícita para o plano.

Fontes: [modelos e requisições](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Cursor/CursorStatusProbe.swift), [testes de parsing e percentuais](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/CursorStatusProbeTests.swift).

### Histórico da conta

O histórico é consultado com `POST https://cursor.com/api/dashboard/get-filtered-usage-events`, cookie, JSON e `Origin: https://cursor.com`. A consulta inclui datas e paginação. O CodexBar usa páginas de 1.000 eventos, com limite de 200 páginas, verifica cobertura contra a contagem informada e remove somente sobreposições comprovadas nas bordas das páginas.

Cada evento pode incluir modelo, tokens de entrada, saída, leitura/gravação de cache e valores monetários. Há dois valores distintos:

- `tokenUsage.totalCents`: custo equivalente reportado dos tokens, com estimativa por tabela de preços apenas quando faltar esse campo.
- `chargedCents`: valor medido pelo Cursor para dedução do plano.

Não somar estimativa de preço de API com dedução da assinatura. Não agregar um histórico incompleto como total confirmado. O dado remoto é da conta inteira, incluindo outras máquinas, e não fornece automaticamente atribuição aos projetos locais do Metacodex.

Fontes: [CursorUsageEventsFetcher.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Cursor/CursorUsageEventsFetcher.swift), [testes de histórico](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/CursorUsageEventsFetcherTests.swift).

### Grok Bot dentro do Cursor

O endpoint Cursor `get-sand-usage-status` representa uma franquia Grok Bot da conta Cursor. Ele não representa a assinatura SuperGrok do usuário. Essa métrica, caso adicionada, deve permanecer dentro do provedor Cursor.

Fonte: [CursorSandUsage.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Cursor/CursorSandUsage.swift).

## Grok: complemento que faltava

A consulta ACP pode retornar billing sem percentual da franquia. O CodexBar acrescenta:

1. `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`, usando o token OAuth do Grok CLI.
2. Enriquecimento por `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig`, com gRPC-Web protobuf e autenticação OAuth ou sessão web compatível.
3. Regras específicas para ler o percentual de créditos e identificar presença versus ausência de campos protobuf.

A sessão OAuth é a assinatura pessoal, distinta da Management API xAI com API key. O código de autenticação e os testes detalhados estão no [estudo Grok do CodexBar](research-codexbar-grok.md).

Preservar nosso handshake ACP já validado com Grok 1.0.13. O formato RPC do CodexBar não deve substituir mecanicamente uma sequência que foi testada na versão instalada. Também separar gasto adicional da franquia incluída: `onDemandUsed / onDemandCap` não representa, por si só, o consumo do plano.

Fontes: [GrokCreditsProxyFetcher.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCreditsProxyFetcher.swift), [GrokWebBillingFetcher.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift), [GrokProviderDescriptor.swift](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift).

## Adaptação concreta para o Metacodex

A interface Usage já está pronta para receber janelas de cota. A principal lacuna está na autenticação e nos adaptadores de conta do Rust.

| Área | Alteração proposta |
|---|---|
| Autenticação | Criar conexões por provedor com fonte selecionada, identidade da conta, estado de expiração e opção de desconectar |
| Acesso a arquivos externos | Usar autorização nativa específica para a fonte selecionada, de acordo com as regras de grants do repositório; não ampliar comandos genéricos de filesystem |
| Segredos | Manter tokens/cookies no Rust e no armazenamento seguro do sistema quando persistidos; não devolver segredos em snapshots, logs ou diagnóstico |
| Cursor | Criar `usage/cursor_account.rs` para resumo e identidade; manter `usage/cursor.rs` para métricas locais por turno |
| Grok | Complementar `usage/grok.rs` com parser de créditos e transporte HTTP/gRPC-Web; preservar o fluxo ACP atual |
| DTO | Acrescentar origem, escopo, identidade e valores monetários opcionais. Separar quota, gasto medido, estimativa e atividade local |
| Cache | Chavear por provedor e identidade; preservar leitura antiga somente para a mesma conta, com o horário original |
| UI | Conectar/desconectar conta no detalhe do provedor; resumo com quota e renovação; detalhes com franquia, extra e histórico quando disponível |
| IPC | Registrar novos comandos em `lib.rs` e `src/lib/ipc.ts`; nenhuma leitura de credencial em React |

Ordem recomendada:

1. Conexão autenticada e resumo da conta Cursor.
2. Créditos Grok com a identidade do CLI já conectado.
3. Histórico Cursor completo, com cobertura e paginação explícitas.
4. OAuth Claude como melhoria opcional; manter a coleta Codex validada.

A importação automática de todos os navegadores não precisa fazer parte da primeira entrega. Ela traz descriptografia de cookies, perfis múltiplos e permissões de Keychain. Uma fonte selecionada explicitamente reduz ambiguidades de conta. Login em uma webview isolada do Metacodex é uma alternativa de design, mas sua aceitação pelo fluxo de autenticação do provedor ainda precisa ser testada; não presumir que ela substitui o fluxo externo do CodexBar.

## Comportamentos que precisam de testes

- Autenticação expirada ou rejeitada não troca silenciosamente para outra conta.
- Uma resposta atrasada não sobrescreve uma conexão recém-alterada.
- Campos ausentes permanecem desconhecidos; zero só aparece quando a fonte o comprova.
- Percentuais fracionários não são multiplicados por 100 novamente.
- Centavos, dólares e créditos conservam sua unidade e fonte.
- Histórico com páginas faltantes não publica soma parcial como total completo.
- Falha de rede conserva o horário da última medição, sem fazê-la parecer nova.
- Tokens/cookies não aparecem no IPC de leitura, nos logs nem nos arquivos de métricas.
- Desconectar uma conta interrompe consultas e remove apenas as credenciais da conexão gerenciada pelo Metacodex.

## Reutilização e limites da evidência

O projeto é Swift e foi usado como referência de contratos e comportamento, não como biblioteca executada pelo Metacodex. Os endpoints são internos aos produtos e podem mudar. É viável implementar clientes equivalentes em Rust com testes de contrato e estados explícitos de indisponibilidade.

A licença do repositório é MIT. Se código ou trechos substanciais forem adaptados, preservar o aviso de copyright e a licença correspondentes. Fonte: [LICENSE](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/LICENSE).

Resultado deste estudo: caminhos implementáveis identificados e documentados. Os novos coletores autenticados ainda não foram incorporados ao código de produção do Metacodex nesta etapa.

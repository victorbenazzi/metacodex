# CodexBar: coleta pessoal do Grok e aplicação no Metacodex

Pesquisa estática em 16/09/2026. Repositório: [steipete/CodexBar](https://github.com/steipete/CodexBar). Commit analisado: [`937b20813cf47340093b6c312331c63a52768097`](https://github.com/steipete/CodexBar/commit/937b20813cf47340093b6c312331c63a52768097).

O clone público em `/private/tmp/metacodex-codexbar-study` foi usado somente para leitura. Nenhum código ou teste baixado foi executado, o CodexBar não foi instalado e nenhum cookie, token ou arquivo de autenticação pessoal foi acessado. A comparação considera o estado de [grok.rs](/Users/victor/Documents/metacodex/src-tauri/src/usage/grok.rs:17) observado durante esta pesquisa.

## Resultado

O CodexBar oferece evidência concreta para aceitar `config.creditUsagePercent` como percentual numérico opcional e para tentar uma segunda fonte quando o proxy retorna apenas plano/período. Isso pode melhorar o coletor nativo sem depender da instalação do CodexBar.

A segunda fonte é o endpoint gRPC-web de billing do próprio Grok, autenticado com token da mesma conta. Não é outra chamada ACP. A disponibilidade atual dessa rota para a conta do usuário não foi testada nesta etapa. Há comentários e tratamento de erro para mudanças de autenticação no servidor, portanto esse caminho precisa continuar opcional e falhar preservando os metadados já obtidos.

Recomendo manter o fluxo ACP do Metacodex que já foi validado com Grok 1.0.13. O cliente ACP do CodexBar usa um contrato diferente e aparentemente anterior. Reaproveitar o conhecimento de schema e a política de fallback, sem substituir nosso transporte pelo código deles.

## Fontes e rotas

| Canal no CodexBar | Contrato observado | Finalidade |
| --- | --- | --- |
| CLI ACP | `grok agent stdio`, `initialize`, `x.ai/billing` | Schema de cobrança antigo, sem envelope `config` |
| Proxy JSON | `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` | Créditos pessoais, `config.creditUsagePercent` e período |
| gRPC-web | `POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig` | Percentual que pode faltar no proxy |
| Histórico local | Scanner de `~/.grok/sessions` | Totais locais de tokens, separados da assinatura |

O modo `auto` ordena CLI, OAuth via proxy, web e OAuth via gRPC. O modo OAuth por si só pode tentar proxy e depois gRPC. O scanner de sessões é outra funcionalidade, não é necessário para obter a quota pessoal e não deve ser introduzido no Metacodex como consequência desta integração. [Seleção de fontes](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift#L87-L140), [snapshot e scanner](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokStatusProbe.swift#L31-L75).

### Proxy JSON

O request usa `Authorization: Bearer <token>`, `x-xai-token-auth: xai-grok-cli`, `Accept: application/json`, timeout de 15 segundos e exige HTTP 200. É o mesmo backend identificado anteriormente dentro do executável Grok, agora com schema explícito em código público. [GrokCreditsProxyFetcher](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCreditsProxyFetcher.swift#L7-L43).

O parser usa:

```text
config.creditUsagePercent: Double?
config.currentPeriod.start/end: String?
config.billingPeriodStart/End: String?
config.onDemandCap.val: Double?
config.onDemandUsed.val: Double?
config.subscriptionTier: String?
subscriptionTier: String?
```

O percentual publicado tem prioridade. O parser exige valor finito e limita a saída a 0-100. Para reset, prioriza `currentPeriod.end`; para duração, usa o início do mesmo objeto. Só recorre ao par `billingPeriodStart/End` quando não selecionou o período atual. Não combina início de uma fonte com fim de outra. Período sem percentual resulta em `usedPercent: nil`. [Parser e tipos](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCreditsProxyFetcher.swift#L46-L129).

O envelope HTTP usa `subscriptionTier`, enquanto o ACP 1.0.13 observado no Metacodex usa `subscription_tier`. São formatos de transporte distintos; não aplicar renomeação global sem preservar essa diferença.

### gRPC-web e enriquecimento

O request gRPC usa corpo de cinco bytes zero, um frame de mensagem vazia. Headers: `Content-Type: application/grpc-web+proto`, `x-grpc-web: 1`, `x-user-agent: connect-es/2.1.1`, `Origin: https://grok.com`, `Referer: https://grok.com/?_s=usage`. Autentica com Bearer, cookie ou ambos, conforme a fonte selecionada. Verifica status HTTP, headers gRPC e trailers gRPC. Faz uma repetição apenas para determinados erros transitórios. [Request e classificação](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift#L130-L271).

Quando o proxy tem período mas não percentual, `resolvingUnknownUsage` tenta gRPC com a mesma credencial por até seis segundos. Aceita percentual explicitamente publicado ou zero implícito validado pelo parser. Se houver timeout, erro ou resultado insuficiente, mantém plano/período do proxy com uso desconhecido. Cancelamento continua sendo cancelamento. [Enriquecimento](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift#L286-L333).

O parser gRPC não usa uma classe Protobuf gerada. Ele percorre campos conhecidos, procura percentual `fixed32` de campo 1, aceita somente números finitos entre 0 e 100 e identifica timestamps por caminhos e intervalo plausível. Para inferir zero, exige ausência do scalar de percentual, frame único completo, enum de período conhecido e período atual ativo, com início e fim válidos. Campos desconhecidos de bytes ficam opacos. [Extração e zero implícito](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift#L273-L342), [parser estrutural](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift#L457-L569).

Essa inferência não pode ser aplicada ao JSON ACP atual somente porque `creditUsagePercent` está ausente. O próprio CodexBar mantém a diferença entre `usedPercentIsWirePublished` e `usedPercentIsImplicitZero`. Não é correto converter qualquer ausência em 0%. [Proveniência do percentual](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift#L7-L59).

O comentário do proxy informa que o endpoint web passou a exigir uma chave WKE do browser em alguns cenários. O tratamento de erro orienta a usar o token do Grok CLI quando cookies são rejeitados. Ao mesmo tempo, o enriquecimento tenta Bearer no gRPC. Isso revela compatibilidade variável entre contas/servidor, não garantia de que todo login web fornecerá quota. [Comentário do proxy](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCreditsProxyFetcher.swift#L7-L11), [erros WKE](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokWebBillingFetcher.swift#L62-L128).

## Conta vinculada, token e browser

O CodexBar lê `$GROK_HOME/auth.json`, com default `~/.grok/auth.json`. O arquivo é um mapa por escopo: prioriza entradas com prefixo `https://auth.x.ai::`, referentes a OIDC/SuperGrok, e depois o escopo legado `https://accounts.x.ai/sign-in`. Exige campo `key` não vazio e conserva `principal_type`, expiração e identidade. Esta descrição veio do código público; o arquivo pessoal não foi aberto. [Leitor de credenciais](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokAuth.swift#L117-L224).

Há três formas de vincular uma fonte:

1. Reutilizar a conta conectada por `grok login` e seu arquivo de autenticação.
2. Informar manualmente um Bearer pessoal. O CodexBar injeta esse valor em `GROK_OAUTH_TOKEN`, que tem precedência sobre o arquivo. Tokens com prefixo `xai-` são recusados nesse roteamento porque são API keys, não assinatura pessoal.
3. Informar cookie manualmente ou importar uma sessão do browser. Essa fonte usa o caminho web, não o proxy OAuth.

O código examinado não implementa um novo login OAuth do zero para a coleta pessoal. Ele reaproveita login do Grok ou entrada manual/browser. [Roteamento de token e cookie](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCredentialRouting.swift#L3-L90), [precedência](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokSettingsReader.swift#L3-L39).

A importação de browser fica limitada a Chrome no descriptor Grok. O fluxo verifica cookie manual, cache e importação quando permitida pelo contexto. Uma resposta autenticada por cookie não recebe identidade nem nome do plano do `auth.json`: essas fontes podem ser contas diferentes. A captura de credencial é compartilhada entre cobrança e enriquecimento para evitar trocar de conta durante uma atualização de login. [Identidade e captura](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift#L400-L455), [cookies e fontes](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift#L503-L585).

Para o Metacodex, a coleta ACP existente continua tendo a vantagem de deixar tokens dentro do CLI. Uma integração HTTP adicional precisará de vinculação explícita da fonte e da conta, com leitura restrita ao arquivo esperado ou sessão escolhida. Importar cookies automaticamente de contas diferentes não deve ser consequência de um timeout do ACP.

## Unidades e dados que não devemos misturar

O schema ACP antigo do CodexBar chama os objetos monetários de `GrokCent`, usa `val: Int?` e comenta que são centavos. Calcula `usage.totalUsed.val / monthlyLimit.val * 100`. Porém esse schema tem `monthlyLimit` e `usage` no topo, diferente do envelope `config` recebido pelo nosso Grok 1.0.13. A declaração de unidade do schema antigo não comprova a unidade de todos os campos atuais do proxy. [Schema antigo](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokRPCClient.swift#L278-L338).

O parser moderno aceita `val: Double?` e não converte saldos em dólares. Quando não recebe `creditUsagePercent`, calcula `onDemandUsed/onDemandCap` se o limite extra for positivo. A unidade cancela na razão, mas a semântica continua sendo o limite on-demand. Não recomendo apresentar essa razão como franquia incluída da assinatura. Se implementada, precisa de outra categoria com origem e rótulo explícitos. [Fallback de razão](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokCreditsProxyFetcher.swift#L73-L90).

O próprio descriptor separa tokens locais e afirma que créditos da assinatura não são convertidos em dólares. Portanto, manter `prepaidBalance`, `onDemandCap` e valores absolutos ocultos até confirmar a unidade atual continua sendo uma decisão adequada. [Separação de tokens e assinatura](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokProviderDescriptor.swift#L87-L92).

Usar Grok ou um bot Grok dentro do Cursor pertence ao escopo de produto e cobrança daquele host. Isso não vincula a conta SuperGrok nem substitui a quota retornada pelos endpoints pessoais acima. A chave do painel deve incluir a conta e o produto que fornecem a métrica, não apenas o nome do modelo.

## Diferenças implementáveis em grok.rs

| Estado observado no Metacodex | Mudança recomendada |
| --- | --- |
| `normalize` sempre retorna `partial/noQuota`, inclusive se receber `creditUsagePercent: 37` | Aceitar percentual numérico finito publicado em `config`, gerar janela e remover `noQuota` nesse caso |
| Datas de cobrança e uso já separadas | Manter; calcular duração somente com início/fim correspondentes e válidos |
| Plano vem de `subscription_tier` | Manter para ACP; aceitar variantes camelCase somente nos parsers HTTP correspondentes |
| Nenhuma leitura direta de credencial | Manter ACP como primeira fonte; HTTP adicional precisa de uma fonte vinculada e isolada |
| Falta de percentual conserva uso indisponível | Preservar. Enriquecer com gRPC somente na integração adicional, sem inventar zero |
| Valores `val` são descartados | Continuar sem moeda ou quota incluída derivada até evidência suficiente |
| ACP atual usa versão numérica, `authenticate cached_token`, `_x.ai/billing` | Preservar contrato local verificado; não copiar o transporte antigo do CodexBar |

O [teste atual](/Users/victor/Documents/metacodex/src-tauri/src/usage/grok.rs:147) exige janela vazia para `creditUsagePercent: 37`. Esse caso deve ser revisto junto com a melhoria do parser. O teste de ausência de franquia com saldos zerados deve continuar passando.

O CodexBar envia `protocolVersion: "1"`, não autentica separadamente e chama `x.ai/billing` sem prefixo `_`. Sua resposta tipada não tem o envelope `config`. Isso não corresponde à prova anterior do CLI instalado; copiar esse cliente faria regredir uma integração já validada. [Cliente ACP CodexBar](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Sources/CodexBarCore/Providers/Grok/GrokRPCClient.swift#L109-L126), [cliente Metacodex](/Users/victor/Documents/metacodex/src-tauri/src/usage/grok.rs:98).

## Testes úteis e confiança

Os testes foram lidos, não executados. São principalmente fixtures e transportes simulados, portanto validam as decisões do projeto e não garantem disponibilidade do endpoint para a conta atual.

- Proxy: percentual 12.5, prioridade sobre on-demand, janela semanal completa, limites fracionários, clamp, período sem percentual, plano Heavy e pares de datas que não podem se misturar. [GrokCreditsProxyFetcherTests](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/GrokCreditsProxyFetcherTests.swift#L10-L295).
- Enriquecimento: percentual conhecido não é substituído; desconhecido permanece desconhecido se gRPC falhar; zero publicado é aceito; zero inferido sem prova estrutural é recusado; há orçamento de tempo. [Testes de fallback](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/GrokCreditsProxyFetcherTests.swift#L477-L655).
- Protobuf: fixture declarada capturada de um caso real, zero implícito com período ativo, frames truncados, varints inválidos, bytes opacos, enum desconhecido, período futuro/incompleto/expirado. [GrokZeroUsageTests](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/GrokZeroUsageTests.swift#L5-L149).
- Identidade: cookie não herda identidade/setting do arquivo CLI; billing indisponível de equipe não vira quota pessoal; ausência de percentual tem diagnóstico próprio. [Testes de conta e web](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/GrokWebBillingFetcherTests.swift#L83-L92), [testes de plano e período](https://github.com/steipete/CodexBar/blob/937b20813cf47340093b6c312331c63a52768097/Tests/CodexBarTests/GrokWebBillingFetcherTests.swift#L401-L481).

Confiança alta sobre o que o CodexBar implementa neste commit e sobre as diferenças de nosso parser. Confiança moderada sobre o schema externo inferido desses testes. Disponibilidade gRPC e unidade absoluta dos objetos `val` atuais permanecem sem validação nesta etapa. O ganho imediatamente sustentado pela pesquisa é interpretar percentual explícito quando existir, preservando ausência e separação de contas.

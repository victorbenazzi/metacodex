# Grok Build: coleta de uso da assinatura pessoal

Verificado em 16/09/2026. Escopo: CLI oficial instalado, documentação oficial, inspeção estática do executável e leitura ACP de cobrança. Nenhum prompt ou pedido de inferência foi enviado. Não foram criadas nem carregadas sessões de conversa, lidas transcrições ou abertas credenciais. A autenticação foi reutilizada internamente pelo próprio CLI. Nenhuma configuração externa foi editada pela pesquisa.

## Conclusão para implementação

Há um caminho funcional para consultar a conta pessoal sem alterar o terminal existente: iniciar um processo ACP temporário, inicializar, reutilizar a autenticação existente e chamar `_x.ai/billing`. Isso é uma extensão distribuída no CLI oficial, mas o contrato de cobrança não está documentado como API pública estável. Deve ser um adaptador versionado e tolerante a campos ausentes.

Na conta verificada, a resposta confirmou o plano `SuperGrok` e o período semanal. Não trouxe percentual consumido nem limite da franquia incluída. Portanto, a implementação pode apresentar plano, início/fim do período e estado de disponibilidade das métricas. Não deve inventar percentual, considerar ausência como zero ou atribuir moeda aos objetos `val` sem confirmação adicional.

Statusline é outro canal: oferece tokens, contexto e custo da sessão, mas não quota pessoal. O overlay `GROK_CONFIG` não aceita `ui.status_line` nesta versão. Integrá-lo ao terminal atual exige configurar a tabela global explicitamente ou aguardar uma opção oficial por lançamento. Não é necessário para a consulta ACP de conta.

## Proveniência

Executável: [/Users/victor/.grok/bin/grok](/Users/victor/.grok/bin/grok), link para [/Users/victor/.grok/downloads/grok-macos-aarch64](/Users/victor/.grok/downloads/grok-macos-aarch64).

- Versão: `grok 1.0.13 (5e9a58528b76) [stable]`.
- SHA-256: `8669e0fdadceec25b8c159c355f427ffbd82583525d774b6ab1522197ea83b80`.
- Ajuda consultada: `grok --no-auto-update --help`, `grok agent --help` e `grok agent stdio --help`.
- Inspeção estática: strings e guias incorporados no executável, principalmente `xai-grok-config/src/env_overlay.rs`, `xai-grok-shell/src/extensions/billing.rs`, `xai-grok-shell/src/extensions/usage.rs` e guia de statusline.
- Prova dinâmica: JSON-RPC sanitizado, descartando conteúdo bruto depois da leitura. Diretório temporário vazio como `cwd`; `clientCapabilities: {}`; sem `session/new`, `session/load`, `session/resume` ou `session/prompt`.

A documentação pública confirma ACP sobre stdin/stdout e o fluxo de autenticação existente. A referência do CLI identifica `inspect --json` como inspeção de configuração, não consumo. Não há subcomando externo `usage` ou `account` na ajuda desta versão. [Headless e ACP](https://docs.x.ai/build/cli/headless-scripting), [CLI Reference](https://docs.x.ai/build/cli/reference).

## Contrato ACP validado

Comando:

```sh
grok --no-auto-update agent --no-leader stdio
```

Solicitações, uma linha JSON por mensagem, aguardando a resposta de cada `id`:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"metacodex-usage","version":"1"},"clientCapabilities":{}}}
{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"cached_token","_meta":{"headless":true}}}
{"jsonrpc":"2.0","id":3,"method":"_x.ai/billing","params":{}}
```

O prefixo `_` é obrigatório na mensagem transportada. `x.ai/billing` retornou `-32601`; `_x.ai/billing` chegou ao handler. Métodos personalizados ACP usam esse prefixo. [Extensões ACP](https://agentclientprotocol.com/rfds/rust-sdk-v1).

O servidor anunciou `authMethods: [{id: "grok.com", ...}]`, porém aceitou `cached_token` com `headless: true`, que também aparece no exemplo oficial. A resposta de autenticação contém metadados de conta; o coletor deve ignorá-los, salvo campos explicitamente necessários e autorizados, sem registrar email, IDs ou nomes. O plano também vem na resposta de cobrança, evitando depender desses metadados. [Fluxo oficial ACP](https://docs.x.ai/build/cli/headless-scripting).

Notificações intercaladas observadas incluem `_x.ai/mcp/servers_updated`, `_x.ai/models/update`, `_x.ai/settings/update` e `_x.ai/announcements/update`. O leitor precisa processar linhas completas já armazenadas no buffer antes de esperar novos bytes no descritor. Ignorar notificações desconhecidas e correlacionar respostas pelo `id` evita falso timeout. Elas não devem ser tratadas como resposta de cobrança.

Encerrar o processo após a consulta. Não responder a solicitações de execução de ferramentas. O adaptador não precisa oferecer filesystem, terminal, MCP ou permissão de ferramentas. Timeout, falha de autenticação, método ausente e erro de rede devem ser estados distintos.

### Fixture de cobrança

Shape capturado na conta real; datas substituídas por valores fictícios. Nenhum identificador de conta é necessário neste resultado:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "config": {
      "currentPeriod": {
        "type": "USAGE_PERIOD_TYPE_WEEKLY",
        "start": "2026-01-01T12:00:00+00:00",
        "end": "2026-01-08T12:00:00+00:00"
      },
      "onDemandCap": { "val": 0 },
      "onDemandUsed": { "val": 0 },
      "prepaidBalance": { "val": 0 },
      "isUnifiedBillingUser": true,
      "billingPeriodStart": "2026-01-01T12:00:00+00:00",
      "billingPeriodEnd": "2026-01-08T12:00:00+00:00"
    },
    "subscription_tier": "SuperGrok"
  }
}
```

Observações de contrato:

| Campo | Evidência | Uso seguro |
| --- | --- | --- |
| `result.subscription_tier` | String recebida: `SuperGrok` | Nome do plano |
| `config.currentPeriod.type` | String recebida: `USAGE_PERIOD_TYPE_WEEKLY` | Período semanal; outros valores precisam de fallback |
| `currentPeriod.start/end` | Strings ISO recebidas | Datas do período retornado |
| `billingPeriodStart/End` | Strings ISO recebidas | Datas de cobrança, conservadas separadamente |
| `isUnifiedBillingUser` | Boolean recebido | Detalhe técnico do adaptador |
| `onDemandCap/Used`, `prepaidBalance` | Objetos `{val: 0}` recebidos | Preservar como dado bruto não exibido até unidade confirmada |
| `creditUsagePercent` | Nome presente no handler e serializador do binário; ausente na resposta real | Não preencher como zero; tipo, intervalo e semântica ainda não confirmados |
| `monthlyLimit` | Nome presente no binário; ausente na resposta real | Não inferir valor ou unidade |
| `billingCycle`, `includedUsed`, `totalUsed`, `history` | Nomes encontrados no processamento de billing | Não há fixture suficiente para implementar estes ramos |

O executável contém tipos `BillingConfig` com 11 campos, `BillingConfigResponse` com 3 e `BillingPeriodUsage` com 4. Isso confirma mais de um formato interno, mas as strings do binário não bastam para determinar tipos e unidades de campos opcionais. Não foi encontrado um vínculo comprovado entre esses objetos `val` e USD, centavos, nanos ou ticks. A existência de contadores monetários em outras APIs xAI não prova a unidade deste endpoint.

O handler faz uma leitura autenticada de `/billing?format=credits`. O coletor deve deixar essa chamada e suas credenciais sob responsabilidade do CLI. Não há motivo para reproduzir HTTP autenticado lendo arquivos de tokens.

Uma busca final no binário não encontrou `_x.ai/usage` para conta nem outro método de consulta de quota. Foram identificados billing, o ledger `x.ai/session/usage`, a leitura de regra de auto top-up e `x.ai/auth/check_subscription`. Estes dois últimos não têm contrato de consumo comprovado e não foram invocados. Há apenas uma ocorrência de `/billing?format=credits`; não foi confirmado parâmetro ACP para alterar o formato. Não enviar variantes especulativas. O nome `creditUsagePercent` aparece no handler e no serializador, mas sua ocorrência estática não prova o tipo numérico nem a escala. A fixture desta conta continua sendo a fonte para o comportamento implementável agora.

### Erros observados

- Sem autenticar o ACP: `-32000`, `Authentication required`.
- Método sem prefixo `_`: `-32601`, método desconhecido.
- Sandbox sem acesso de rede: `-32603`, erro de envio da leitura de billing. A leitura autorizada com rede e autenticação existente funcionou.
- O método não exigiu `sessionId` nem sessão de conversa.

## Statusline: schema e limites

A página pública descreve scripts que recebem JSON em stdin, `type = "command"`, comandos em `~/.grok/config.toml` e atualização por `refresh_interval`. Ela não publica o schema completo. O guia incorporado no executável 1.0.13 traz a tabela completa abaixo, portanto essa parte é evidência estática da versão instalada, não payload capturado após inferência. [Status line](https://docs.x.ai/build/features/status-line).

| Grupo | Campos informados pelo guia incorporado |
| --- | --- |
| Identidade | `schema_version`, `version`, `cwd`, `session_id`, `session_name`, `prompt_id`, `transcript_path` |
| Modelo | `model.id`, `model.display_name`, `effort.level` |
| Workspace | `workspace.current_dir`, `repo_root`, `branch`, `git_worktree`, `repo.host/owner/name` |
| Custo | `cost.total_duration_ms`, `total_cost_usd`, `total_api_duration_ms` |
| Contexto atual | `context_window.context_window_size`, `context_tokens`, `used_percentage`, `remaining_percentage`, `auto_compact_threshold_percent` |
| Tokens acumulados | `context_window.session_input_tokens`, `session_output_tokens`, `session_usage.input_tokens/output_tokens/cache_creation_input_tokens/cache_read_input_tokens` |
| Turno | `turn.started_at_ms` |
| Worktree | `worktree.name/path/branch/main_worktree_root` |
| Execução do script | `trigger`: `state` ou `refresh_interval` |

Semântica declarada no guia incorporado:

- `context_tokens` mede ocupação atual e pode cair com compactação. Não é o consumo acumulado.
- `session_input_tokens` e `session_output_tokens` são acumulados; os três contadores de entrada em `session_usage` somam `session_input_tokens`.
- `session_usage` pode faltar antes da primeira chamada. Outros campos desconhecidos são omitidos.
- `cost.total_cost_usd` pode faltar quando não há preço reportado ou o ledger não pode ser lido. Ausência não significa gratuidade.
- Duração e custo consideram a conexão do processo atual; retomada começa nova medição nesses campos.
- `session_name` e `trigger` existem no stdin do comando, mas não em `SessionStatus`.
- O payload exclui explicitamente resumo de rate limits e quota de assinatura.
- Timer de refresh reutiliza o último payload recebido. Não torna os números da sessão novos por si só.

Um fixture sintético mínimo, restrito a métricas, seria:

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "model": { "id": "grok-4.6", "display_name": "Grok 4.6" },
  "context_window": {
    "context_window_size": 500000,
    "context_tokens": 25000,
    "used_percentage": 5,
    "remaining_percentage": 95,
    "session_input_tokens": 40000,
    "session_output_tokens": 1200,
    "session_usage": {
      "input_tokens": 10000,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 30000,
      "output_tokens": 1200
    }
  },
  "trigger": "state"
}
```

Não atribuir a esse fixture uma versão de schema inventada. Uma integração real deve conferir `schema_version` quando recebê-lo, tolerar campos extras e rejeitar incompatibilidades conhecidas.

## Configuração por lançamento

O guia incorporado confirma que `GROK_CONFIG` é um objeto JSON e `GROK_CONFIG_PATH` aponta para overlay adicional JSON ou TOML. Há merge profundo, com precedência acima de user/managed config e abaixo das políticas obrigatórias.

Entretanto, o allowlist limita o overlay a `models`, `features`, partes de `toolset` e filtros de `shell_environment_policy`. Outras tabelas são descartadas. O texto especifica que o overlay não pode executar comandos. Consequentemente, `ui.status_line` não é configurável por esse mecanismo no build instalado.

Não foram encontrados `--settings`, `--config`, `GROK_STATUS_LINE` ou equivalente suportado para statusline. O `-c` do comando principal significa continuar sessão, não arquivo de configuração. `GROK_HOME` muda também autenticação e armazenamento; não é um substituto adequado para injetar somente statusline. Config de projeto não aceita essa seção. [Configurações](https://docs.x.ai/build/settings), [Referência de configurações](https://docs.x.ai/build/settings/reference).

Existe `grok agent --plugin-dir <DIR>` para plugins por processo em ACP, confirmado na ajuda. O guia incorporado diz que é ignorado no modo leader. Não foi confirmado como opção do terminal TUI principal nem como forma de configurar statusline. Transformar o PTY existente em um novo processo ACP só para obter métricas de sessão seria outra arquitetura.

### Opção explícita para statusline no futuro

Se a UI oferecer ativação, a alteração mínima seria somente a tabela `[ui.status_line]` do arquivo de usuário. Exemplo conceitual, não aplicado:

```toml
[ui.status_line]
type = "command"
command = "/caminho/gerenciado/pelo/metacodex/grok-statusline"
```

Antes de aplicar, mostrar a mudança concreta e detectar se já existe statusline. Preservar sua configuração, encadear o comando original com o mesmo stdin e stdout quando tecnicamente possível, ou informar a substituição explicitamente. Escrever com parser TOML que preserve as outras chaves. Guardar apenas o estado anterior dessa tabela para desfazer, evitando duplicar configurações potencialmente sensíveis. Restaurar somente se a tabela ainda corresponder à configuração instalada pelo Metacodex. Nenhuma dessas mutações foi realizada nesta pesquisa.

## Quota pessoal, sessão e API xAI

`/usage` é o comando de UI para créditos e cobrança. `_x.ai/billing` consulta a conta autenticada no Grok, independentemente da sessão de conversa. `_x.ai/session/usage`, encontrado no binário, é leitura de ledger de uma sessão e não deve substituir a quota da conta. Seu schema completo não foi validado. [Modes and Commands](https://docs.x.ai/build/modes-and-commands).

As APIs xAI com API key e Management API são outro escopo de cobrança. Nenhuma chave API foi solicitada ou usada explicitamente pela pesquisa. Tokens de contexto não permitem calcular percentual restante da assinatura, e custo de inferência equivalente não é fatura da assinatura pessoal.

## Nota breve sobre Cursor

Verificação estática adicional, solicitada durante a pesquisa, no build `2026.08.25-3e8eec8`:

- [89.index.js](/Users/victor/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/89.index.js) implementa `/usage` consultando `getCurrentPeriodUsage`, `getHardLimit` e `getPlanInfo`. A UI separa franquia incluída e on-demand, com percentuais e fim do ciclo.
- [4374.index.js](/Users/victor/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/4374.index.js) implementa `about`, trazendo plano e dados de conta, sem quota.
- [4943.index.js](/Users/victor/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/4943.index.js) contém o handler ACP concreto. Seu `extMethod` atende apenas a extensão de listagem de modelos; os demais métodos retornam `methodNotFound`. Não foi encontrado equivalente externo ao billing do Grok.
- [index.js](/Users/victor/.local/share/cursor-agent/versions/2026.08.25-3e8eec8/index.js) registra `status/whoami` como status de autenticação e `about` como versão/sistema/conta. Isso não expõe a consulta interna da franquia como comando público.

Conclusão restrita ao build inspecionado: os hooks de tokens por turno continuam sendo o caminho disponível já identificado pelo implementador. Não é justificável ler credenciais ou reproduzir o transporte privado da UI para preencher a franquia pessoal.

## Confiança e limitações

Alta confiança: chamada ACP de billing sem inferência, reutilização de autenticação, fixture de plano/período, ausência real de quota na conta verificada, statusline excluindo rate limits, overlay incapaz de instalar statusline.

Média confiança: permanência desse contrato em versões futuras, pois `_x.ai/billing` não é descrito como API pública estável. Proteger com detecção da versão e tratamento de método inexistente.

Ainda não confirmado: unidade de `val`, tipo/escala de `creditUsagePercent`, formatos mensais ou de outras assinaturas e cobertura monetária de branches opcionais. Não exibir nem agregar esses campos até confirmação por schema ou fixture representativo.

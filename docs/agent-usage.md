# Uso dos agentes

Implementação local de 2026-09-16. Sem publicação ou atualização do aplicativo instalado.

## Acesso

O item **Usage** fica imediatamente acima de **Settings** na sidebar. No idioma português, o rótulo é **Uso**.

- Passar o mouse ou focar pelo teclado abre um resumo por agente, após um pequeno atraso no hover.
- Clicar no item abre uma tela ampla sobre o workspace. Clicar em um agente do resumo abre seu detalhe.
- Escape, o botão de fechar e o atalho configurado para fechar aba encerram Usage. Os terminais permanecem montados.
- A paleta de comandos oferece **Agent usage / Uso dos agentes**, inclusive com a sidebar recolhida. O comando também aceita um atalho personalizado em Settings.

## Integrações entregues

| Agente | Disponível nesta versão | Limitação |
|---|---|---|
| Codex | Conta atual do CLI, múltiplas janelas de cota, renovação e histórico diário informado pelo provedor | Atividade da conta inteira. Não atribui tokens ou cobrança a projetos |
| Claude Code | Integração opcional da statusline para novas sessões, cotas quando informadas e estimativa por execução | Requer atividade e versão/plano compatíveis. Usa a última sessão observada, sem presumir identidade da conta |
| Cursor | Cota do plano, Auto/Composer e modelos de terceiros, valores incluídos e sob demanda, histórico da conta de 30 dias e tokens locais por projeto | A conta exige conexão por arquivo do editor ou cookie de sessão. Eventos remotos não têm atribuição por projeto |
| Grok Build | Plano pessoal, períodos e percentual da cota, com complemento autenticado do billing | O formato é privado e pode mudar. Campos ausentes continuam indisponíveis |

No detalhe Claude, **Habilitar para novas sessões** ativa a coleta nos lançamentos feitos pelo Metacodex. Ela substitui a statusline daquela execução por uma linha simples de consumo. A preferência é desativada inicialmente. Arquivos globais e do projeto não são modificados. Lançamentos com `--settings` explícito ou `--bare` são preservados. Políticas gerenciadas podem impedir a coleta. Desabilitar a integração interrompe novas gravações, inclusive de sessões já abertas.

O histórico Codex permite períodos de 7, 30 e 90 dias. Dias ausentes não são tratados como zero. Contadores de tokens atravessam o IPC como strings e são somados com BigInt. Estimativas Claude são separadas por execução e não são somadas, pois podem reiniciar ao retomar uma sessão ou usar `/clear`.

No detalhe Cursor, **Habilitar para novas sessões** instala um plugin somente nos lançamentos feitos pelo Metacodex. O hook oficial `afterAgentResponse` fornece tokens quando um turno termina. Contadores ausentes continuam indisponíveis. Eventos repetidos da mesma conversa e geração substituem a mesma amostra, sem somar novamente. A configuração global do Cursor não é alterada. A detecção e o lançamento usam `cursor-agent` para evitar o alias `agent`, que também é instalado pelo Grok.

O Grok consulta `initialize`, `authenticate` com `cached_token` em modo headless e `_x.ai/billing` pelo ACP do CLI instalado. Não abre conversa, sessão de inferência ou navegador de login. A leitura inicial pelo ACP confirmou SuperGrok e datas de períodos. A consulta autenticada adicional foi validada com a conta real e retornou uma janela de cota. O contrato é específico do CLI, não uma API pública estável. Campos de crédito sem unidade e escala comprovadas não são exibidos. O painel não transforma a ausência de franquia em 0% utilizado.

### Conectar contas pessoais

No detalhe Cursor ou Grok, **Conectar conta local** abre um seletor nativo na pasta esperada. Para Cursor, selecione `state.vscdb` do editor; para Grok, selecione `auth.json` criado pelo login da CLI. A autorização cobre somente o arquivo escolhido e, no caso SQLite, seus arquivos auxiliares de journal. Caminhos arbitrários não são aceitos pelo IPC. Arquivos e componentes simbólicos são rejeitados. A base Cursor é aberta em modo somente leitura e respeita o WAL.

Para quem usa apenas Cursor CLI, **Usar sessão do navegador** aceita o valor de `WorkosCursorSessionToken` de cursor.com. O campo é mascarado e limpo após enviar. O cookie permanece apenas na memória do backend até desconectar ou fechar o aplicativo; ele não é salvo em preferências, cache ou logs. A integração não importa automaticamente cookies de outros navegadores.

O Cursor consulta `/api/auth/me`, `/api/usage-summary` e `/api/dashboard/get-filtered-usage-events`. Percentuais já estão na escala 0-100; 0,36 significa 0,36%. Valores monetários são convertidos de centavos para USD. `chargedCents` representa o débito do plano e `tokenUsage.totalCents` o equivalente de API. O histórico cobre 30 dias UTC, exige paginação completa e mantém valores ausentes como indisponíveis. Falhas no histórico não apagam uma cota válida. Repetições entre páginas só são removidas na fronteira, quando o total informado comprova o excesso.

O Grok usa o token do arquivo selecionado em `https://cli-chat-proxy.grok.com/v1/billing?format=credits`. Se o percentual não vier nessa resposta, tenta `https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig` por gRPC-web. O complemento tem orçamento de 6 segundos e sua falha preserva os períodos válidos. O parser exige frame completo, trailer de sucesso e campos conhecidos. Só infere zero omitido por protobuf quando há um período mensal ou semanal ativo completo e nenhum campo de percentual. JSON sem percentual não significa zero. Saldos de créditos sem unidade comprovada não são convertidos para moeda. Credenciais de equipe e arquivos com várias contas OIDC são rejeitados para evitar escolha implícita.

**Desconectar conta** revoga essa leitura no Metacodex e descarta o cache autenticado, sem sair da conta no provedor. O Grok volta à leitura básica do CLI. Trocar de login invalida os resultados anteriores, inclusive uma resposta que ainda estivesse em andamento. Erros transitórios só preservam dados quando a credencial é a mesma; expiração ou rejeição de autenticação removem as cotas anteriores.

O filtro de projeto se aplica às sessões locais, aos turnos Cursor e às estimativas Claude. As cotas e os históricos remotos mantêm seu escopo de conta.

## Coleta e persistência

- React solicita leituras por comandos Tauri centralizados. Detecção de executáveis, processos e arquivos ficam no Rust.
- O cliente auxiliar Codex utiliza somente `initialize`, `initialized`, `account/read`, `account/rateLimits/read` e `account/usage/read`. Não inicia turnos de inferência nem solicita login ou resgate de créditos.
- Requisições concorrentes compartilham a mesma atualização. Enquanto a interface está aberta e visível, consulta o cache a cada 30 segundos. O backend consulta Codex e as contas conectadas em paralelo, no máximo a cada 120 segundos; atualização manual respeita um intervalo de 15 segundos.
- Falhas transitórias preservam leituras identificadas da mesma conta e as marcam como desatualizadas. O ACP Grok não fornece identidade, portanto falhas descartam sua leitura anterior. Janelas vencidas ficam aguardando atualização, sem inventar saldo renovado.
- Cache e preferências ficam em `~/.metacodex/state/usage/`, respeitando `METACODEX_HOME`. As autorizações guardam apenas o caminho escolhido. Credenciais não são copiadas. Cache e histórico autenticados Cursor/Grok permanecem na memória, vinculados a um hash da credencial.
- O helper Claude usa uma autorização por lançamento, aceita até 64 KiB de JSON e grava somente campos permitidos. Prompts, respostas e caminhos de transcrições não são persistidos pela integração.
- O helper Cursor aceita até 4 MiB de JSON, valida uma autorização por lançamento e persiste apenas IDs, modelo, contadores e horário. Descarta texto, email e caminhos de transcrições. Os arquivos gerados ficam em `state/usage/cursor/`, com retenção de 90 dias e limite de 500 turnos no painel.
- Amostras Claude têm retenção de 90 dias e a tela apresenta as últimas 50 execuções observadas. A identidade de conta não é inferida desse payload.

## Validação

- `pnpm build`: aprovado.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm test`: 208 testes aprovados. Essa opção evita uma incompatibilidade do Node 26.7.0 local com `localStorage` nos testes existentes de Worktrees.
- `cargo test` em `src-tauri`: 92 testes unitários e 2 testes de integração dos helpers aprovados. Os quatro testes de rede ficam ignorados por padrão.
- Consulta real do adaptador Codex, executada explicitamente: 3 janelas de cota e 90 dias de histórico retornados. Sem expor identidade da conta nos logs do teste.
- Helpers Claude e Cursor executados como subprocessos com fixtures: rejeitam ausência de autorização, removem campos não permitidos e param de persistir após desativação. Cursor também verifica duplicação por conversa e geração.
- Adaptador HTTP Grok testado explicitamente com a conta pessoal real: billing recebido e uma janela de cota. O teste registra apenas status e número de janelas, sem identidade ou credenciais. Cursor validado com fixtures de contratos e banco SQLite com WAL ativo. A consulta real usando a sessão existente retornou três janelas de cota e 13 dias com atividade no intervalo de 30 dias, sem falha no histórico. Os testes explícitos não persistem uma conexão na configuração do usuário.
- Testes adicionais cobrem troca de conta, descarte por autenticação expirada, distinção entre custo equivalente e débito real, paginação incompleta, SQLite/WAL e substituição de arquivo autorizado por link simbólico.
- Interface renderizada em navegador com dados de teste: resumo, detalhes, histórico, seleção do agente, ativação Claude e Cursor, tabela de tokens, períodos Grok, Escape, Cmd+W e restauração de foco. Temas claro/escuro, inglês/português e janela mínima de 880 x 560 verificados.

Nenhuma sessão real de Claude ou Cursor foi iniciada para gerar tráfego de inferência durante a validação. O formato do hook Cursor e o carregamento do plugin foram conferidos no software distribuído `2026.08.25-3e8eec8`; a execução do helper foi testada com fixture. O Grok foi validado em `1.0.13`. Empacotamento de release e execução no Windows não foram realizados. A integração usa endpoints autenticados privados e credenciais do próprio usuário. Não exige chaves administrativas nem automatiza páginas de login. O aplicativo instalado não foi substituído.

## Continuação planejada

O statusline global do Grok pode oferecer tokens de sessão, mas configurá-lo está fora desta integração ACP; o overlay por processo não aceita essa opção. Integrações administrativas, alertas do sistema, exportação, atribuição exata de tokens por projeto e OpenTelemetry Claude continuam fora desta entrega.

Referências e avaliação das fontes: [estudo do painel](research-agent-usage-panel.md) e [levantamento de provedores](research-agent-usage-providers.md) e [pesquisa da assinatura pessoal Grok](research-grok-personal-usage.md).

A referência para os adaptadores autenticados está no [estudo do CodexBar](research-codexbar-collection.md). A licença e a atribuição estão em [third-party-notices.md](third-party-notices.md).

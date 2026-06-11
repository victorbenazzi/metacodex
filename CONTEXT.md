# metacodex

Workspace local-first para desenvolvimento com agentes (Tauri 2 + React). Este glossário fixa a linguagem do domínio; não é spec nem repositório de decisões de implementação.

## Language

### Agents (Agent View)

**Agente**:
Entidade persistente com identidade e estado contínuo entre execuções: tem definição própria (prompt, modelo, tools, skills), memória durável, logs e agenda. É global (existe independente de projeto e pode trabalhar em vários); cada execução acontece num diretório de trabalho específico. Cada execução de um Agente é uma sessão opencode; o opencode é o motor, o metacodex é o harness de vida.
_Avoid_: preset, template, perfil, "bot", agente de projeto

**Agente opencode**:
A definição `config.agent` nativa do opencode (nome + prompt + modelo + tools). É o formato de execução para o qual a definição de um Agente é compilada; não tem estado próprio.
_Avoid_: confundir com Agente (a entidade metacodex)

**Diretório do Agente**:
O lar de um Agente: arquivos planos com persona (AGENT.md), config do harness, checklist de heartbeat, Memória, skills próprias, reports, logs e Diário. É um repositório git com checkpoints commitados pelo harness; é o artefato completo de portabilidade (ADRs 0001 e 0002).
_Avoid_: workspace (já significa outra coisa no app), pasta de config

**Memória**:
Conhecimento durável do Agente, em arquivos markdown editáveis à mão: um índice enxuto (uma linha por memória) mais um arquivo por fato. O índice entra em toda execução; os arquivos completos são lidos sob demanda. Quem escreve é o próprio Agente, durante a execução. Tem duas camadas: memória do Agente (vai com ele para qualquer projeto) e memória por projeto (o que ele sabe daquela codebase).
_Avoid_: histórico, transcript, contexto (memória não é o log da conversa)

**Scheduled Task**:
Prompt agendado por cron padrão num único scheduler. Pode ser solta (sem identidade, roda full-auto, comportamento original) ou pertencer a um Agente (aí é uma Execução dele: roda com definição, memória e preset do Agente, gera Log e Report, conta para o Dream). Uma task solta pode ser promovida a um Agente depois.
_Avoid_: dois sistemas de agendamento, "cron do agente" como mecanismo separado

**Execução**:
Uma sessão opencode rodada por um Agente, com gatilho: chat, Cron, Heartbeat, Continuação ou Dream. Execuções autônomas (tudo menos chat) respeitam o preset de permissão do Agente: um pedido de permissão pausa a execução, vira item "precisa de você" no Work + notificação OS, e sem resposta em 30 min a execução aborta graciosamente com Report.
_Avoid_: run, job, sessão (sessão é o objeto opencode; Execução é o conceito com gatilho e log)

**Dream**:
Execução agendada de manutenção em que o Agente, sem tarefa do usuário, processa a experiência recente: consolida Memória (promove, deduplica, comprime, poda), escreve o Diário e produz Propostas de melhoria. Só escreve dentro do diretório do Agente, nunca em projetos; nunca aplica mudanças na própria definição. Dispara após N execuções concluídas ou por cron diário (o que vier primeiro), e só se houver material novo.
_Avoid_: reflexão, manutenção, GC

**Diário**:
Registro curto escrito pelo Agente ao fim de cada Dream: o que fiz, o que aprendi, o que faria diferente. Parte do diretório do Agente.
_Avoid_: log (Diário é prosa do Agente; log é registro do harness)

**Proposta**:
Sugestão produzida pelo Agente que exige aprovação do usuário: mudança no próprio prompt/persona, skill própria nova, ou rascunho de um Agente novo. Permissões, modelo, tools e agenda são superfícies exclusivas do usuário; Agente nunca cria Agente diretamente. Fica em fila (diff aprovar/rejeitar); nunca é auto-aplicada, e rejeições viram Memória.
_Avoid_: auto-update, patch automático

**Log**:
Registro factual e automático do harness sobre cada execução do Agente: gatilho, início/fim, resultado, sessão associada, custo. Vive no diretório do Agente. Não confundir com Diário (prosa do Agente no Dream) nem Report.
_Avoid_: histórico de chat

**Report**:
Texto curto escrito pelo Agente ao fim de uma execução autônoma que fez trabalho: o que pediram, o que fiz, o que precisa de você. Chat interativo não gera Report (a conversa já é o report); heartbeat sem ação vira só Log. Reports formam o feed de Atividade no perfil do Agente; não lido vira badge na sidebar e "precisa de você" dispara notificação OS.
_Avoid_: resumo de sessão, notificação (Report é o documento; a notificação é consequência)

**Delegação**:
Um Agente invocando outro Agente como subagente (via tool task). O convidado roda com a definição dele e leitura da própria Memória, mas a execução pertence ao anfitrião: log fica no anfitrião e o convidado não grava Memória. Profundidade máxima 2 (Agente → Agente → subagentes efêmeros).
_Avoid_: handoff permanente, transferência de sessão

**Heartbeat**:
Pulso periódico (estilo OpenClaw) em que o Agente acorda sem tarefa definida, lê sua checklist permanente (HEARTBEAT.md, editável pelo usuário) e decide se algo precisa de ação; se nada, encerra com um OK curto que o harness suprime. Configurável por Agente, desligado por default. Heartbeats perdidos colapsam em um no catch-up; difere de Cron, que é "faça X no horário T" e não roda em catch-up.
_Avoid_: polling, cron disfarçado

**Continuação**:
Pedido que o Agente faz ao harness no fim de uma execução: "não acabei, me continue" (imediata, para ganhar contexto limpo) ou "me acorde em X" (com delay, para esperar o mundo mudar). A nova sessão recebe o resumo do estado. Cap default de 10 por tarefa, configurável por Agente. Missões permanentes não são Continuação: vivem na checklist do Heartbeat.
_Avoid_: loop infinito, retry, auto-respawn

**Subagente**:
Sessão filha (child session, `parentID`) criada via tool `task` durante uma execução. Efêmera por natureza; pertence à execução, não tem identidade própria.
_Avoid_: agente filho permanente

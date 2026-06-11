# Agentes: entidades persistentes no Agent View (design fechado)

Status em 2026-06-11. Este documento consolida a entrevista de design da feature
"Agentes": agentes reutilizáveis com identidade, memória, autonomia, agenda e
auto-melhoria, rodando 100% sobre o sidecar opencode como motor de execução e
provedor de modelo. O vocabulário canônico está em `CONTEXT.md` (seção Agents);
as duas decisões estruturais estão em `docs/adr/0001` (arquivos portáveis, sem
daemon) e `docs/adr/0002` (agent home é repo git). Leia os três antes de mexer.

Complementa (não substitui) `AGENT_HARNESS_FEATURES.md`: as invariantes de lá
(directory scoping, eventos só em `chat.events.ts`, one-way deps, segredos
sanitizados no Rust, i18n nos dois locales, espelho IPC) valem para tudo aqui.

---

## Decisões fechadas (resumo da entrevista)

1. **Ontologia:** Agente é entidade persistente, não preset. opencode é o motor;
   metacodex (Rust) é o harness de vida (agenda, catch-up, logs, git).
2. **Escopo:** global, independente de projeto, com lista de projetos permitidos
   por agente. Toda execução roda com `?directory=` de um projeto da lista.
3. **Vida:** só com o app aberto (scheduler Rust atual) + catch-up ao reabrir.
   Formato 100% arquivos planos para futuro runner externo (trigger.dev, GH
   Actions, Railway, VPS). Visão futura: metacodex facilita esse deploy.
4. **Memória:** índice (`MEMORY.md`, uma linha por memória) + um arquivo por
   fato. Índice entra em toda execução; arquivos lidos sob demanda com a tool
   `read`. Quem escreve é o próprio agente durante a execução. Duas camadas:
   global do agente + por projeto (`memory/projects/<id>/`), nunca misturadas.
5. **Dream:** execução de manutenção (consolida memória, escreve Diário, produz
   Propostas). Só escreve dentro do agent home. Gatilho: após N execuções
   concluídas (default 5) OU cron diário, o que vier primeiro, e só se houver
   material novo desde o último dream.
6. **Auto-melhoria:** via Propostas geradas no Dream, nunca auto-aplicadas.
   Superfície mutável: próprio `AGENT.md` + skills próprias + rascunho de agente
   novo. Permissões, modelo, tools e agenda: só o usuário. Fila com diff
   aprovar/rejeitar; rejeição (com razão) vira memória.
7. **Heartbeat:** estilo OpenClaw. `HEARTBEAT.md` como checklist permanente;
   pulso periódico decide se algo precisa de ação; "nada a fazer" = OK curto
   suprimido (só log). Configurável por agente, **default desligado**.
   Heartbeats perdidos colapsam em 1 no catch-up; cron perdido NÃO roda no
   catch-up (só fica visível no log).
8. **Loops = Continuação:** o agente pede ao harness "não acabei, me continue"
   (imediata, contexto limpo) ou "me acorde em X" (delay, esperar o mundo).
   Cap default 10 por tarefa, configurável por agente.
9. **Subagentes e delegação:** efêmeros via tool `task` (já existe). Agente
   chama Agente como subagente: convidado roda com a definição dele + leitura
   da memória dele, mas log fica no anfitrião e convidado NÃO grava memória.
   Profundidade máxima 2. Agente nunca cria Agente persistente direto (só via
   Proposta).
10. **Logs e Reports:** Log = registro factual do harness por execução (JSON).
    Report = prosa curta do agente ao fim de execução autônoma que trabalhou
    (markdown com frontmatter). Chat não gera report; heartbeat ocioso também
    não. Feed na aba Atividade do perfil; badge na sidebar; "precisa de você"
    dispara `notify_show`.
11. **Permissão em execução autônoma (decisão B):** roda com o preset do
    agente; `permission.asked` pausa a execução, vira item needs-attention +
    notificação OS; sem resposta em 30 min aborta graciosamente com report.
    Cron solto (sem agente) continua full-auto como hoje.
12. **Scheduled Tasks (decisão C):** UM scheduler (CronStore evolui). Task
    ganha campo opcional `agent`. Sem agente = comportamento atual exato. Com
    agente = Execução do agente (definição, memória, preset, log, report,
    conta para o dream). Crons do agente espelhados em `agent.json` (gerado;
    fonte de verdade em runtime é o CronStore). Task solta pode ser promovida.
13. **UI:** quarta section `agents` no `nav.store` (sidebar acima de Scheduled
    Tasks). Lista de agentes (avatar, nome, status idle/working/needs-you) →
    perfil com abas laterais (padrão do Customize): Persona / Memória / Agenda
    / Atividade / Propostas. AgentPicker no composer (trava modelo+preset nos
    do agente); "nenhum agente" continua o default absoluto. Toggle do composer
    renomeia "Agent | Agent Swarm" → **"Solo | Swarm"**. Builder com formulário
    (nome, **ícone/foto**, persona, modelo, preset, projetos) + "descreva o
    agente que você quer" (one-shot que pré-preenche, nunca auto-salva, padrão
    `cron.fromText`).

## Anatomia do agent home

```
~/.metacodex/agents/<slug>/          # repo git; harness commita checkpoints
├── AGENT.md          # persona/prompt (única parte que Proposta pode tocar)
├── agent.json        # harness config: modelo+variant, preset, projetos,
│                     #   heartbeat {enabled, interval}, dreamAfterRuns,
│                     #   continuationCap, avatar (emoji ou "avatar.png"),
│                     #   crons (ESPELHO gerado do CronStore)
├── avatar.png        # opcional (ou emoji no agent.json)
├── HEARTBEAT.md      # checklist permanente (usuário edita; Proposta pode propor)
├── MEMORY.md         # índice da memória global
├── memory/           # um arquivo .md por fato
│   └── projects/<projectId>/   # camada por projeto (MEMORY.md + arquivos)
├── skills/           # skills próprias (entram no catálogo do skills.rs)
├── reports/          # YYYY-MM-DD-<slug>.md com frontmatter {data, gatilho,
│                     #   projeto, status: ok|needs-you|aborted}
├── logs/             # runs.jsonl: {gatilho, início, fim, resultado, sessão,
│                     #   custo/tokens, continuações}
└── journal/          # diários de dream
```

Commits do harness: após cada execução, dream e proposta aplicada.

## Herança vs por agente (v1)

| Superfície | v1 |
|---|---|
| Persona/prompt | Por agente (`AGENT.md`) |
| Modelo + variant | Por agente, do catálogo existente |
| Permissões | Por agente: um dos 3 presets existentes (sem ruleset custom) |
| Skills | Próprias + catálogo global inteiro visível |
| Tools/MCP | Herda tudo habilitado globalmente (seleção por agente = v2) |
| Projetos | Lista por agente (default: todos os registrados) |
| Agenda | Por agente (heartbeat, crons, dream, caps) |

O harness valida que toda execução autônoma roda num diretório da lista de
projetos do agente (mitiga o gap do opencode rodar fora do sandbox de roots).

---

## Fases (cada uma utilizável sozinha)

### Fase 1: a entidade existe (IMPLEMENTADA 2026-06-11; smoke na UI pendente)

Escopo: agent home (git init via git2 já disponível no Rust), `AGENT.md` +
`agent.json` + avatar, compilação para `config.agent` na camada
`OPENCODE_CONFIG` (estender o gerador de `agent/mcp.rs`, hoje só `mcp`),
section `agents` + lista + perfil (aba Persona), builder (+ one-shot
pré-preenchendo), AgentPicker no composer, rename Solo | Swarm.

API/superfície:
- Rust novo: `agent/entities.rs` (AgentStore: scan de `~/.metacodex/agents/`,
  CRUD, git checkpoint, sanitização). Comandos: `agent_entity_list | create |
  update | delete` (+ espelho em `ipc.ts::CMD`). Os arquivos do agente ficam
  FORA dos project roots: precisa do mesmo carve-out `// SECURITY:` do
  `config_paths.rs`, com validação de que o path resolve dentro de
  `~/.metacodex/agents/`.
- Chat: `ensureSession`/message POST já aceitam `agent` (chat.store.ts:313,
  956); o AgentPicker só alimenta isso com o nome compilado
  (`metacodex/<slug>` para não colidir com agents do usuário no opencode).
- **Spike feito (2026-06-11, sidecar v1.16.0):** `config.agent` aceita
  `{prompt, model: "provider/model", variant, mode, tools, permission,
  description, color}` (schema `AgentConfig`). `PATCH /config` NÃO persiste
  nem aplica (descartado). O caminho é: agentes compilados no
  `OPENCODE_CONFIG` gerado + `POST /instance/dispose?directory=` (ou
  `/global/dispose`) após cada mutação; o opencode cacheia config por
  diretório e re-lê o arquivo na próxima instância. **Aplica a quente, sem
  restart do sidecar.** Nome compilado sem barra: prefixo `mcx-<slug>`.

Aceite: criar agente com avatar pelo builder; aparece na sidebar; conversar
com ele aplica persona/modelo/preset; editar persona no perfil reflete no
chat seguinte (com ou sem restart, explícito na UI); agente sobrevive a
restart do app; `git log` do home mostra checkpoints; chat sem agente segue
idêntico ao atual.

### Fase 2: a entidade lembra (IMPLEMENTADA 2026-06-11)

Como ficou: o bloco de contexto de memória é montado pelo Rust
(`agent/life.rs::memory_context`: home, regras, índice global + índice do
projeto) e viaja como `system` em toda mensagem de sessão com entity (chat:
`chat.store::entitySystem`; autônomo: executor). O agente grava memória com as
próprias tools no home (preset "ask" pede `external_directory`, visível). Aba
Memória no perfil: índice + arquivos por camada, editar/excluir, checkpoint
git em cada edição. Comandos `agent_entity_memory_context|tree|read|write|delete`.

Escopo: memória duas camadas, injeção do índice no início da sessão (padrão
`contextParts.ts`: parts de contexto na primeira mensagem), instrução de
escrita no prompt compilado (o agente grava via tools `write`/`edit` no
próprio home; o ruleset da sessão precisa permitir o home como
`external_directory`), aba Memória no perfil (navegar/editar/deletar).

Aceite: dizer um fato ao agente num chat; novo chat (outra sessão) usa o
fato sem releitura do transcript; fato de projeto A não aparece em projeto B;
memória editável à mão sobrevive e o índice se mantém consistente.

### Fase 3: a entidade trabalha sozinha (IMPLEMENTADA 2026-06-11, com cortes)

Como ficou: `CronTask.agent_id` opcional (decisão C; task sem agente é byte a
byte o comportamento antigo). Executor `scheduler.rs::run_entity_execution` +
`runtime.rs::run_entity_turn`: sessão com `agent` compilado + ruleset do
preset DO agente (espelho Rust dos 3 presets), system = memória + protocolo
autônomo, loop de Continuação (`CONTINUE:` imediata / `CONTINUE_IN N:` com
delay, cap do agente), Report escrito pelo HARNESS a partir do texto final
(frontmatter title/trigger/status/project), Log em `logs/runs.jsonl`,
checkpoint git por execução. Decisão B parcial: watcher de `GET /permission`
notifica via OS quando há aprovação pendente; o abort acontece pelo budget de
30 min (status "needs-you" no report); aprovar = abrir a conversa da run na
sidebar (o recovery de pendências do selectSession já cobre). Aba Atividade
no perfil (reports expandíveis + run log). CORTES HONESTOS: badge de não lido
na sidebar não entrou (precisa de polling de atividade); o espelho dos crons
em `agent.json` (portabilidade) não entrou (fonte única: CronStore);
continuação com delay morre se o app fechar (fica no log).

Escopo: campo `agent` opcional na Scheduled Task (CronStore + dialog), o
executor de execução autônoma (monta sessão com agente + memória + preset,
coleta report ao fim), Log (`runs.jsonl`), Reports + aba Atividade + badge +
deep-link da notificação, pausa de permissão (decisão B, timeout 30 min),
Continuação (imediata e com delay) com cap.

Pontos técnicos:
- `runtime.rs::run_prompt` hoje não envia `agent` nem observa permissões.
  Evolui para `run_execution(agent, trigger, directory)`: cria sessão com o
  preset do agente, acompanha via SSE ou polling de `GET /permission`
  **[verificar qual]**, e emite evento Tauri para o frontend renderizar o
  needs-attention.
- Protocolo de Continuação: marcador estruturado no texto final do assistant
  (ex.: bloco `continue: {reason, resumeIn?}`) que o harness parseia; a
  sessão seguinte recebe o resumo de estado como primeira part. Progresso de
  tarefas grandes vai em arquivo no home (a continuação N enxerga se a N-1
  andou; anti-loop além do cap).
- Report: o executor pede o report como última instrução da execução (ou
  one-shot de destilação se a sessão morreu); frontmatter `status` decide
  badge/notificação.

Aceite: task com agente roda no horário usando persona+memória dele; report
aparece na Atividade e o badge na sidebar; permissão pedida em execução
autônoma pausa, notifica, e aprovar da UI retoma; sem resposta em 30 min
aborta com report "morri esperando"; migração grande atravessa 3+
continuações e termina; task sem agente se comporta byte a byte como hoje.

### Fase 4: a entidade vive (IMPLEMENTADA 2026-06-11, com cortes)

Como ficou: Heartbeat no tick do scheduler (claim por `last_heartbeat_at` em
`logs/state.json`, colapso natural no catch-up, overlap guard, `HEARTBEAT_OK`
vira log "ok-quiet" sem report); roda no home com o preset do agente, default
desligado, knobs na aba Agenda. Dream dispara após N execuções ok (contador em
state.json), roda FULL-AUTO com `?directory=<home>` (o mundo da sessão é o
próprio home), prompt de consolidação + Diário em `journal/` + Propostas em
`proposals/`. Fila de Propostas na aba Propostas: aprovar aplica bloco
```persona ao AGENT.md (+ regenerate + dispose); rejeitar grava a razão como
memória indexada. Delegação: agentes compilam com `mode: "all"` (invocáveis
via task tool). CORTES HONESTOS: gatilho de dream por cron diário não entrou
(só N execuções); profundidade máx 2 e "convidado não grava memória" não são
enforcement de harness (o convidado simplesmente não recebe o bloco de
memória, que só viaja na sessão raiz); proposta de agente novo não tem
auto-aplicação (fica como texto para o usuário criar via builder).

Escopo: Heartbeat (config por agente, default off, OK suprimido, colapso no
catch-up), Dream (gatilho N-execuções-ou-cron-diário, consolidação de
memória, Diário, Propostas), fila de Propostas com diff aprovar/rejeitar
(rejeição vira memória), Delegação entre agentes (registro duplo no
`config.agent` como subagent invocável + regra de não-gravação de memória do
convidado + profundidade máx 2).

Aceite: heartbeat ligado checa a checklist e só notifica quando agiu; dream
após 5 execuções comprime memória e escreve diário; proposta de mudança de
persona aparece como diff, aprovar aplica + commita, rejeitar registra razão
na memória; agente A delega a B e o log/report ficam em A sem B gravar
memória; nenhum ciclo A→B→A passa da profundidade 2.

---

## Riscos conhecidos

1. **`config.agent` via `OPENCODE_CONFIG` exigir restart** a cada edição de
   agente (como MCP hoje): mataria a fluidez do builder. Spike na Fase 1;
   plano B é `PATCH /config?directory=`.
2. **Escrita de memória depende de disciplina do modelo** (gravar no lugar
   certo, manter índice): mitigar com instruções compiladas no prompt +
   verificação barata do harness pós-execução (índice órfão/arquivo órfão
   vira material de dream).
3. **Custo de token da vida autônoma** (heartbeat/dream): defaults
   conservadores (heartbeat off, dream com gatilho de material novo) e
   custo/tokens visível no Log.
4. **Colisão de nomes** com agents que o usuário já tem no opencode global:
   prefixo `metacodex/` na compilação.
5. **Dois montadores de prompt** (webview para chat, Rust para autônomo):
   manter a montagem de contexto (índice de memória + instruções) num formato
   compartilhado simples (arquivos no home lidos pelos dois lados), não em
   código duplicado.

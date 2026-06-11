# Review: cron / Scheduled Tasks (commit `a02da5c` → working tree)

**Escopo:** +773 / -243, 15 arquivos. Nenhum arquivo cruza 1k linhas (maior é `runtime.rs`, 516). Sem explosão de tamanho, sem spaghetti generalizado. O módulo novo `cron.rs` é genuinamente limpo e testado. No geral é código cuidadoso e bem comentado. Mas há um defeito claro, uma duplicação que pede helper, e uma pergunta de modelagem que vale levantar antes de seguir.

Veredito resumido: **não aprovo como está**, por causa do item 1 (defeito) e do item 2 (dedup óbvia). Os dois são rápidos. O resto é "decidir e seguir".

---

## 1. Defeito: docstring do `CronTask` colou no `CronRun` (scheduler.rs:15-22)

Bloqueante por legibilidade, e é regressão introduzida por esta diff.

```rust
/// A recurring task: run `prompt` on `model` whenever the standard cron   // <- isto descreve CronTask
/// ...
/// Persisted to `~/.metacodex/state/agent-cron.json`.
/// One execution of a task. The `session_id` is ...                       // <- isto descreve CronRun
#[derive(Serialize, Deserialize, Clone)]
pub struct CronRun {                                                       // recebeu os DOIS comentários
```

O parágrafo grande ("A recurring task...") descreve `CronTask`, mas ficou grudado acima de `CronRun`. Resultado: `CronRun` tem um doc de dois parágrafos onde o primeiro está errado, e `CronTask` (linha 34) ficou **sem doc nenhum**. Mover o bloco de volta para cima de `CronTask` e deixar só "One execution of a task..." no `CronRun`.

## 2. Dedup óbvia: o cálculo de `next_run_at` aparece 4 vezes (scheduler.rs)

A mesma incantação `parse(cron) -> next_after(now) -> timestamp_millis()` está copiada em `create`, `update`, `set_enabled` e `refresh_next_runs`. Duas variantes (uma reaproveita o `schedule` já parseado, outra parte da string), mas é a mesma ideia repetida:

```rust
// set_enabled e refresh_next_runs:
cron::parse(&t.cron).ok().and_then(|s| s.next_after(&now)).map(|d| d.timestamp_millis())
```

Extrair um único helper, por exemplo `fn next_run_ms(cron: &str, now: &DateTime<Local>) -> Option<i64>`, e usá-lo nos 4 pontos. `create`/`update` já validam o cron e podem chamar o mesmo helper (ou uma variante que recebe o `CronSchedule` pronto). Remove repetição e centraliza a regra "o que é o próximo disparo".

## 3. Ambição: `next_run_at` é estado derivado só-de-display, persistido e recomputado em todo lugar

Esse é o ponto de modelagem que vale pensar antes de cristalizar. O próprio comentário (scheduler.rs:47-48) diz que `next_run_at` "never the source of truth for firing (that is a live match against the clock)". Ou seja: é puramente cosmético. E mesmo assim ele é:

- um campo persistido no JSON,
- recomputado em `create`, `update`, `set_enabled` e `refresh_next_runs` (item 2),
- e força um `persist()` incondicional em todo boot (`load` chama `refresh_next_runs()` + `persist()`).

Estado derivado guardado em disco e recomputado em N lugares é exatamente o que tende a divergir. O frame mais enxuto: **não armazenar `next_run_at`; derivá-lo onde é exibido.** A UI já parseia o cron (cronstrue) para a descrição; calcular "próximo disparo" no cliente eliminaria o campo do modelo persistido, os 4 sites de recompute e o rewrite no boot.

O custo honesto dessa troca: o `cronstrue` só descreve, não calcula próxima ocorrência, então a UI precisaria de uma lib de next-occurrence ou de um cálculo próprio (o Rust já tem `next_after`, o front não). Por isso não é um "delete grátis". Se você quiser manter em Rust pela conveniência do `next_after`, ok, mas então no mínimo faça o item 2. A versão que eu recomendo: manter em Rust por ora (menos mexida), aplicar o helper do item 2, e registrar que `next_run_at` é derivado para não tratá-lo como verdade em lugar nenhum.

## 4. O "one-shot prompt no opencode" agora existe em 3 formas

`cron.fromText.ts::extractScheduledTask` reimplementa à mão a dança que o `chat.store` já faz: cria sessão (`POST /session`), manda mensagem (`POST /session/{id}/message`), e relê (`GET .../message`) com `mapStoredMessage`. Some isso ao `runtime.rs::run_prompt` (Rust) e ao caminho de streaming do chat: são três implementações do mesmo "manda um prompt, pega a resposta".

Além disso, a construção do `?directory=` está triplicada: `qs()` no `chat.store`, `qs()` idêntico no `cron.fromText`, e `encode_uri_component` no `runtime.rs`. Os dois `qs` em TS são literalmente o mesmo código.

Sugestão proporcional (sem over-engineering): no lado TS, extrair um `oneShotPrompt(base, { text, system, model, directory })` reutilizado por `cron.fromText` e por quem mais precisar, e reaproveitar o `qs` do `chat.store` em vez de redeclarar. Não dá pra fundir TS e Rust (process boundary), então o `run_prompt`/`encode_uri_component` em Rust seguem; só não deixe a terceira cópia surgir em TS.

## 5. `full_auto_ruleset` (Rust) é um espelho manual de `rulesetForPreset("full-auto")` (TS), sem teste prendendo os dois

Conferi: hoje batem exatamente (edit `**`, bash `*` = `ANY_CMD`, webfetch/websearch/external_directory `**`, task `**`). O comentário em runtime.rs até se declara "the Rust mirror of the frontend's full-auto preset". O problema é que nada garante isso: se alguém mexer no preset TS, o headless silenciosamente diverge. Como a run agendada é não-supervisionada, divergência aqui = task que trava esperando aprovação que ninguém vai dar.

Não dá pra deduplicar trivialmente (lados opostos do IPC, e o headless não pode consultar o front). Então: guardar a costura, não deletá-la. Um teste de snapshot mínimo em Rust fixando o JSON, ou um comentário cruzado nos dois arquivos apontando um pro outro, já reduz o risco de drift silencioso.

## 6. Duas gramáticas de cron (cronstrue no front, parser próprio no Rust) podem discordar

O Save é destravado por `describeCron` (cronstrue). A autoridade real de matching/validação é o `cron.rs`. Eles não têm a mesma gramática: por exemplo, faixas que "dão a volta" (`22-2`) o Rust rejeita (`lo > hi`, correto para Vixie), mas se o cronstrue aceitar, o usuário vê Save habilitado, clica, e leva erro de save. Isso está tratado com graça (o erro sobe via `submitError`), e o comentário em `cron.describe.ts` já reconhece que "the Rust evaluator ... is the real authority". Não é bloqueante e não é facilmente removível. Fica como costura conhecida: o gate do front é otimista, a verdade é o Rust.

## 7. `cron.fromText.ts` assume que o `POST /message` completa o turno antes do `GET` da resposta

Fluxo (linhas 82-95): faz `POST .../message`, ignora o corpo (`await res.json().catch(...)`), depois `GET .../message` e pega a última mensagem `assistant`. Isso só funciona se o POST do opencode bloquear até o turno terminar. O caminho de chat normal usa EventSource justamente porque a resposta é assíncrona/stream. Se o POST retornar antes do assistant terminar, o GET lê vazio ou parcial e o "Create from chat" fica intermitente.

Blast radius é baixo (é prefill best-effort, nunca auto-salva, e o comentário diz que miss é inofensivo), então não é bloqueante. Mas confirme a semântica do POST do opencode; se ele não for síncrono-até-o-fim, esse caminho precisa ler via stream como o chat faz. De passagem: as sessões "throwaway" criadas aqui nunca são deletadas, acumulam no store do opencode (leak pequeno; um `DELETE` no fim resolveria).

## Itens menores (decida rápido, não travam merge)

- **Em-dash nos comentários novos.** `cron.rs`, `scheduler.rs`, `runtime.rs` e docs TS estão cheios de `—` (ex.: cron.rs:4, scheduler.rs:17,55). Viola a regra absoluta de não usar travessão em nenhum texto do projeto, comentário de código incluso. Cosmético, mas é regra objetiva e está pervasivo no código novo.
- **Keys de React por índice em lista que cresce pela frente** (SidebarTasks.tsx:99). `runs` usa `insert(0, ...)`, então a key baseada no índice `i` é instável a cada poll (o item 0 muda de identidade quando chega run nova). Use `run.ranAt` (ou `sessionId`) como key.
- **Tipo TS `CronTask` espelha campos internos do scheduler** (`lastFiredMinute`, `runCount`) que a UI não usa. `lastFiredMinute` é bookkeeping puro do loop vazando pro contrato do cliente. Dá pra omitir do tipo TS.
- **`create`/`update` retornam `boolean` e o diálogo relê `useAgentCronStore.getState().error`** (ScheduledTaskDialog.tsx:114). Contrato mais limpo seria retornar `{ ok, error }` e não cutucar o store depois do fato.
- **Empty state custom** (ScheduledTasksPanel.tsx) ignora o `EmptyState` compartilhado. Defensável (precisa de dois links inline "Add manually / Create from chat"), mas o CLAUDE.md aponta `EmptyState` como o lar de estados vazios; vale um comentário dizendo por que desviou, ou estender o componente.
- **Adoção do sidecar (runtime.rs):** o `kill_pid` para o processo adotado manda só SIGTERM, sem escalar pra SIGKILL nem esperar (não dá pra `waitpid` num processo que não é nosso filho). Aceitável pro macOS-first. A janela de reuso de PID está bem mitigada pelo health-check na `base_url` (o PID vivo é só um pré-filtro barato). Sem ação, só registrando que olhei.
- **Run agendada que falha não notifica** (só bolinha vermelha no card + `eprintln`). Decisão de produto: uma task não-supervisionada que quebra talvez mereça notificação como o sucesso tem.

## O que está bem (pra calibrar)

- `cron.rs` é o destaque: self-contained, bem documentado (o "porquê não usar crate" antecipa a pergunta certa), semântica Vixie correta para DOM/DOW, e com testes cobrindo os caminhos principais. O bound de ~4 anos no `next_after` evita loop infinito em expressão que nunca casa. Aprovaria o módulo sozinho. (Sugestão leve: adicionar teste para lista com vírgula `1,15,30` e para a regra OR de DOM+DOW ambos restritos.)
- A troca de pipe por arquivo de log no spawn do opencode (runtime.rs) é correção real e bem explicada (broken pipe a 100% CPU). `read_url_from_log` só lê linhas completas (evita porta truncada), bom cuidado.
- `take_due` com claim por minuto + tick de 20s é um jeito limpo de não perder `* * * * *` sem disparar duas vezes. O lock está corretamente escopado antes de cada `persist()` (sem deadlock no parking_lot não-reentrante). Tornar os `fire` concorrentes em vez de sequenciais foi a escolha certa.
- Mover `ensure_dirs()` para antes de `CronStore::load()` em lib.rs (porque load agora persiste) foi um catch correto de ordenação.
- i18n completo nos dois locales, e a remoção das keys/campos antigos (`intervalMinutes`, `runsEvery`, etc.) não deixou nenhuma referência órfã (verifiquei).

---

**Para destravar:** itens 1 e 2 (rápidos). **Para decidir antes de seguir:** item 3 (modelar `next_run_at` como derivado) e item 4 (não deixar nascer a 3ª cópia do one-shot em TS). O resto é ajuste fino.

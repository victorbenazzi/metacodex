# Checklist de teste manual: Agent View P1 + correções da sidebar

Gerado em 2026-06-10. Cobre as 10 features P1 do `AGENT_HARNESS_FEATURES.md` (revert,
arquivos tocados, medidor de contexto, fila, editar/apagar, commands, shell, fork,
busca via harness, permissões salvas) e as correções da sidebar (ícone/confirm de
arquivar, grupo Arquivadas, posicionamento do menu "...", confirms destrutivos).

**Preparação:** `pnpm tauri dev`, abrir a view Agent, selecionar o projeto metacodex
(ou um projeto descartável de teste). Para os itens de arquivo, prefira um projeto de
teste onde o agente pode editar à vontade.

## 1. Revert / Restaurar (P1.1)
- [ ] Mande um prompt que edite um arquivo (ex.: "crie teste.md com o texto X"). Após terminar, passe o mouse na **sua** mensagem: devem aparecer os ícones de editar, restaurar, duplicar (e apagar, se for a última).
- [ ] Clique em **Restaurar até aqui**: o ConfirmDialog deve listar o(s) arquivo(s) que serão restaurados.
- [ ] Confirme: o arquivo deve sumir/voltar no disco, as mensagens descartadas somem do thread e o **banner fixo** aparece embaixo ("Conversa restaurada: N mensagens descartadas" + Desfazer).
- [ ] Clique em **Desfazer**: mensagens e arquivo voltam; banner some.
- [ ] Refaça o revert, troque de conversa e volte: o banner deve reaparecer (estado vem do servidor).
- [ ] Durante um turno em andamento (streaming), o hover da mensagem NÃO deve mostrar as ações, e o Desfazer do banner fica desabilitado.

## 2. Arquivos tocados + diff (P1.7)
- [ ] Num turno que edite 2-3 arquivos, o chip "**N arquivos alterados**" deve aparecer no fim do thread e crescer ao vivo durante o turno.
- [ ] Clique no chip: dialog com o diff unificado por arquivo, com syntax highlight e contadores +N/-N. Troque o tema (claro/escuro) com o dialog aberto: as cores devem acompanhar.
- [ ] Reabra essa conversa pelo histórico: o chip deve continuar lá (derivado do transcript).

## 3. Medidor de contexto + compactar (P1.2)
- [ ] Em conversa curta, nenhum medidor aparece (só acima de ~50% da janela).
- [ ] Em sessão longa (ou modelo com janela pequena), a barra fina aparece acima do composer; acima de 80% fica âmbar. Tooltip mostra o percentual com "(estimated/estimado)".
- [ ] Clique **Compactar conversa**: spinner "Compactando", divisor "Contexto compactado" entra no thread, thread recarrega sem flash de skeleton e o percentual cai.
- [ ] Botão desabilitado durante streaming.

## 4. Fila de prompts (P1.3)
- [ ] Com um turno rodando, digite outro prompt e Enter: vira chip "Na fila (1)" dentro do composer (hint de 11px explica). Mande um segundo: "Na fila (2)".
- [ ] Ao terminar o turno, os itens rodam **um por vez, em ordem**, sem duplicar.
- [ ] Enfileire e clique **Stop**: a fila esvazia e o texto volta concatenado pro composer.
- [ ] Enfileire algo e deixe o turno parar num **PermissionCard**: a fila NÃO dispara até você responder o card.
- [ ] Com fila pendente, troque de conversa/projeto: a fila é descartada (não vaza pra outra sessão).
- [ ] Clicar no texto de um chip da fila remove e devolve pro composer (editar).

## 5. Editar / apagar mensagem (P1.9)
- [ ] Numa conversa com 2+ trocas, hover numa mensagem sua do meio: **Editar e reenviar** restaura a conversa até ali E preenche o composer com o texto antigo, focado.
- [ ] Na **última** mensagem sua: **Apagar** (lixeira) com confirm destructive remove o par pergunta+resposta; reabrir a conversa confirma que sumiu do histórico.
- [ ] A lixeira só aparece na última troca e nunca com revert ativo.

## 6. Custom commands no "/" (P1.4)
- [ ] Digite "/": o popup deve mostrar commands (ex.: `init`, `review`) com badge "comando" e as skills com badge "skill". Skill homônima de command não duplica.
- [ ] Rode `/init` (ou crie `~/.config/opencode/command/eco.md` e rode `/eco oi`): o turno flui normal pelo stream.
- [ ] `/nomeinexistente blah` vai como texto comum (não trava).
- [ ] Com um anexo no composer, `/comando` vai como mensagem normal (regra documentada).

## 7. Shell inline "!" (P1.5)
- [ ] Digite `!git status`: borda do composer fica âmbar + hint embaixo. Enter: bubble seu em mono com `$`, e a saída chega como tool row de bash.
- [ ] Reabra a sessão: o comando e a saída persistem no histórico.
- [ ] `!!texto` envia literal "!!texto" como mensagem normal; `foo !bar` não ativa o modo shell.
- [ ] Com preset "Ask": verificar se o shell pede permissão ou executa direto (comportamento do harness; só observar e anotar).
- [ ] Com turno rodando, o hint muda para "espere o turno terminar" e Enter não faz nada.

## 8. Fork / duplicar (P1.6)
- [ ] Menu "..." da conversa → **Duplicar conversa**: abre a cópia (título com sufixo "fork"), original intacta.
- [ ] Hover numa mensagem sua no meio da conversa → ícone de fork (**Duplicar a partir daqui**): a cópia deve conter só o histórico até aquele ponto.
- [ ] O ícone de fork não aparece em mensagem recém-enviada antes do eco do servidor, nem durante streaming.

## 9. Busca via harness no "@" (P1.8)
- [ ] Digite "@chat.store": a lista deve respeitar o gitignore (nada de `node_modules`/`dist`) e responder rápido (debounce de 120ms).
- [ ] Categoria **Símbolos**: busque um símbolo (ex.: `ocFetch`). Com LSP frio mostra o estado vazio calmo; quando achar, selecionar cria um chip `{}` e a mensagem enviada leva o contexto `arquivo:linha`.
- [ ] Mate o sidecar (`pkill -f "opencode serve"`) com o popup aberto e digite: o fallback local (lista do Rust) deve continuar funcionando.

## 10. Permissões salvas (P1.10)
- [ ] Num PermissionCard, responda **Sempre permitir**: linha discreta "Salvo como regra de sempre permitir. Revisar em Personalizar" aparece e some em ~8s.
- [ ] Customize → aba **Permissões**: a regra está listada (ação + pattern).
- [ ] **Revogar** (confirm destructive): no próximo uso da mesma ação o agente pergunta de novo.
- [ ] Lista vazia mostra o EmptyState; com o sidecar parado, erro amigável (aba não quebra).

## 11. Correções da sidebar
- [ ] O botão de arquivar na linha da conversa agora tem **ícone de caixinha** (Archive), não X.
- [ ] Clicar nele abre **confirm** ("vai para o grupo Arquivadas deste projeto. Nada é apagado.").
- [ ] Após arquivar, aparece o grupo **"Arquivadas (N)"** recolhido no fim da lista do projeto; expandir mostra a conversa.
- [ ] Na linha arquivada: clicar abre a conversa; hover mostra **Desarquivar**, que devolve à lista principal (e o grupo some quando esvazia).
- [ ] Sessões internas do app (vision relay / "criar tarefa do chat") NÃO devem aparecer nas Arquivadas daqui pra frente (one-shots antigos podem aparecer uma vez; é só apagar).
- [ ] Menu **"..."**: abra e tire o mouse da linha; o menu deve ficar **ancorado na linha** (não mais no canto superior da janela) e as ações de hover permanecem visíveis enquanto ele está aberto.
- [ ] **Apagar** pelo menu continua confirmando (destructive), e apagar a conversa aberta reseta o chat.

## 12. Confirms destrutivos (auditoria)
- [ ] Customize → MCP: remover um servidor próprio pede confirm (citando que a API key guardada é apagada). Idem na lixeira dos cards Brave/Exa.
- [ ] Scheduled Tasks: apagar tarefa segue confirmando (já existia, só regressão).
- [ ] Ações não destrutivas continuam sem fricção: pin, toggle de MCP, duplicar, Stop.

## 13. Regressões gerais
- [ ] Chat normal (texto + anexo de imagem + "@arquivo") segue funcionando de ponta a ponta.
- [ ] Swarm mode: subagentes aparecem; o chip de arquivos conta edições dos filhos.
- [ ] Trocar de projeto no composer limpa thread/fila/medidor/banner sem sobras.
- [ ] Reiniciar o agente (Customize → MCP → Restart) reconecta e o histórico recarrega.

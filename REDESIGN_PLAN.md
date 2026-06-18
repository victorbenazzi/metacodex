# Redesign metacodex: plano e handoff

Documento vivo para o redesign visual premium do metacodex. Escrito para retomar o trabalho em outra sessão sem perder contexto. Atualize conforme avançar.

> Regra de escrita deste repo: nunca usar travessão (`—`/`–`). Vírgula, dois-pontos, parênteses ou reescrita. Hífen só em palavras compostas e intervalos.

---

## 1. Norte (a visão)

Um shell que respira, com **uma linguagem visual única entre Agent e Code**, micro-interações físicas e contidas, e uma sidebar de projetos que colapsa para um rail fino e expande para o histórico. Qualidade "premium do Codex" (referência do usuário): refino, espaço, sombra suave, cantos arredondados, acento contido e movimento, mais do que cor.

## 2. Decisões travadas (não reabrir sem motivo)

| Tema | Decisão |
|---|---|
| Alma da paleta | **Fria estilo Codex** (neutros frios + acento lavanda). A identidade quente cream foi aposentada como default. |
| Temas default | **Porcelain** (claro) + **Graphite** (escuro). Os quentes (Solar Cream / Mono Slate) seguem disponíveis no picker. |
| Sidebar do Code | **Igual à Agent view** (`ProjectSection`): colapsada = rail de ícones; expandida = lista de projetos, cada um abrindo **seções aninhadas**. O **explorer (arquivos) continua painel separado** ao lado. |
| Seções (por modo) | **Horizontal** (default): só **Histórico** (as abertas vivem na barra de guias, sem duplicar). **Vertical**: **Histórico + Terminais (shells) + Agentes (CLIs de agente, com chip de porta)**. Sem "Processos". Entidades/personas não entram aqui. |
| Layout horizontal/vertical | Setting `interface.layoutMode`. Horizontal = barra de guias no topo é a casa das abertas. Vertical = sem barra; a sidebar dirige o painel central único (estilo Codex; central = terminal do agente, não chat). |
| Controles do topbar | Toggle recolher + adicionar-projeto ao lado da pílula Agent\|Code (só Code view), com respiro (divisória). Settings no rodapé da sidebar. |
| Acento | Lavanda contido (`--accent`), só em ativo/seleção/foco + glow de atmosfera. **Ink continua a cor de CTA sólido** (botão escuro estilo Codex), o acento nunca é fill barulhento. |
| Ícones | Menores (pedido explícito). Rail e tiles já reduzidos na Fase 1. |

## 3. Constraints do projeto (não quebrar)

- **Sem travessão** em nenhum texto (code, copy, commits, docs), em qualquer idioma.
- **i18n em tudo**: react-i18next, chaves em **ambos** os locales (`src/features/i18n/locales/en` e `pt-BR`). Nunca hardcodar string de UI.
- **Token-driven**: nunca cor/raio/duração hardcoded. Cor via tokens (`var(--*)` ou classes Tailwind mapeadas), raio só classes `rounded-xs|sm|md|lg|xl|pill`, duração via `duration-fast|base|slow`. Se criar tier de `fontSize`, registrar em `src/lib/cn.ts` (tailwind-merge classGroups).
- **Popups = só opacidade** (`animate-fade-in/out`). Nunca animar transform em overlay/modal/menu (quebra a centralização). Transform só em conteúdo in-flow (tiles, linhas, listas via `rise`).
- **xterm** (`useXterm.ts`): não mexer na ordem de init (Canvas addon deferido em rAF, `cols/rows` explícitos, `lineHeight` em 1.0). Testar Cmd+T, resize e troca de tema depois de qualquer mudança de chrome.
- **Path safety / atomic writes / sem push sem pedido**: valem como sempre.

## 4. Sistema de temas (como funciona, importante)

- `applyTheme()` (`features/theme/applyTheme.ts`) escreve **todo o chrome** (canvas, ink, hairline, surfaces, semantic, diff, selection, scrollbar) + syntax + terminal como CSS vars inline no `documentElement`, lendo de `features/theme/themes/*.ts`. Ou seja: **mudar só o `tokens.css` não basta** para o chrome; tem que mexer no tema aplicado.
- O `tokens.css` (`:root` e `[data-theme="dark"]`) é o **default de first-paint** e o source-of-truth documentado. Mantenha em sincronia com Porcelain/Graphite.
- **`--accent`, `--atmosphere`, surfaces aliases (`--surface-0..3`), scrim, sombras, radius, spacing, type, motion, layout** NÃO estão no schema `ThemeChrome`. Vivem só no `tokens.css`, keyed por `[data-theme]`. Por isso o acento é consistente em todos os temas de cada kind, e trocar de tema nunca deixa acento "stale".
- Registry e defaults: `features/theme/themes/index.ts` (`THEMES`, `DEFAULT_LIGHT_THEME_ID`, `DEFAULT_DARK_THEME_ID`).

---

## 5. Fase 1: fundação. STATUS: CONCLUÍDA (build verde)

Paleta fria + acento + atmosfera + micro-motion + ícones menores. Tudo type-check + `pnpm build` verde.

### Arquivos criados
- `src/features/theme/themes/porcelain.ts` (tema claro frio, id `porcelain`).
- `src/features/theme/themes/graphite.ts` (tema escuro frio, id `graphite`).

### Arquivos alterados
- `src/features/theme/themes/index.ts`: registra os dois, no topo de cada kind; `DEFAULT_LIGHT_THEME_ID = porcelain`, `DEFAULT_DARK_THEME_ID = graphite`.
- `src/features/theme/theme.store.ts`: migração one-time `migrateDefaultIdentity()` (chave `metacodex:themeRev = "cool-1"`). Quem tinha `solar-cream`/`mono-slate` salvo migra para `porcelain`/`graphite` uma vez. Escolhas deliberadas de outros temas ficam intactas.
- `src/styles/tokens.css`: chrome `:root` + `[data-theme="dark"]` sincronizados com a paleta fria. Adicionados `--accent`, `--accent-strong`, `--on-accent`, `--atmosphere`. Selection/scrim/diff/explorer-recent esfriados. `--rail-w: 56px -> 48px`.
- `src/index.css`: `::selection` frio (lavanda no dark). Utilidades novas `.atmosphere-soft` e `.atmosphere-canvas` (glow como camada de background, sempre atrás do conteúdo, zero risco de contraste).
- `tailwind.config.js`: cores `accent`, `accent-strong`, `on-accent`. Keyframe + animação `rise` (entrada escalonada de listas, in-flow).
- `src/app/AppShell.tsx`: grid do rail `56px -> 48px` (duas linhas do `gridTemplateColumns`).
- `src/components/project-rail/MiniProjectSidebar.tsx`: `atmosphere-soft` no `<aside>`; botões do rodapé `32 -> 28`, ícones menores.
- `src/components/project-rail/ProjectTile.tsx`: tile `40 -> 32`, ícone `17 -> 15`, img `22 -> 18`, monograma `14/18 -> 12/15`. Marcador ativo agora `bg-accent` (lavanda) reposicionado. Micro-motion: `hover:-translate-y-px hover:shadow-elevated active:scale-[0.96]`. Removido `tileMarkerColor`.
- `src/components/agent/AgentSidebar.tsx`: `atmosphere-soft` no `<aside>` (continuidade visual Agent/Code).

### Conserto de brinde (já aplicado)
`bg-accent/15`, `border-accent`, `ring-accent` já eram usados em `TreeNode.tsx`, `TabBar.tsx`, `FileExplorer.tsx`, mas o token `accent` **não existia** (classes mortas, seleção de arquivo sem destaque). Com o token criado, tudo reviveu no lavanda.

### Paleta de referência (valores aplicados)

| Token | Porcelain (claro) | Graphite (escuro) |
|---|---|---|
| canvas | `#f5f6f9` | `#0f1015` |
| canvas-soft | `#f9fafc` | `#14151b` |
| surface-card | `#ffffff` | `#181a21` |
| surface-strong | `#e6e8ef` | `#252830` |
| hairline | `#e5e7ee` | `#24262e` |
| hairline-strong | `#d2d5df` | `#3a3d47` |
| ink | `#1b1c21` | `#f3f4f7` |
| body | `#51545e` | `#c0c3cd` |
| muted | `#767a86` | `#888c99` |
| accent | `#5a5ad8` | `#8a8af3` |
| success / danger / warn | `#18906b` / `#d83b4a` / `#b3760f` | `#3ed092` / `#ff626a` / `#e2a65c` |

### Validar (quando rodar)
`METACODEX_HOME="$HOME/.metacodex-dev" pnpm tauri dev`. Olhar: alma fria, glow lavanda no canto do rail, seleção de arquivo lavanda no explorer, hover/press dos tiles menores, claro vs escuro (`Cmd+,`).

### Follow-ups pendentes da Fase 1 (pequenos)
- [ ] Ajuste fino de intensidade do acento/glow conforme feedback do usuário (mais forte / mais discreto).
- [ ] `tileMarkerColor` em `features/projects/color.ts` pode ter ficado sem uso. Conferir e remover se órfão.
- [ ] Decidir se o foco global (`:focus-visible` = ink no `index.css`) migra para acento (avaliar contraste). Deixado em ink por segurança.
- [ ] Opcional: `atmosphere-canvas` no canto superior da work area.

---

## 6. Fase 2: sidebar unificada do Code. STATUS: CONCLUÍDA (build verde)

**Objetivo:** transformar `[rail 48px] + [explorer 248px]` em `[rail fino] + [painel com abas Arquivos | Histórico, colapsável]`. Histórico vindo do resume registry, na mesma linguagem visual das threads do Agent.

### Entregue (modelo corrigido: sidebar estilo Agent)

Layout: coluna 1 = sidebar de projetos (rail 48px quando colapsado, painel 264px quando expandido) + coluna 2 = explorer (sempre, com seu ResizeHandle) + work + source control.

Arquivos criados:
- `src/features/ui/codeSidebar.store.ts`: `{ collapsed, expandedProjects }` + `toggleCollapsed`/`toggleProject`/`setProjectExpanded`, persistido em localStorage (`metacodex:codeSidebar`).
- `src/components/code-sidebar/ExpandedProjectsSidebar.tsx`: shell da sidebar expandida (header com título + adicionar projeto + recolher; lista de projetos; rodapé Ajustes). Hidrata resume + carrega entities no mount.
- `src/components/code-sidebar/CodeProjectGroup.tsx`: a peça central. Linha do projeto (dot + nome + chevron) que abre as 4 seções aninhadas, cada uma puxando do seu store e escondida se vazia:
  - **Histórico**: `resume.store.entries` filtrado por projeto + `resumeFlagFor`, clique = `buildResumeTab` + `openTab`.
  - **Terminais**: `tabsStore.byProject[id]` kind terminal/cli, clique = `setActive` + `setActiveTab`, dot de status via `agent-status.store`.
  - **Processos**: `terminal.store.sessions` rodando + portas de `tabMetadata.store`, chips `:porta`, clique foca a aba dona.
  - **Agentes**: `entities.store` filtrado por `projects`, clique = `view.store.setView('agent')` + `nav.store.openAgents(id)`.
  - Linhas entram com `animate-rise` escalonado (`motion-reduce:animate-none`).

Arquivos alterados:
- `src/app/AppShell.tsx`: coluna 1 condicional (`codeSidebarCollapsed ? MiniProjectSidebar : ExpandedProjectsSidebar`), largura `48 ↔ 264`; explorer restaurado como coluna 2 (sempre, com ResizeHandle).
- `src/components/project-rail/MiniProjectSidebar.tsx`: toggle expandir no topo do rail (`PanelLeftOpen`/`PanelLeftClose`).
- `src/components/file-explorer/ExplorerPanel.tsx`: `ExplorerPanelProps` exportado (sobrou do corte anterior; inócuo).
- `src/features/i18n/locales/{en,pt-BR}.json`: `codeSidebar.*` (projects, seções, nothingOpen).

Removidos: `CodeSidebarPanel.tsx` e `HistoryPanel.tsx` (eram o modelo errado de abas).

Build + type-check verdes.

### Deferido (follow-ups da Fase 2)
- [ ] **Animação de largura** no expandir/colapsar (`48 ↔ 264`): hoje é snap. Backlog de polish (cuidado para não animar no resize do explorer).
- [ ] Seções têm rótulo fixo (sem colapso por seção) e items capados (Histórico 6, Agentes 8). Avaliar "ver mais" e colapso por seção se ficar longo.
- [ ] Per-project "+" (novo terminal direto da linha do projeto) não foi adicionado; espaço reservado.
- [ ] Processos depende do polling de `tabMetadata` (só projeto ativo). Portas de projeto inativo podem ficar vazias até focar.
- [ ] Atalho de teclado para colapsar/expandir; transição visual Agent|Code ainda pode convergir mais (mesmo `SidebarRow`).

### Refinamentos (layout mode, seções, topbar). STATUS: CONCLUÍDO (build verde)

A partir do feedback com a `ui-ux-pro-max` (regra `avoid-mixed-patterns`: não duplicar o mesmo conteúdo como guia horizontal E lista vertical):

- **Layout horizontal/vertical** (`settings.interface.layoutMode`, default horizontal): novo tipo `LayoutMode` em `settings.types.ts` (+ DEFAULT + merge), controle `Segmented` em `SettingsDialog` (aba Code), i18n `settings.interface.layout*`. `WorkArea.tsx` esconde a `TabBar` quando vertical (mostra só a aba ativa, trocável pela sidebar).
- **Seções da sidebar** (`CodeProjectGroup.tsx`): removido "Processos". Terminais = abas kind `terminal`; Agentes = abas kind `cli` (com chips de porta de `tabMetadata.store`); status dot via `agent-status.store`. Gate por modo: horizontal mostra só Histórico; vertical mostra Histórico + Terminais + Agentes. Entidades saíram daqui (Agentes agora = CLIs de agente abertos).
- **Topbar** (`TitleBar.tsx`): toggle recolher/expandir (`codeSidebar.toggleCollapsed`) + dropdown adicionar-projeto, ao lado da pílula, separados por hairline, só no Code view. Recebe `onOpenFolder`/`onCloneFromGithub` via props do AppShell. Removidos: o toggle do topo do rail e o add do rodapé do rail (`MiniProjectSidebar` virou sem props), e o add+collapse do header da `ExpandedProjectsSidebar` (header virou só o título "PROJETOS", alinhado em 30px ao header do explorer). Settings continua no rodapé dos dois.

Follow-ups: animação de largura do colapso (ainda snap); no modo vertical, considerar uma seção "Abertos" para editores se a navegação por explorer não bastar (hoje arquivos abrem/focam pelo explorer); chip de porta depende do polling de `tabMetadata` (projeto ativo).

### Ajustes rodada 2 (topbar, seções, ícones). STATUS: CONCLUÍDO (build verde)

- **Ações da barra de abas subiram pro topbar** (`TabTrailingActions` = novo-tab "+" + toggle de Source Control): removidas de `WorkArea`/`TabBar` (`trailing`), renderizadas no slot DIREITO do `TitleBar` no Code view. Libera a barra de abas e some no modo vertical.
- **Modo vertical sem barrinha** (`WorkArea`): o else do `showTabBar` virou `null` (sem `NewTabContextMenu`/thin toolbar).
- **Topbar reordenada** (`TitleBar`): controles primeiro (toggle de sidebar + add-projeto), divisória, depois a pílula Agent|Code. Os controles aparecem nos **dois modos**. O toggle é **sensível ao modo**: Code → `codeSidebar.collapsed`; Agent → `agentCollapsed` (novo no store; `AgentView` esconde o `AgentSidebar`). Add-projeto é global (funciona nos dois).
- **Sidebar horizontal** (`CodeProjectGroup`): ícone do projeto (`ProjectGlyph`, novo, reusa a lógica do tile) no lugar do ponto colorido. Removido o "Nothing open yet"; o chevron só aparece quando há conteúdo (em horizontal, só Histórico).

Arquivos: novo `components/project-rail/ProjectGlyph.tsx`; `codeSidebar.store.ts` (+`agentCollapsed`/`toggleAgentCollapsed`); `TitleBar.tsx`, `WorkArea.tsx`, `AgentView.tsx`, `CodeProjectGroup.tsx`, `AppShell.tsx`. Removidos de `MiniProjectSidebar`/`ExpandedProjectsSidebar` (toggle/add já estavam no topbar).

### Ajustes rodada 3 (bug + reorder + ações por projeto). STATUS: CONCLUÍDO

- **Bug do Settings corrigido**: o `SettingsDialog` era montado só dentro do `MiniProjectSidebar` (rail), então com a sidebar expandida ele não existia e o clique não abria nada. Movido pro `AppShell` (sempre montado, dirigido por `useSettingsStore`); removido do `MiniProjectSidebar`. Conserta também o `Cmd+,` com a sidebar expandida / em Agent.
- **Ordem das seções**: Agentes agora vêm acima de Terminais (`CodeProjectGroup`).
- **Ações por projeto na linha** (`CodeProjectGroup` + `ExpandedProjectsSidebar`): hover revela **"+"** (abre `NewTabBody` escopado, cria terminal/agente NAQUELE projeto via `openTab(project.id, ...)`) e **"⋯"** (renomear / revelar no Finder / remover). Clique-direito na linha = `ProjectContextMenu` completo (cor/ícone). Diálogos de rename/remove vivem no `ExpandedProjectsSidebar`.

### Plano original (referência histórica, parcialmente desatualizado pelo modelo corrigido acima)

### Layout objetivo
- Rail fino (48px, projetos): mantido como está.
- Painel de conteúdo (largura = `settings.panels.explorerWidth`): header com abas **Arquivos | Histórico** + botão de colapsar.
- **Colapsado:** só o rail (48px). Painel some (coluna 2 do grid vira 0). Animação de largura suave + crossfade.
- **Aba Arquivos:** o `ExplorerPanel`/`FileExplorer` atual, movido para dentro do painel (sem regressão).
- **Aba Histórico:** sessões recentes do projeto ativo (`resume.store.forProject`), estilo `SidebarThreads`/`ThreadRow` do Agent (status dot, título, tempo relativo via `agoShort`, ação de retomar), entrada escalonada com `rise`.

### Componentes a criar
- `src/components/code-sidebar/CodeSidebarPanel.tsx`: container, abas + estado de colapso. Substitui o wrapper do `ExplorerPanel` no AppShell.
- `src/components/code-sidebar/HistoryPanel.tsx`: lista do resume para o projeto ativo + empty state.
- `src/components/code-sidebar/HistoryRow.tsx`: linha de sessão (retomar, status, tempo).
- **Recomendado:** extrair `src/components/ui/SidebarRow.tsx` comum (mesmo marcador ativo no acento, hover visível, altura estável) e refatorar Agent (`SidebarThreads`/`ProjectSection`) e Code para usá-lo. É o que cumpre "linguagem única". Pode ficar para um sub-passo se ficar grande.

### Estado / store
- Novo slice `src/features/ui/codeSidebar.store.ts`: `{ tab: 'files' | 'history', collapsed: boolean }`. Persistir (preferência: `settings` global; alternativa: por workspace).
- Histórico: reusar `features/resume/resume.store.ts` (`forProject`, `recent`). Já hidrata no boot.
- Ação "retomar": ver como `ResumeCards.tsx` (Welcome / ProjectEmptyState) abre a sessão hoje, e reusar o mesmo caminho (abrir tab de CLI com o comando de resume; padrões em `features/terminal/cli-registry.ts`).

### AppShell
- `gridTemplateColumns` hoje: `48px {explorerWidth}px minmax(0,1fr) [sc]`.
- Expandido: igual, com `explorerWidth` virando a largura do painel unificado.
- Colapsado: `48px minmax(0,1fr) [sc]` (coluna do painel removida). Animar a transição de largura.
- Trocar `<ExplorerPanel/>` pelo `<CodeSidebarPanel/>` (que decide aba/colapso internamente). Manter o `ResizeHandle` da largura. Cuidado com o guard `hydratedWorkspaces` para não clobberar workspace vazio.

### Critérios de aceite
- [ ] Toggle colapsa/expande com animação suave de largura + crossfade do conteúdo; persiste entre sessões.
- [ ] Aba Arquivos idêntica ao explorer atual: criar/renomear/mover/excluir, git status, tint de recém-criado, drag, tudo sem regressão.
- [ ] Aba Histórico lista sessões do projeto ativo; retomar funciona; trocar projeto troca a lista; empty state quando não há sessões.
- [ ] Linha ativa usa o acento; hover sempre visível; mesma altura/linguagem do Agent.
- [ ] Entrada de lista escalonada (`rise`, 30-50ms/item) respeitando reduced-motion.
- [ ] Não quebra xterm/tabs (testar Cmd+T, resize, troca de tema).

### Gotchas
- O Explorer carrega muito estado (expanded set, invalidação por watcher no AppShell). Envolver, não reescrever: manter `ExplorerPanel`/`FileExplorer` e só hospedá-los na aba.
- Hover de linha no Agent hoje usa `bg-surface-1` (= canvas-soft), quase invisível sobre a sidebar canvas-soft. Ao convergir, usar `hover:bg-surface-strong/40` (padrão do resto do app) para hover sempre visível.

---

## 7. Fase 3: superfícies de conteúdo (capricho Codex)

Elevar o conteúdo para o "macio" da referência. Chrome continua hairline; conteúdo sobe para `rounded-lg/xl` + sombra suave.

- **Composer** (`components/agent/composer/`): raio maior, mais padding, foco em acento de baixa alpha, botão de enviar como círculo sólido com `press-feedback`.
- **Bolhas de chat / tool chips** (`components/agent/chat/`): bolha do usuário em surface suave arredondada, chips com check, "Thought"/"Explored" discretos.
- **Diff cards** (`components/editor/DiffTab.tsx` e a review do Agent): cards arredondados, contadores +/-, aceitar/rejeitar com feedback.
- **Menus / dialogs / tooltips** (`components/ui/`): revisar raio e sombra para o novo elevation. Manter motion só-opacidade nos popups.
- **TitleBar** (`app/TitleBar.tsx`): o toggle Agent|Code já é o "momento de marca"; garantir que glow + toggle leiam premium.

Aceite: superfícies de conteúdo coesas em ambos os temas, foco/hover/press consistentes, contraste AA, sem hardcode.

## 8. Fase 4: QA + polish final

- [ ] Contraste AA nos dois temas (texto body >= 4.5:1; secundário/labels >= 3:1). Conferir acento como texto/sobre superfícies.
- [ ] `prefers-reduced-motion`: todas as animações novas colapsam (regra global já existe em `index.css`; validar `rise`, hover-lift, largura da sidebar).
- [ ] i18n: chaves novas (abas, histórico, empty states, tooltips) em **en** e **pt-BR**.
- [ ] xterm: Cmd+T, resize de janela, troca de tema, box-drawing dos TUIs (Claude Code/Codex) sem gaps.
- [ ] Migração de tema: testar com `solar-cream`/`mono-slate` salvos no localStorage (deve virar `porcelain`/`graphite` uma vez) e com tema deliberado (deve ficar).
- [ ] `pnpm build` verde. `cargo check` se tocar Rust (não previsto).

---

## 9. Mapa rápido de arquivos

| Área | Onde |
|---|---|
| Tokens / paleta / acento / atmosfera | `src/styles/tokens.css`, `src/index.css`, `tailwind.config.js` |
| Temas (chrome/syntax/terminal) | `src/features/theme/themes/*.ts` + `index.ts`; aplica via `applyTheme.ts`; store `theme.store.ts` |
| Rail de projetos | `src/components/project-rail/{MiniProjectSidebar,ProjectTile}.tsx` |
| Explorer (aba Arquivos) | `src/components/file-explorer/{ExplorerPanel,FileExplorer,TreeNode}.tsx` |
| Sidebar do Agent (referência de histórico) | `src/components/agent/{AgentSidebar,ProjectSection,SidebarThreads}.tsx` |
| Histórico (dados) | `src/features/resume/{resume.store,resume.service}.ts`; UI hoje em `components/resume/ResumeCards.tsx` |
| Grid do shell | `src/app/AppShell.tsx` (`gridTemplateColumns`) |
| Motion | `tailwind.config.js` (keyframes/animation) + `tokens.css` (durações/eases/press) |

## 10. Backlog / ideias (nice-to-have)

- Indicador ativo deslizante (shared element) na sidebar, igual ao thumb do toggle Agent|Code (`components/ui/Segmented.tsx` anima `left/width`): um único elemento absoluto animando `top` entre itens.
- Stagger de entrada em mais listas (tabs, cards, resultados de busca).
- Acento no foco global (avaliar contraste) e em estados de seleção de mais superfícies.
- Convergir 100% as linhas de Agent e Code num único `SidebarRow`.

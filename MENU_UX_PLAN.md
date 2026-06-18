# Menus: safety triangle + posicionamento ciente de borda

Estudo dos dois padrões de interação de menu (safe triangle / menu-aim e flip/shift
ciente de borda), auditoria de como o metacodex está hoje, e plano priorizado de
aplicação. Escrito em 2026-06-18.

---

## 1. O estudo

### 1.1 Safety triangle (menu-aim / hover intent)

**Problema.** Um submenu em cascata abre ao lado do item pai. O caminho natural do
mouse até ele é diagonal (para baixo e para o lado). Um `:hover` ingênuo lê o
`mouseenter` de cada item na hora, então, ao atravessar itens vizinhos no trajeto, o
submenu aberto fecha ou troca antes de você chegar nele. Ben Kamens descreveu como
"um jogo doentio e impossível de whack-a-mole". O paliativo antigo era um delay
(timer antes de trocar de submenu), que deixa o menu inteiro lento.

**Solução canônica (Amazon mega dropdown, Ben Kamens, 2013).** A cada posição do
cursor desenha-se um triângulo entre a posição atual do cursor (o ápice) e os dois
cantos do submenu para o lado em que o cursor está indo (por exemplo, os cantos
superior-direito e inferior-direito quando o submenu está à direita). Enquanto o
cursor fica dentro desse triângulo, o submenu atual permanece aberto (é tratado como
"intenção de chegar ao submenu", logo nenhum item vizinho é ativado). Se o cursor sai
do triângulo, a troca acontece na hora. Isso entrega troca instantânea E perdão na
diagonal ao mesmo tempo, sem timer. Foi empacotado como o plugin `jQuery-menu-aim`,
de onde vem o nome "menu aim". Também aparece como hover triangle, safe area, hover
tunnel, tudo sob o guarda-chuva de hover intent.

**Implementação moderna de biblioteca (Floating UI).** A função `safePolygon()`
passada ao `handleClose` do hook `useHover` (`@floating-ui/react`). Quando o cursor
deixa o gatilho, ela só fecha o flutuante se o ponteiro estiver fora de um polígono
calculado dinamicamente (ponte retangular + triângulo) que vai do cursor até o
elemento. Opções: `buffer` (folga em px ao redor do polígono), `blockPointerEvents`,
`requireIntent` (checa a velocidade/intenção do cursor; desligue se gatilhos vizinhos
forem bloqueados de forma agressiva demais).

**Radix (o que o metacodex usa).** `DropdownMenu` e `ContextMenu` JÁ trazem esse
comportamento embutido para seus submenus (uma "grace area" / polígono de intenção do
ponteiro). Não é preciso cablear `menu-aim` nem `safePolygon`: `DropdownMenu.Sub` e
`ContextMenu.Sub` já têm de fábrica, e o `:hover` deliberadamente não dispara nos
itens vizinhos durante o trajeto. Os componentes Radix que historicamente NÃO tinham
esse polígono são `NavigationMenu` e `HoverCard`, que o metacodex não usa.

**Notion e o vídeo do X.** A Notion mostrou exatamente essa melhoria publicamente num
tweet de 24/02/2023: "antes você tinha que ser bem preciso com o cursor para os menus
não sumirem; agora deve parecer bem mais polido". É a referência de que "a Notion já
falou disso anos atrás". O tweet do @nickarceco (id 2067371464957825157) não foi
acessível na pesquisa (o X bloqueia leitura sem login, retornou HTTP 402), mas, pelo
contexto, é uma demonstração recente desse mesmo padrão de submenu.

### 1.2 Posicionamento ciente de borda (flip / shift)

**Por quê.** Todo menu ou submenu tem um lado preferido (submenu abre à direita,
dropdown abre embaixo). Perto de uma borda da viewport esse lado preferido cortaria
ou vazaria para fora da tela. O posicionamento ciente de borda detecta o overflow e
ou VIRA (flip) para o lado oposto (abre à esquerda em vez de à direita, para cima em
vez de para baixo) ou DESLIZA (shift) ao longo do eixo para continuar 100% visível.
Resultado: menu perto da borda esquerda abre para a direita, perto da direita abre
para a esquerda, perto da base abre para cima. É o comportamento nativo do macOS. A
documentação da Apple (AppKit, "How Menus Work") diz literalmente: "submenus aparecem
à direita ou à esquerda dos seus menus, dependendo do espaço de tela disponível".
Logo, flip/shift não é enfeite, é a expectativa nativa da plataforma.

**Floating UI (middleware).**
- `flip()`: vira para a posição oposta quando falta espaço (mantém o lado preferido
  até não haver espaço, então flipa).
- `shift()`: desliza ao longo do eixo de alinhamento para manter na viewport (coloque
  `flip()` antes de `shift()`).
- `autoPlacement()`: escolhe automaticamente o lado com mais espaço; NÃO combina com
  `flip()` (estratégias opostas brigam). Use quando não há lado preferido.
- `size()`: redimensiona para caber (expõe `availableWidth`/`availableHeight`, ótimo
  para limitar a altura e virar scroll).

**Radix (props no `Content`, por baixo usa Floating UI).**
- `side` / `align`: lado e alinhamento preferidos (podem mudar na colisão).
- `sideOffset` / `alignOffset`: distância em px.
- `avoidCollisions` (default `true`): o "interruptor mestre" do flip + shift.
- `collisionPadding`: margem em px da borda onde a colisão é detectada (mantém o menu
  afastado da borda em vez de encostado nela).
- `sticky`, `hideWhenDetached`: comportamento ao rolar / quando o gatilho some.

### 1.3 Fontes

- Ben Kamens, "Breaking down Amazon's mega dropdown": https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown
- Floating UI `useHover` + `safePolygon`: https://floating-ui.com/docs/usehover
- Floating UI `flip`: https://floating-ui.com/docs/flip ; `shift`: https://floating-ui.com/docs/shift ; `size`: https://floating-ui.com/docs/size
- Radix DropdownMenu (submenus): https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- Radix Popover (props de Popper: side/align/collisionPadding/avoidCollisions): https://www.radix-ui.com/primitives/docs/components/popover
- Radix issue #1549 (confirma que DropdownMenu já tem o polígono; gap era HoverCard/NavigationMenu): https://github.com/radix-ui/primitives/issues/1549
- Smashing Magazine, "Better Context Menus With Safe Triangles" (cita Notion 24/02/2023): https://www.smashingmagazine.com/2023/08/better-context-menus-safe-triangles/
- Apple AppKit, "How Menus Work" (submenu flipa por espaço de tela): https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MenuList/Articles/HowMenusWork.html

---

## 2. Como o metacodex está hoje (auditoria)

Stack de menus: Radix `dropdown-menu@2.1.2`, `context-menu@2.2.2`, `dialog@1.1.2`,
`select@2.2.6`, `tooltip@1.1.4`. NÃO há `@floating-ui/*` no projeto. NÃO há
`NavigationMenu` nem `HoverCard`.

### 2.1 O que já está certo (de graça)

- **Safety triangle já ativo em todos os submenus atuais**, porque todos são Radix
  `Sub`:
  - `composer/PlusMenu.tsx`: submenus de Skills e de MCP servers.
  - `project-rail/ProjectContextMenu.tsx`: submenus de cor e de ícone.
  - `ui/ContextMenu.tsx::ContextMenuSub`: wrapper genérico de submenu.
  Não existe nenhum submenu custom (fora do Radix) no código. Logo, não há buraco de
  safe triangle a preencher hoje.
- **Collision avoidance (flip/shift) já roda por padrão** (`avoidCollisions` é `true`
  por default no Radix). Os menus não vazam de fato para fora da tela.

### 2.2 O que está errado (o que você está vendo)

**A) Intenção de alinhamento apontando para a borda (o bug dos launchers à esquerda).**

O launcher de terminais/agentes na code sidebar e o menu de opções do projeto ficam
do lado ESQUERDO da tela, mas declaram `align="end"`:

- `src/components/code-sidebar/CodeProjectGroup.tsx:189` (launcher "+", terminais e
  agentes): `<DropdownContent align="end" sideOffset={6}>`.
- `src/components/code-sidebar/CodeProjectGroup.tsx:205` (menu "⋯" do projeto):
  `<DropdownContent align="end" sideOffset={6} className="min-w-[180px]">`.

Com `side="bottom"` (default) e `align="end"`, a borda direita do menu cola na borda
direita do gatilho e o corpo do menu cresce para a ESQUERDA, de volta para cima da
própria sidebar e em direção à borda da tela. Mesmo o Radix evitando o overflow, o
menu abre na direção errada (para trás, sobre a borda) em vez de para o espaço aberto.

Correção: `align="start"` (o corpo cresce para a DIREITA, para o centro da tela). É
exatamente o "abrir alinhado à direita" pedido.

Contraprova de que a regra é "abrir para o lado oposto à borda, não um valor fixo": o
launcher "+" da barra de abas (`src/components/tabs/NewTabMenu.tsx:195`) também usa
`align="end"`, mas ali o gatilho fica no canto DIREITO da barra, então o menu cresce
para a esquerda, para o espaço aberto. Está correto e deve continuar `end`.

**B) Falta de `collisionPadding` (margem da borda).**

Nenhum dos wrappers compartilhados passa `collisionPadding`:

- `src/components/ui/DropdownMenu.tsx`: `DropdownContent` (`align="start"`,
  `sideOffset=6`) e `DropdownSubContent` (`sideOffset=6`, `alignOffset=-5`).
- `src/components/ui/ContextMenu.tsx`: `ContextMenuContent` e o `SubContent` do
  `ContextMenuSub` (sem nenhuma prop de posição).
- `src/components/ui/Tooltip.tsx`: `Content` com `side="right"`, `sideOffset=8`.
- `src/components/ui/Select.tsx`: `Content` com `position="popper"`, `sideOffset=6`.

Sem `collisionPadding`, quando o Radix desliza ou vira o menu, ele pode encostar com
0px na borda da tela, o que parece apertado e pouco macOS. Falta uma margem (8px).

**C) Popups custom sem nenhum tratamento de borda (não têm Radix por baixo).**

- `src/components/agent/composer/MentionPopup.tsx` ("/" e "@" no composer):
  `absolute inset-x-0 bottom-full z-30 mb-[8px]`. Ancorado acima do composer, largura
  cheia. Em geral seguro (sempre há espaço acima), mas a lista não vira nem limita a
  altura pela viewport. Observação do código: é proposital NÃO ser menu Radix (um
  menu roubaria o foco do textarea).
- `src/components/agent/entities/AgentBuilderDialog.tsx::AvatarPicker` (~linha 138):
  `absolute left-0 top-full z-20 mt-[6px] w-[252px]`. Abre para baixo e para a
  direita; pode cortar na borda de baixo ou direita sem virar. Também proposital não
  ser Radix (o input livre precisa de foco real).
- Os "fantasmas" de drag de aba/projeto e as linhas indicadoras de drop também são
  posicionados na mão, mas são feedback de arrasto, não menus, e não precisam de flip.
  Fora do escopo.

---

## 3. O plano (como fazer e o que fazer)

### P0 (recomendado, baixo risco, resolve o que está visível)

1. **`collisionPadding` central nos wrappers.** Adicionar `collisionPadding={8}` (e
   expor a prop com default) em `DropdownContent`, `DropdownSubContent`,
   `ContextMenuContent`, no `SubContent` de `ContextMenuSub`, no `Content` do
   `Tooltip` e no `Content` do `Select`. Um lugar, conserta a margem de borda de
   todos os menus de uma vez.
   - Arquivos: `src/components/ui/{DropdownMenu,ContextMenu,Tooltip,Select}.tsx`.

2. **Corrigir a intenção de alinhamento dos launchers à esquerda.** Em
   `CodeProjectGroup.tsx`, trocar `align="end"` por `align="start"` no launcher "+"
   (linha 189) e no menu "⋯" (linha 205). Auditar o ProjectGroup espelhado da Agent
   sidebar (o comentário em `CodeProjectGroup` diz que ele espelha o da Agent sidebar)
   e aplicar a mesma regra.
   - Regra geral a seguir: alinhar/abrir sempre para o lado OPOSTO à borda da tela
     mais próxima do gatilho. Esquerda da tela = `align="start"`; direita = `align="end"`.

### P1 (polimento intencional)

3. **Placement intencional dos pickers do composer** (`ModelPicker`, `VariantPicker`,
   `PermissionPicker`, `ProjectPicker`, `BranchPicker`, `AgentPicker`, `PlusMenu`).
   Como o composer fica na base da tela, declarar `side="top"` (hoje caem para baixo e
   o Radix vira para cima, gerando um "flash" de reposicionamento). Manter
   `align="start"`. Requer estender `DropdownContent` para aceitar `side` (e
   `collisionPadding`/`alignOffset`).

4. **Borda nos popups custom.** `AvatarPicker` vira para cima quando perto da base e
   limita a largura à viewport; `MentionPopup` limita a altura da lista à viewport.
   Sem dependência nova (clamp/medição manual com `getBoundingClientRect`).

### P2 (fundação, opcional, para escalar)

5. **Adotar `@floating-ui/react` + hook compartilhado `useAnchoredPopup`** (flip +
   shift + size, e `safePolygon` quando houver flyout em cascata custom). Migrar
   `MentionPopup` e `AvatarPicker` para ele. Assim, qualquer popup custom futuro ganha
   flip/shift (e safe triangle) de graça, com a mesma robustez do Radix.

6. **Registrar a política na `CLAUDE.md`** (seção Theming/Conventions): todo elemento
   flutuante usa OU um primitivo Radix (ganha grace-area + colisão de graça) OU o
   `useAnchoredPopup`; `collisionPadding` padrão = 8.

### Nota honesta sobre o pedido

O pedido foi "aplicar safety triangle em todo o metacodex". Como já usamos Radix
`Sub`, o safety triangle já está ativo em todos os submenus atuais. O ganho real e
visível está em (A) corrigir a direção de abertura dos launchers e (B) dar margem de
borda. O safe triangle custom só passa a ser necessário se/quando criarmos um flyout
em cascata fora do Radix, e o P2 cobre isso preventivamente.

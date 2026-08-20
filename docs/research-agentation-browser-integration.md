# Pesquisa: Agentation como referencia para o browser nativo

Status: referencia tecnica, com P0 e controle de contexto aplicados de forma independente.
Data: 2026-08-20.
Versao analisada: commit [`8158a97`](https://github.com/benjitaylor/agentation/tree/8158a97c10c37e577b0a6e2d3175d143918216cd), pacote [`agentation` 3.0.2](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/package.json#L2-L4) e [`agentation-mcp` 1.2.0](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/mcp/package.json#L2-L4).

## Conclusao executiva

Agentation e uma boa referencia de produto e de interacao, mas nao deve virar dependencia central nem fonte de codigo copiado para o metacodex.

O encaixe recomendado e:

1. Manter o runtime neutro injetado pelo metacodex no webview filho.
2. Recriar internamente apenas os conceitos de alto valor: anotacoes em lote, comentario por alvo, selecao de texto, navegacao entre elemento filho e ancestral, Shadow DOM aberto, pausa de animacoes e nivel de detalhe do payload.
3. Manter screenshot nativo e envio direto ao PTY, que sao vantagens reais do metacodex.
4. Nao incorporar o pacote, o MCP ou o schema do Agentation sem permissao escrita do autor. A licenca PolyForm Shield proibe usar o software para oferecer produto ou servico concorrente. O browser do metacodex tem sobreposicao direta com o produto licenciado. [Fonte: LICENSE](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/LICENSE#L1-L17).

Esta analise nao e parecer juridico. A restricao e clara o bastante para tratar copia, fork e distribuicao como bloqueados ate haver autorizacao.

## Escopo aplicado nesta entrega

Foram aplicados de forma independente: alvos `element` e `text`, texto apenas em tags semanticas, navegacao entre filho e ancestral, Shadow DOM aberto, payload compacto por padrao, diagnostico sob demanda e captura nativa por regiao.

Ficaram para uma fase opcional: fila de anotacoes com comentario, multisselecao, descricao semantica do desenho e pausa de animacoes. Esses recursos mudam o fluxo direto de clique e envio e precisam de uma decisao propria de produto. Eles nao sao necessarios para corrigir o browser basico solicitado nesta entrega.

## O que o Agentation realmente e

O pacote principal e um componente React 18+ adicionado dentro da propria aplicacao que esta sendo revisada. Ele renderiza uma toolbar por portal no `document.body`, instala listeners globais e usa o DOM da pagina para identificar alvos. A integracao oficial e `<Agentation />` junto ao app. [Fontes: README](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/README.md), [componente principal](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L288-L340), [portal](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L3565-L3595).

Isso difere do metacodex. Nosso browser hospeda qualquer projeto HTTP em um webview nativo separado e injeta `browser_init.js` sem exigir React, dependencia npm ou mudanca no repositorio visualizado. A integracao direta do pacote Agentation reduziria a cobertura a React, obrigaria cada projeto a cooperar e colocaria UI de depuracao dentro do bundle do projeto.

### Fluxo local do Agentation

Sem servidor, as anotacoes ficam em `localStorage`, separadas pelo pathname e podadas depois de sete dias. [Fonte: storage](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/storage.ts#L9-L35).

Com callbacks, o host recebe anotacoes estruturadas e o Markdown final por `onAnnotationAdd`, `onCopy` e `onSubmit`. Tambem existem `endpoint`, `sessionId` e `webhookUrl` para sincronizacao externa. [Fonte: API do componente](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L288-L340).

## Mecanismo de selecao e anotacao

### Alvo pontual

O Agentation intercepta `click` em capture phase, encontra o elemento mais profundo no ponto e impede a acao original quando o modo de feedback bloqueia interacoes. Ele tambem atravessa Shadow DOM aberto chamando `elementFromPoint` novamente dentro do `shadowRoot`. [Fontes: selecao](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L1926-L2068), [Shadow DOM](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L233-L250).

O nome legivel do alvo considera semantica, ID, classe, texto curto, `aria-label`, `role`, `href`, `placeholder` e `alt`. Containers recebem nomes derivados de classe, role ou tag. Texto aparece em headings, paragrafos e outros elementos textuais, enquanto containers nao recebem automaticamente todo o texto descendente. [Fonte: identificacao de elementos](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/element-identification.ts#L79-L199).

Quando ha texto selecionado, o pacote preserva ate 500 caracteres em `selectedText`. Isso separa melhor uma revisao de copy de uma revisao estrutural. [Fonte: captura da selecao](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L2028-L2061).

### React e localizacao de origem

O pacote procura a Fiber associada ao elemento, sobe a arvore para coletar componentes React e filtra internos de framework em diferentes niveis de detalhe. Em builds de desenvolvimento, tambem tenta extrair `_debugSource`, arquivo, linha e coluna. Esses dados dependem de internals do React e podem nao existir em producao. [Fontes: deteccao React](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/react-detection.ts), [source location](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/source-location.ts).

### Multisselecao e area

Ha dois modelos de multisselecao. O usuario pode alternar elementos individuais com `Cmd+Shift+click`, ou arrastar uma regiao. No arraste, o codigo amostra cantos, bordas e centro, procura elementos que cruzam a regiao, elimina wrappers grandes e escolhe elementos semanticamente relevantes. Se nao houver alvo, cria uma anotacao de area vazia. [Fonte: selecao multipla](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L1943-L1980), [Fonte: selecao por area](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L2125-L2554).

### Cursores

O modo de feedback usa `crosshair` para alvos estruturais e preserva `text` em elementos textuais. Essa distincao comunica a intencao antes do clique. [Fonte: estilos de cursor](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L1795-L1827).

## Payload e controle de contexto

O objeto de anotacao possui um nucleo pequeno, mas muitos campos opcionais. O nucleo inclui ID, coordenadas, comentario, nome do elemento, caminho e timestamp. O contexto adicional pode incluir texto selecionado, retangulo, texto proximo, classes, elementos proximos, estilos computados, caminho completo, acessibilidade, componente React, arquivo de origem e caixas individuais de uma multisselecao. [Fonte: tipo `Annotation`](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/types.ts#L5-L69).

O maior aprendizado para o metacodex e o controle explicito de densidade. O Agentation oferece `compact`, `standard`, `detailed` e `forensic`. O compacto envia nome, arquivo, comentario e um trecho curto de texto selecionado. Os demais acrescentam viewport, caminho, React, classes, posicao, contexto, estilos e acessibilidade de forma progressiva. [Fonte: gerador de output](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/generate-output.ts#L7-L128).

O metacodex agora aplica essa politica em `src/features/browser/context.ts`: estrutura envia tag, ID, poucas classes, seletor e componente; texto so entra para tags textuais. O menu do browser permite alternar entre contexto compacto, que e o padrao, e diagnostico sob demanda.

## Desenho, screenshot e pausa de animacoes

O Agentation tem desenho livre. No envio, classifica o gesto como circulo, caixa, sublinhado, seta ou desenho. Depois amostra elementos sob o traco e converte o desenho em descricao textual. [Fonte: interpretacao dos desenhos](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/components/page-toolbar-css/index.tsx#L2969-L3099).

A documentacao atual declara que o output e somente texto e nao inclui screenshots. [Fonte: limitacoes oficiais](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/example/src/app/features/page.tsx#L159-L167). Existe um utilitario experimental de captura DOM com import dinamico de `modern-screenshot`, mas ele nao e importado pelo componente principal no commit analisado. [Fonte: utilitario de screenshot](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/screenshot.ts).

O metacodex deve manter sua captura nativa por `WKWebView.takeSnapshot`. Ela representa pixels realmente compostos pelo browser, funciona sem adicionar biblioteca ao projeto e ja pode ser ligada ao retangulo do elemento ou a uma area escolhida. O aprendizado util do Agentation esta em gerar uma descricao textual do desenho junto do PNG, nao em trocar o screenshot nativo por serializacao de DOM.

Outra ferramenta valiosa e pausar a pagina. O Agentation pausa animacoes e transicoes CSS, Web Animations API, videos, timers, intervals e `requestAnimationFrame`, com filas para retomar parte do trabalho depois. [Fonte: freeze de animacoes](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/package/src/utils/freeze-animations.ts). Para o metacodex, vale uma versao mais conservadora inicialmente: CSS, WAAPI e video. Monkey patch global de timers pode alterar comportamento do projeto e precisa ficar atras de uma acao explicita.

## MCP, HTTP e protocolo

O pacote `agentation-mcp` inicia um servidor HTTP na porta 4747 para receber sessoes e anotacoes e um servidor MCP por stdio para o agente. O protocolo oferece REST, SSE, SQLite local e ferramentas para listar, aguardar, reconhecer, responder, resolver e descartar anotacoes. [Fonte: README do MCP](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/mcp/README.md#L34-L167).

Os eventos possuem tipo, timestamp, session ID, sequencia monotona e payload. As anotacoes sincronizadas ganham estados `pending`, `acknowledged`, `resolved` e `dismissed`, alem de thread entre humano e agente. [Fonte: tipos do protocolo](https://github.com/benjitaylor/agentation/blob/8158a97c10c37e577b0a6e2d3175d143918216cd/mcp/src/types.ts#L5-L107).

Esse servidor nao deve entrar na primeira versao do metacodex. O produto ja conhece projeto, webview e CLI ativos. `src/features/browser/sendToAgent.ts` escreve diretamente no PTY do agente correto. Adicionar Node, SQLite, porta HTTP, MCP e uma segunda fila de estado duplicaria infraestrutura e criaria mais um servidor para iniciar e matar.

O conceito que vale preservar e o ciclo de vida local. Uma anotacao pode existir como `draft`, `sent` e `resolved`, com ID proprio e relacao com o screenshot. Isso pode viver no estado React do browser e ser enviado diretamente ao PTY, sem daemon e sem ressuscitar a Agent View removida.

## Comparacao com o browser atual

| Tema | Agentation | Metacodex atual | Direcao recomendada |
|---|---|---|---|
| Integracao | Componente React dentro do app | Script neutro injetado no webview | Manter injecao neutra |
| Cobertura | React 18+ | Qualquer pagina HTTP suportada pelo webview | Nao reduzir cobertura |
| Selecao | Elemento, texto, multisselecao e area | Elemento, texto, ancestral e area de screenshot | Avaliar multisselecao depois |
| Contexto | Quatro niveis de detalhe | Compacto e diagnostico | Manter compacto por padrao |
| Comentario | Nota por alvo, marcadores e envio em lote | Clique envia imediatamente | Criar fila curta de anotacoes com comentario opcional |
| Screenshot | Output oficial somente texto | PNG nativo com caminho no PTY | Manter PNG nativo |
| Desenho | Descricao semantica do gesto | Traco visual no overlay | Enviar PNG mais descricao compacta |
| Agente | HTTP, MCP, SSE e SQLite | Escrita direta no CLI ativo | Manter entrega direta |
| Licenca | PolyForm Shield | Codigo proprio | Nao copiar nem distribuir o pacote |

## Plano pratico para o metacodex

### P0. Resolver a diferenca entre dobra e texto

Introduzir um descritor interno proprio:

```ts
type VisualTarget = {
  kind: "element" | "text" | "region";
  tag?: string;
  id?: string;
  classes?: string[];
  selector?: string;
  component?: string;
  source?: string;
  text?: string;
  rect: { x: number; y: number; width: number; height: number };
};
```

Regras:

- `text` so existe quando `kind` for `text` ou quando a tag for textualmente semantica.
- Container nunca herda `innerText` de toda a dobra.
- O hover mostra breadcrumb curto, por exemplo `main > section.hero > h1`.
- `[` escolhe o ancestral e `]` volta ao descendente sob o cursor. Isso resolve explicitamente a ambiguidade entre a dobra e o texto dentro dela, algo que a escolha automatica do elemento mais profundo nao resolve sozinha.
- Shadow DOM aberto participa da busca.

### P1. Sessao curta de anotacoes

Trocar o envio imediato por um fluxo opcional:

1. Clicar cria marcador numerado.
2. Um popup pequeno aceita comentario opcional.
3. O usuario pode adicionar mais alvos, editar ou remover.
4. `Enviar` produz um unico bloco compacto e os PNGs necessarios.

O limite deve ser pequeno, por exemplo 8 anotacoes, para manter o browser como ferramenta de debug e nao como sistema de tickets.

### P2. Ferramentas de debug com bom retorno

- Pausar CSS, WAAPI e video.
- Capturar texto selecionado de forma explicita.
- Associar desenho a elemento, regiao e descricao curta.
- Expor um controle `Compacto` ou `Diagnostico` no menu secundario. O padrao continua compacto.

### P3. Interoperabilidade opcional

Se houver demanda real de usuarios que ja instalaram Agentation, estudar um receptor generico de webhook local com token de capacidade. O projeto visualizado poderia enviar seu proprio JSON ao metacodex. Nao implementar o endpoint Agentation, seu schema ou suas ferramentas MCP sem permissao escrita e revisao juridica.

## Decisao recomendada

Usar Agentation como benchmark de UX e modelo mental. Nao usar como dependencia, fork ou base de codigo.

O browser do metacodex deve continuar sendo menor e mais direto: qualquer projeto, screenshot nativo, contexto compacto, comentario visual e entrega imediata ao agente que ja esta rodando. A melhor contribuicao da referencia e transformar um clique isolado em uma anotacao precisa e editavel, sem transformar o metacodex em outro browser completo ou em um servidor de colaboracao.

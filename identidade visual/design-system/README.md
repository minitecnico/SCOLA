SCOLA é um sistema de gestão escolar por assinatura para escolas e professores autônomos: chamada pelo celular, notas por trimestre, boletins e relatórios, planejamento, avisos e calendário. O nome vem do latim e do italiano (*escola*).

A marca é uma **ferramenta profissional de sala de aula**, como um bom caderno ou uma boa caneta: sóbria, resistente e sempre à mão. Três cores, uma fonte, um símbolo.

## Personalidade e tom

- **É:** prático, direto, confiável, moderno, brasileiro, acessível.
- **Não é:** infantil, lúdico demais, burocrático, corporativo frio, "startup genérica".
- Nada de mascotes, lápis sorridentes, capelos, livrinhos coloridos ou emoji decorativo.
- Escreva em português do Brasil, tratando o usuário por **você**. Frases curtas, verbo na frente: "Salvar chamada", "Enviar boletim", "Lançar notas".
- Interface em caixa de frase ("Notas do 2º trimestre"), nunca Tudo Em Maiúsculas. Caixa alta só no logotipo e no estilo `legenda`.
- Diga o que aconteceu e o que fazer: "Chamada salva. 3 faltas registradas." em vez de "Operação realizada com sucesso".
- Para o professor: rapidez ("em segundos", "sem trabalho"). Para a direção: controle e confiança ("tudo registrado", "documento oficial").

## Logo

O símbolo é um quadrado `amarelo` com cantos de `radius-simbolo` (22% do lado) e um **S** `preto` em Inter ExtraBold ocupando 58% da altura. O logotipo é **SCOLA** em Inter ExtraBold, caixa alta, espaçamento de +8%; "GESTÃO ESCOLAR" em Inter SemiBold vai embaixo, espaçado para ter a mesma largura do nome. Os arquivos estão no grupo **Logo**; textos já convertidos em curvas.

| Versão | Arquivo | Quando usar |
|---|---|---|
| L1 Principal horizontal | `scola-horizontal.svg` | Fundos claros: login (lado branco), documentos, site, propostas. |
| L1 compacta | `scola-horizontal-compacta.svg` | Fundos claros quando o logo tem menos de 48px de altura (sem "Gestão escolar"). |
| L2 Negativa | `scola-horizontal-negativa.svg` | Fundo `preto` com 48px ou mais: painel escuro do login, capas. |
| L2 compacta negativa | `scola-horizontal-compacta-negativa.svg` | **Menu lateral** (36px) e barra superior do celular (32px). |
| L3 Vertical | `scola-vertical.svg`, `scola-vertical-negativa.svg` | Capas, redes sociais, telas de carregamento. |
| L4 Símbolo | `scola-simbolo.svg` | Favicon, ícone do app, avatar, marca d'água. |
| L5 Mono preta | `scola-mono-preta.svg`, `scola-simbolo-mono-preto.svg` | Impressão P&B: rodapé de boletins e relatórios. O S é vazado. |
| L6 Mono branca | `scola-mono-branca.svg`, `scola-simbolo-mono-branco.svg` | Sobre fotos ou fundos escuros onde o amarelo não cabe. O S é vazado. |

- **Área de proteção:** deixe livre em volta do logo um espaço igual à altura do **S** do símbolo (58% do lado do quadrado).
- **Tamanho mínimo:** horizontal com 100px de largura (25 mm impresso); símbolo com 16px (5 mm). Abaixo de 48px de altura use a versão compacta: "Gestão escolar" deixa de ser legível.
- **Proibido:** esticar ou achatar; girar; trocar as cores; usar `ok`, `atencao` ou `problema` na marca; aplicar sombra, contorno ou degradê; pôr sobre fundo poluído sem a versão mono; recompor o nome com outra fonte; arredondar o quadrado com outro raio; usar `amarelo` para o nome sobre branco.

## Cores

A marca usa só `amarelo`, `preto` e `branco`. Os neutros (`preto-hover`, `texto-secundario`, `texto-secundario-escuro`, `borda`, `fundo`) sustentam a interface.

- Combinações aprovadas: `preto` sobre `amarelo` (12,9:1), `amarelo` sobre `preto` (12,9:1), `preto` sobre `branco` (19,8:1), `branco` sobre `preto`.
- `amarelo` sobre `branco` **nunca** é texto (1,5:1). Amarelo é fundo, símbolo ou marcação de item ativo.
- Item ativo do menu: fundo `amarelo`, texto `preto`. Botão principal: fundo `preto`, texto `branco`, hover `preto-hover`.
- Anel de foco: 2px `preto` com 2px de folga sobre fundos claros; 2px `amarelo` sobre `preto`. Os dois passam de 3:1.
- **Cores de situação não são marca.** `ok`, `atencao` e `problema` significam presente, recuperação e falta, e vêm sempre com palavra ou ícone ("Presente", "Falta"), nunca só a cor. `atencao` não serve como cor de texto (2,8:1): use-a como fundo de selo com texto `preto`. `ok` como texto só a partir de 24px.
- Impressão: `preto` sai em K100; `amarelo` aproximadamente C0 M18 Y92 K2 (peça prova de cor à gráfica).

## Tipografia

- **Inter** (Google Fonts) em tudo: 400, 500, 600 e 800. O logotipo também é Inter, já convertido em curvas.
- Títulos em `display`, `titulo-1` (800) e `titulo-2` (600). Texto em `corpo`; tabelas e listas em `corpo-sm`; botões e menu em `rotulo`; caixa alta pequena em `legenda`.
- Campos de formulário no celular com 16px (`corpo`) para o iPhone não dar zoom.
- Números de notas e médias com `font-variant-numeric: tabular-nums` para alinhar colunas.

## Espaço e forma

- Grade de 4px: `space-1` 4, `space-2` 8, `space-4` 16, `space-6` 24, `space-8` 32.
- Cantos: `radius-sm` em selos e marcações da chamada, `radius-md` em botões, campos e cartões, `radius-lg` em painéis e modais. `radius-simbolo` é exclusivo do símbolo.
- Separe com `borda` (1px), não com sombra. Superfícies: `fundo` na tela, `branco` nos cartões.
- Alvos de toque no celular com pelo menos 44px de altura: a chamada é feita com o polegar, com pressa.

## Iconografia

- O símbolo é o único ícone de marca. Não crie variações (S com capelo, S com lápis etc.).
- Ícones de interface: traço simples, monocromático em `preto` (ou `branco` no menu escuro); nunca `amarelo` sobre `branco`. Ícones de situação herdam `ok`, `atencao` ou `problema` e ficam ao lado de uma palavra.
- Sem emoji na interface nem nos documentos.

## Ícones do app e aplicações

Os arquivos do grupo **Icones** têm os nomes que o sistema espera em `public/`: `favicon.svg`, `icon-192.png`, `icon-512.png` e `apple-touch-icon.png` (fundo `amarelo` sólido, sem transparência e sem cantos arredondados). No `icon-512.png` o S tem 42% do lado e fica dentro do círculo seguro de 80% (versão *maskable*). O grupo **Aplicacoes** tem a imagem de compartilhamento (`og-image.png`, 1200 × 630) e a foto de perfil (`perfil-1080.png`).

## Onde testar

Confira cada mudança de marca nos contextos reais (cartão **Contextos**): menu lateral `preto` com a compacta negativa a 36px; login com o painel `preto` e o símbolo gigante a 6% de opacidade; barra superior do celular a 32px; favicon a 16px entre outras abas; ícone na tela inicial; rodapé de boletim em P&B com a mono preta; prévia de link no WhatsApp.

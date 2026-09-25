# Escopo de identidade visual — SCOLA

Briefing para criar a marca do SCOLA (logo, símbolo, ícones e aplicações).
Os arquivos finais substituem os que o sistema usa hoje. Os nomes e tamanhos pedidos aqui
já são os que o código espera, então basta trocar os arquivos.

---

## 1. O produto

**SCOLA** é um sistema de gestão escolar vendido por assinatura para **escolas** e **professores autônomos**.
Cada cliente é uma "base" criada pelo administrador da plataforma.

O que o sistema faz, em ordem de uso diário:
1. **Chamada**: o professor marca presença e falta pelo celular, em segundos.
2. **Notas**: lançamento por trimestre, com média automática e recuperação.
3. **Relatórios e boletins**: impressos ou enviados por link (WhatsApp).
4. Planejamento de aulas, avisos para a equipe e calendário escolar.

**Nome:** *Scola* vem do latim e do italiano (escola). Curto, sonoro, fácil de lembrar e de digitar.

## 2. Público

| Quem | Contexto | O que a marca precisa passar |
|---|---|---|
| **Diretor(a) / coordenação** (quem compra) | Computador, sala da coordenação | Seriedade, controle, organização, confiança |
| **Professor(a)** (quem mais usa) | Celular, sala de aula, pressa | Rapidez, simplicidade, "não dá trabalho" |
| **Secretaria** | Computador, cadastros e documentos | Clareza, documento oficial |
| **Pais e alunos** (indireto) | Boletim impresso ou link no WhatsApp | Credibilidade institucional |

## 3. Personalidade

**É:** prático · direto · confiável · moderno · brasileiro · acessível
**Não é:** infantil · lúdico demais · burocrático · corporativo frio · "startup genérica"

Referência de tom: **ferramenta profissional de sala de aula**, como um bom caderno ou uma boa caneta.
Sóbria, resistente e sempre à mão. Nada de mascotes, lápis sorridentes, capelos ou livrinhos coloridos.

Palavras-chave para o conceito: **presença, clareza, marca/check, ritmo, organização.**

## 4. Paleta (definida, não alterar)

A interface já usa estas cores. A marca deve nascer delas.

### Cores da marca

| Função | Nome | HEX | RGB | Uso |
|---|---|---|---|---|
| Primária | **Amarelo SCOLA** | `#FACC15` | 250 204 21 | Símbolo, destaques, item ativo do menu |
| Base | **Preto SCOLA** | `#0A0A0A` | 10 10 10 | Texto, botões, fundo do menu lateral |
| Base | **Branco** | `#FFFFFF` | 255 255 255 | Fundos, texto sobre preto |

### Neutros de apoio

| HEX | Uso |
|---|---|
| `#171717` | Preto de botão / hover |
| `#616161` | Texto secundário |
| `#E3E3E3` | Bordas e divisórias |
| `#F9F9F9` | Fundo das telas |

### Cores de situação (NÃO fazem parte da marca)

O sistema usa **verde / laranja / vermelho** só para significado: presente, recuperação, falta.
**A marca não pode usar nenhuma delas**, para não se confundir com status.

| Significado | HEX |
|---|---|
| OK / presente / aprovado | `#16A34A` |
| Atenção / recuperação | `#F97316` |
| Problema / falta | `#DC2626` |

### Regras de contraste

- Amarelo sobre branco **não** serve para texto (contraste insuficiente). Amarelo é fundo ou símbolo, nunca letra sobre branco.
- Combinações aprovadas: **preto sobre amarelo**, **amarelo sobre preto**, **preto sobre branco**, **branco sobre preto**.

## 5. Tipografia

| Uso | Fonte | Pesos |
|---|---|---|
| Interface e textos (já em uso) | **Inter** (Google Fonts, gratuita) | 400, 500, 600, 800 |
| Logotipo | Livre, desde que conviva bem com a Inter | — |

Sugestão para o logotipo: uma grotesca geométrica e firme (ex.: Inter ExtraBold, Manrope, Plus Jakarta Sans,
Satoshi, General Sans). Hoje o nome aparece em **caixa alta com espaçamento largo** ("S C O L A"). Pode manter
ou evoluir, mas precisa ser **legível em 16 px** no menu do sistema.

## 6. O que existe hoje (ponto de partida)

- **Símbolo:** quadrado amarelo `#FACC15` com cantos arredondados (raio ≈ 22% do lado) e um **"S" preto** grosso ao centro.
- **Logotipo:** "SCOLA" em preto (ou branco no fundo escuro), caixa alta, espaçamento largo, com "GESTÃO ESCOLAR" pequeno embaixo.
- Arquivos atuais: `public/favicon.svg`, `public/icon-192.png`, `public/icon-512.png`, `src/components/Logo.tsx`.

Pode refinar o existente ou propor algo novo, respeitando a paleta e a personalidade.

## 7. Entregáveis

### 7.1 Logo — versões obrigatórias

| # | Versão | Descrição |
|---|---|---|
| L1 | **Principal horizontal** | Símbolo à esquerda + "SCOLA" (+ "Gestão escolar" opcional) |
| L2 | **Principal horizontal negativa** | A mesma, para fundo preto (é a que aparece no menu do sistema) |
| L3 | **Vertical / empilhada** | Símbolo em cima, nome embaixo (capa, redes sociais) |
| L4 | **Símbolo isolado** | Só o ícone. Precisa funcionar sozinho em 16 × 16 px |
| L5 | **Monocromática preta** | Tudo em `#0A0A0A`, para impressão P&B (boletins, relatórios) |
| L6 | **Monocromática branca** | Tudo branco, sobre fotos ou fundos escuros |

**Regras de construção:**
- **Área de proteção:** espaço livre em volta do logo igual à altura do "S" do símbolo.
- **Tamanho mínimo:** horizontal com 100 px de largura na tela (25 mm impresso); símbolo com 16 px (5 mm).
- O símbolo precisa ser reconhecível **em preto e branco**: os boletins costumam ser impressos em impressora P&B.

### 7.2 Ícones do sistema (substituem os arquivos atuais)

Salvar com **exatamente** estes nomes na pasta `public/` do projeto:

| Arquivo | Tamanho | Formato | Observação |
|---|---|---|---|
| `favicon.svg` | vetor, viewBox quadrado | SVG | Aba do navegador. Traços grossos, sem detalhes finos |
| `favicon.ico` | 16, 32 e 48 px no mesmo arquivo | ICO | Compatibilidade com navegadores antigos |
| `icon-192.png` | 192 × 192 | PNG, fundo **amarelo sólido**, sem transparência | Ícone do app instalado (Android) |
| `icon-512.png` | 512 × 512 | PNG, fundo amarelo sólido | Ícone do app e versão *maskable* |
| `apple-touch-icon.png` | 180 × 180 | PNG, fundo sólido, **sem** cantos arredondados | iPhone/iPad (o sistema arredonda sozinho) |

**Zona segura (maskable):** no `icon-512.png`, o desenho importante deve caber num **círculo central de 80% do lado**
(≈ 410 px de diâmetro). O Android recorta as bordas em círculo, gota ou quadrado.

### 7.3 Aplicações

| # | Peça | Tamanho | Onde aparece |
|---|---|---|---|
| A1 | **Imagem de compartilhamento (Open Graph)** — `og-image.png` | 1200 × 630 px | Prévia quando o link do sistema ou de um relatório é enviado no WhatsApp |
| A2 | **Foto de perfil** (WhatsApp Business / Instagram) | 1080 × 1080 px | Símbolo centralizado, dentro de um círculo seguro |
| A3 | **Capa / banner** (Instagram, LinkedIn) | 1584 × 396 px e 1080 × 1350 px | Divulgação comercial |
| A4 | **Cabeçalho de documento** | faixa de 2 a 3 mm | Rodapé dos boletins e relatórios: "Documento gerado por SCOLA" |
| A5 | **Apresentação comercial** (capa + 1 slide modelo) | 1920 × 1080 px | Proposta para vender a escolas |
| A6 | **Assinatura de e-mail** | 600 × 150 px | Contato com clientes |

### 7.4 Mini manual de marca (1 a 3 páginas, PDF)

- Versões do logo e quando usar cada uma
- Área de proteção e tamanho mínimo
- Paleta com HEX / RGB / CMYK
- Tipografia
- **Usos proibidos:** esticar, girar, mudar cores, aplicar sombra, colocar sobre fundo poluído, usar verde, laranja ou vermelho na marca

## 8. Onde a marca aparece no sistema (para testar)

Teste cada proposta nestes contextos reais antes de fechar:

1. **Menu lateral** — fundo `#0A0A0A`, logo L2 com ~36 px de altura, canto superior esquerdo.
2. **Tela de login** — metade esquerda preta com a marca, metade direita branca com o formulário.
   O símbolo também aparece enorme e bem apagado (opacidade 6%) no canto do painel preto.
3. **Barra superior no celular** — fundo preto, logo compacto com 32 px de altura.
4. **Aba do navegador** — favicon em 16 × 16 px ao lado de outras abas.
5. **Tela inicial do celular** — ícone do app ao lado de WhatsApp, Instagram etc.
6. **Boletim impresso em P&B** — versão L5 no rodapé.
7. **Prévia de link no WhatsApp** — imagem A1.

## 9. Formatos de entrega

- **Vetor editável:** `.svg` + arquivo-fonte do programa usado (`.afdesign`, `.ai`, `.fig`, `.psd` com camadas etc.)
- **SVG limpo para a web:** textos convertidos em curvas, sem imagens embutidas, cores em HEX, `viewBox` definido
- **PNG** com fundo transparente das versões L1–L6, em 1× e 2×
- **PDF** do mini manual
- Estrutura de pastas sugerida:

```
marca/
  fonte/        arquivos editáveis
  logo/         L1..L6 em SVG e PNG
  icones/       favicon.svg, favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png
  aplicacoes/   og-image.png, perfil, capas, assinatura
  manual.pdf
```

## 10. Checklist de aprovação

- [ ] O símbolo é reconhecível em 16 × 16 px?
- [ ] Funciona em preto e branco (impressão de boletim)?
- [ ] Funciona sobre fundo preto (menu do sistema) e sobre branco (login, documentos)?
- [ ] Usa só amarelo `#FACC15`, preto `#0A0A0A` e branco? Nada de verde, laranja ou vermelho?
- [ ] O `icon-512.png` respeita a zona segura de 80%?
- [ ] Transmite "profissional e prático", e não "infantil"?
- [ ] O nome "SCOLA" fica legível a 16 px de altura?
- [ ] Os arquivos têm os nomes e tamanhos da seção 7.2?

## 11. Depois de pronto (para aplicar no sistema)

1. Copie os arquivos da pasta `icones/` para `public/`, substituindo os atuais.
2. Envie o `logo` horizontal em SVG (L1 e L2). O componente `src/components/Logo.tsx` é atualizado para usar o desenho novo.
3. Coloque `og-image.png` em `public/`. As tags de compartilhamento são adicionadas ao `index.html`.
4. Rode `npm run dev`, confira os contextos da seção 8 e faça o `git push` para publicar.

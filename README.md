# SCOLA — Sistema de Gestão Escolar

Chamadas, notas por trimestre, Central de Avaliações, boletins/relatórios, planejamento, avisos e calendário.
Multi-escola: **você (administrador) cria as bases**; cada base é uma escola ou um professor autônomo.

## Quem faz o quê

| Papel | Onde | O que faz |
|---|---|---|
| **Administrador** (você) | Painel do administrador | Cria bases, define plano e limite de alunos, suspende/reativa, gera senhas, entra em qualquer base em modo suporte |
| **Gestão / Coordenação** | Dentro da base | Tudo da base: equipe, cadastros, notas, revisão de planejamentos, avisos |
| **Professor(a)** | Dentro da base | Chamadas, notas, avaliações, planejamento, relatórios |
| **Secretaria** | Dentro da base | Turmas, alunos, relatórios, avisos, calendário |

Não existe autocadastro. Você cria a base e o gestor; o gestor cria a equipe em **Equipe**. Toda conta nova recebe uma
senha provisória (mostrada uma vez, com botão de enviar pelo WhatsApp) e troca no primeiro acesso.
Um professor que trabalha em duas escolas usa o mesmo login nas duas e alterna pelo menu.

## Arquitetura (100% plano gratuito)

- **GitHub**: código + deploy automático (GitHub Actions) a cada push na `main`.
- **Cloudflare Workers**: um único Worker serve o site (React) e a API (`/api/*`).
- **Cloudflare D1**: banco de dados (SQLite). **Cloudflare KV**: anexos (até 20 MB por arquivo).
- Login próprio (e-mail + senha, cookie seguro de 30 dias). Nenhum outro serviço.

## Colocar no ar (uma vez só)

Pré-requisitos: Node 20+, uma conta gratuita no [Cloudflare](https://dash.cloudflare.com) e uma no GitHub.

```bash
npm install
npx wrangler login              # abre o navegador na sua conta Cloudflare
npm run cf:setup                # cria o banco D1 e o KV e grava os IDs no wrangler.jsonc
npm run deploy                  # primeira publicação
npm run admin -- seu@email.com "Seu Nome"   # cria o SEU acesso de administrador (mostra a senha)
```

O endereço aparece no final do deploy (ex.: `https://scola.SEU-USUARIO.workers.dev`).
Domínio próprio: Cloudflare → Workers → scola → Settings → Domains & Routes.

### Deploy automático pelo GitHub

1. Crie um repositório (privado) e envie o código:
   ```bash
   git init && git add . && git commit -m "SCOLA" && git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/scola.git && git push -u origin main
   ```
2. No Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"**, adicione a permissão
   **Account · D1 · Edit** e crie.
3. No GitHub: **Settings → Secrets and variables → Actions** e cadastre:
   - `CLOUDFLARE_API_TOKEN` — o token do passo 2
   - `CLOUDFLARE_ACCOUNT_ID` — o Account ID (barra lateral do painel Cloudflare)

Pronto: todo `git push` na `main` aplica as migrações do banco e publica.

## Trazer os professores que já usam o sistema antigo (Supabase)

O script só **lê** o Supabase. Mantém escolas, turmas, alunos, chamadas, notas, avaliações, avisos, calendários,
planejamentos, anexos — e **os professores continuam entrando com o mesmo e-mail e senha**.

```bash
export SUPABASE_DB_URL="postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://xxxx.supabase.co"          # opcional: para copiar os anexos
export SUPABASE_SERVICE_KEY="eyJ..."                    # opcional: service_role (Settings → API)

npm run migrar                 # simula: mostra o resumo e avisos, não grava nada
npm run migrar -- --aplicar    # grava no Cloudflare
```

- `SUPABASE_DB_URL`: Supabase → Project Settings → Database → Connection string (Session pooler).
- Rode **uma vez**, logo depois do `cf:setup`, antes de os professores começarem a usar a versão nova.
- A pasta `migracao/` gerada contém dados pessoais: não a envie ao GitHub (já está no `.gitignore`).
- Quem entrava só pelo Google não tinha senha: o script avisa, e você gera a senha em **Equipe**.

## Google Docs, Sheets e Slides (ambiente preparado)

Cada usuário conecta a **própria** conta Google (OAuth). O Worker guarda só o refresh token, **cifrado** (AES-GCM), na tabela `google_accounts`.
O escopo é `drive.file`: o SCOLA só acessa arquivos que ele mesmo criou — não exige verificação do app pelo Google.

1. Google Cloud Console → crie o projeto → **APIs e serviços → Biblioteca**: ative **Google Drive API**, **Google Docs API**, **Google Sheets API** e **Google Slides API**.
2. **Tela de consentimento OAuth** (externa) e **Credenciais → ID do cliente OAuth → Aplicativo da Web**, com a URI de redirecionamento:
   - `https://SEU-DOMINIO/api/google/callback` (produção)
   - `http://localhost:5173/api/google/callback` (desenvolvimento, se usar)
3. Cadastre os segredos no Worker (`npx wrangler secret put NOME`):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — da credencial acima
   - `GOOGLE_TOKEN_KEY` — texto longo e aleatório (ex.: `openssl rand -base64 32`). **Não troque depois**, ou as contas conectadas precisarão reconectar.
4. Localmente: copie `.dev.vars.example` para `.dev.vars`.

Já pronto no código: rota `/api/google/connect` → Google → `/api/google/callback` (volta em `/planejamento?google=ok|negado|erro`), `getGoogleStatus`/`disconnectGoogle` (RPC) e `googleFetch()` em `worker/google.ts` para chamar Drive/Docs/Sheets/Slides.
Envio por e-mail: escopo `gmail.send` (sensível — sem verificação do Google, o app mostra o aviso "não verificado" e aceita até 100 usuários). O navegador monta o e-mail e o Worker repassa ao Gmail do próprio professor.
Colunas `plan_docs.google_id` e `google_kind` reservadas para documentos que moram no Google. Sem os segredos, nada muda para quem usa hoje.

## Assistente (RAG)

Botão **Assistente** em Planejamento: pergunta em português sobre documentos, avisos, calendário, planejamentos e provas, e responde citando as fontes. Notas, frequência e dados de alunos NÃO entram (dados em tabela pedem consulta exata, não busca por semelhança).
- **Visibilidade** (metadados `vis` e `owner`, filtrados no Worker depois da busca): documentos e calendários são de toda a escola; avisos seguem o público (todos, papel ou pessoa) e o autor sempre os vê; planejamentos e provas só o autor e a gestão. Índices de metadados do Vectorize: `base_id`, `doc_id`, `vis`, `owner`.
- Avisos/calendários/planejamentos/provas são montados no servidor (`ragSync`, em lotes de 10, só o que mudou) e controlados pela tabela `rag_items`. Tudo no Cloudflare (plano gratuito):
- **Vectorize** (índice `scola-rag`, 1024 dimensões, cosseno, metadados `base_id` e `doc_id`) guarda os trechos; **Workers AI** gera os embeddings (`bge-m3`, multilíngue) e a resposta (`gemma-3-12b-it`).
- O **navegador** extrai o texto (Word, Excel/ODS, PDF com texto, PPTX, TXT/CSV, Docs/Sheets/Slides do Google exportados) e divide em trechos; o Worker só embute e grava. Documentos novos ou editados são preparados sozinhos ao abrir o assistente. PDF escaneado e imagem não entram.
- Cada pessoa tem 60 perguntas por dia (protege a cota gratuita do Workers AI, que é da conta inteira). O índice foi criado uma vez com `wrangler vectorize create scola-rag --dimensions=1024 --metric=cosine` e dois índices de metadados.

## Documentos e planilhas no Planejamento (sem Google)

Em **Planejamento**, há os botões **Novo documento** (tipo Docs) e **Nova planilha** (tipo Sheets). Word (.docx) e planilhas (.xlsx, .xls, .ods, .csv) enviados também abrem no editor.
- **Documento:** TipTap, com títulos, negrito/itálico/sublinhado, cores, marca-texto, alinhamento, listas, tabelas (mesclar, redimensionar) e imagens. Baixa como .docx (biblioteca `docx`) ou imprime em PDF. O Word enviado é aberto com o `mammoth`.
- **Planilha:** FortuneSheet em português (tradução injetada pelo `vite.config.ts`), com abas, fórmulas, formatação, mesclar, congelar, filtrar e classificar. Importa e exporta .xlsx com `@corbe30/fortune-excel` (exceljs).
- **Salva sozinho** enquanto a pessoa edita. O conteúdo editável fica no KV em `c:<id>`, e `f:<id>` guarda sempre o .docx/.xlsx atualizado, para baixar e visualizar.
- **"Em edição por Fulano":** uma trava renovada a cada 30 s impede duas pessoas de sobrescreverem uma à outra. A gestão pode assumir uma trava esquecida.
- **Histórico:** uma cópia é guardada a cada 15 min de edição, e dá para restaurar.
- **Quem edita:** quem criou o arquivo e a gestão. Os demais só leem.
- Abrir um arquivo enviado **não altera nada**: o original só é substituído quando alguém edita.

Código: `src/pages/PlanDocEditorPage.tsx`, `src/components/editor/`, `src/lib/docxConvert.ts`, `worker/handlers/editor.ts`, `migrations/0009_plan_docs_editor.sql`.

## Importar chamadas já feitas

Em **Chamadas → Importar**, envie o arquivo do outro sistema **em qualquer formato**: Excel (.xlsx, .xls), ODS, CSV, TSV, TXT, JSON, HTML, Word (.docx), LibreOffice (.odt), **PDF** (com texto ou escaneado) e **foto** (JPG, PNG, WEBP…).

PDF e Word têm as tabelas reconstruídas pela posição do texto. Foto e PDF escaneado passam por OCR (tesseract.js), feito no próprio aparelho. Antes da leitura, a imagem é endireitada, passa por preto e branco adaptativo (resiste a sombra e fundo) e perde as linhas da tabela. Os nomes são reconhecidos mesmo com espaço faltando ou letra trocada. Uma linha com nome ilegível não é descartada: o professor diz quem é. Código: `src/lib/anyToGrid.ts`.

Dois formatos de chamada são reconhecidos sozinhos:
- **Mapa:** uma linha por aluno e uma coluna por data. Vale data completa no cabeçalho ou só o dia, com o mês no título ("Julho/2026"). Linhas e colunas de total são ignoradas.
- **Lista:** colunas Data, Aluno e Situação, com Turma opcional (uma turma por linha).

O professor confirma o que cada símbolo significa (P, F, •, 1/0, X…), escolhe os alunos que não bateram pelo nome e decide se os dias que já têm chamada no SCOLA são atualizados ou pulados.

## Provas e correção pela câmera

Menu **Provas e correção** (gestão e professores). Dois tipos de prova:

**Prova da escola (padrão).** A escola usa a própria prova:
1. **Gabarito:** na criação da prova, digite as respostas certas em sequência (`ABDCE…`, `X` = anulada).
2. **QR:** o QR é um link (`…/p/<código>` ou `…/p/<código>/<aluno>`) e **não contém as respostas**.
   - **QR da prova:** baixe a imagem e cole no modelo da prova (Word, Docs). Ao escanear, o professor escolhe o aluno.
   - **Etiquetas por aluno:** A4, 3 × 8 etiquetas (70 × 35 mm), com nome e QR. Ao escanear, o aluno já vem selecionado.
3. **Corrigir:** a câmera do celular (até a nativa, pelo link) abre a correção com o gabarito já marcado. O professor toca só nas questões erradas, na letra que o aluno marcou, e salva. A nota sai na hora (e vai para o diário, se configurado).

Se o professor não estiver logado ao escanear, depois do login o sistema volta para a prova escaneada.

**Folha SCOLA (leitura automática).** Os alunos respondem na folha de bolinhas do SCOLA:

1. **Gabarito:** cria a prova (turma, nº de questões até 60, alternativas A–D ou A–E, valor) e marca a resposta certa. "Anular" conta a questão como certa para todos. Opcional: **lançar notas no diário automaticamente** (trimestre + coluna de Notas).
2. **QR e folhas:** a prova gera 2 QR codes:
   - **QR do professor** (gabarito): link `…/corrigir#K1:<código>:<alternativas>:<valor>:<gabarito>`. Mostrado na tela e no "gabarito do professor" impresso. A câmera de qualquer celular abre a correção desta prova já com o gabarito.
   - **QR da folha do aluno** (`S1:<código da prova>:<aluno>`): uma folha de respostas por aluno, com o nome. Também há folhas avulsas.
3. **Corrigir:** dois modos.
   - **Em massa** (padrão): leia o QR do professor e passe as folhas uma atrás da outra. Cada leitura segura é salva sozinha (bipe + vibração) e, se configurado, a nota já vai para o diário. Folhas avulsas ou com marcação duvidosa vão para **Conferir**, sem parar a fila. Também aceita várias fotos da galeria de uma vez.
   - **Uma a uma:** cada folha abre a revisão antes de salvar.
   Sem internet, as correções ficam numa fila no aparelho e são enviadas quando a conexão volta. A prova fica guardada no aparelho depois da primeira leitura.
4. **Resultados:** notas, acerto por questão (com aviso de possível erro no gabarito), Excel e **Lançar no diário** manual. A nota lançada é proporcional ao valor da coluna escolhida em Notas e não mexe nas outras colunas. Se o gabarito mudar, as notas lançadas são recalculadas. Apagar uma correção tira também a nota dela.

Tudo roda no aparelho (sem custo de servidor). O QR é lido pelo **ZXing** (`zxing-wasm`, WebAssembly, que entra no cache do app e funciona offline), com o jsQR de reserva. Quando a folha está longe, o app amplia a região do QR usando as marcas dos cantos. Em último caso, mede cada módulo do QR e redesenha uma versão nítida. A câmera ao vivo exige HTTPS; no computador de desenvolvimento acessado pelo IP da rede, use "Usar fotos".
Código: `src/lib/omr/` (geometria, leitura, QR, fila offline e nota), `src/components/ExamScanner.tsx`, `worker/handlers/provas.ts`, `migrations/0005_provas_diario.sql`.

## App no celular (PWA)

O SCOLA instala como aplicativo, sem loja:
- **Android/Chrome:** aparece o convite "Instale o SCOLA no celular" (ou menu do usuário → Instalar app).
- **iPhone/iPad (Safari):** Compartilhar → Adicionar à Tela de Início (o app mostra o passo a passo).

Abre em tela cheia, funciona com internet fraca (a interface fica guardada no aparelho) e tem atalhos ao segurar o ícone: Fazer chamada, Lançar notas e Corrigir provas. Quando sai versão nova, o app **pergunta** antes de atualizar, para não interromper uma chamada. Excel, PDF e ZIP não entram no download inicial (baixam só quando usados). Configuração em `vite.config.ts` e `public/_headers`; avisos em `src/components/PwaPrompts.tsx`.

## Rodar no computador (desenvolvimento)

```bash
npm run db:local                                   # cria o banco local
npm run admin -- admin@teste.com "Admin" teste123 --local
npm run dev                                        # http://localhost:5173 (API em :8787)
```

## Limites do plano gratuito

| Recurso | Limite grátis | Na prática |
|---|---|---|
| Requisições (Workers) | 100 mil/dia | ~100 escolas pequenas usando o dia todo |
| Banco D1 | 5 GB (500 MB por banco), 5 mi leituras/dia | Dezenas de escolas por anos |
| Anexos (KV) | 1 GB, 1.000 gravações/dia | Avisos e planejamentos com arquivos |

Quando crescer, o plano pago do Workers (US$ 5/mês) multiplica todos esses limites sem mudar nada no código.

## Estrutura do código

```
worker/                API (Cloudflare Worker)
  index.ts             rotas: login, /api/rpc/:operação, arquivos, rotina diária
  auth.ts              senhas (PBKDF2; aceita bcrypt migrado), sessões, papéis
  handlers/            regras de negócio por área (cadastros, chamadas, notas, comunicação, contas)
migrations/            esquema do banco D1 (aplicado automaticamente no deploy)
src/                   site (React + Vite + Tailwind)
  lib/queries.ts       todas as chamadas à API (mesmo nome das operações do worker)
  lib/types.ts         tipos e regras de cálculo (média, crédito variável, recuperação)
  pages/               uma tela por arquivo; pages/admin = painel do administrador
scripts/               cf-setup, criar-admin, migrar-supabase
```

Regras de notas (inalteradas): 3 trimestres; atividades de valor 10 contam como uma nota cada, as menores somam
como uma nota; média = soma ÷ 3; recuperação substitui a menor nota se melhorar a média; aprovação com 6.
